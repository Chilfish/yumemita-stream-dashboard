/**
 * 弹幕词频的清洗与归一：停用词、噪声 token、表记ゆれ。
 *
 * `Intl.Segmenter('ja')` 会把混在弹幕里的英文句子切成完整单词，`said` / `hi` / `the`
 * 这类不承载内容的 token 在场次里能挤到榜首，把真正有信息量的词压下去；同一句话的
 * 不同写法（`ww` / `ｗｗ` / `笑笑`、`かわいい` / `可愛い`）也会各占一条榜单。
 * 分词、入库、页面聚合与 SQL 汇总共用本模块。
 */

const STOPWORDS: ReadonlySet<string> = new Set(
  `a an the and or but if then so because as while when where why how
  whether though although unless yet either neither nor not no
  i me my mine myself we us our ours ourselves you your yours yourself yourselves
  he him his himself she her hers herself it its itself they them their theirs themselves
  this that these those who whom whose what which
  some any all both each few more most other such own same than too very just also
  only again ever never always already still even
  about above across after against along among around at before behind below beneath
  beside between beyond by despite down during except for from in inside into like near
  of off on onto out outside over past per since through throughout till to toward
  towards under until up upon via with within without
  am is are was were be been being do does did done doing have has had having
  will would shall should can could may might must ought
  yeah yep yes ok okay oh ah uh um hmm wow lol lmao haha hahaha hehe
  hi hello hey bye byebye goodnight goodmorning
  said say says saying told tell`.split(/\s+/).filter(Boolean),
)

/** 英文小写比较；其余语言的词原样返回 false，交给上层规则。 */
export function isStopword(word: string): boolean {
  return STOPWORDS.has(word.toLowerCase())
}

/** 只由长音符、波浪号、标点组成的 token 不是词（`ーーーー` / `……`）。 */
const NOISE_RE = /^[\sー〜～~―…・.,、。!?！？-]+$/

export function isNoiseWord(word: string): boolean {
  return NOISE_RE.test(word)
}

/** 连续的笑声；NFKC 之后全角 `ｗ` 已经是半角 `w`。 */
const LAUGH_RE = /^w+$/
export const LAUGH_WORDS: ReadonlySet<string> = new Set(['笑', '笑笑', '草'])

/**
 * 常见同义 / 表记ゆれ → 展示用的规范词形。
 *
 * 只收弹幕里高频、语义明确的写法；有歧义的（`すき` 之外的短词、`笑う` 这类动词）
 * 不合并，避免把不同意思算到一起。
 */
export const WORD_ALIASES: ReadonlyMap<string, string> = new Map([
  // 可爱
  ['可愛い', 'かわいい'],
  ['可愛', 'かわいい'],
  ['カワイイ', 'かわいい'],
  ['カワイー', 'かわいい'],
  ['かわいー', 'かわいい'],
  // 助かる
  ['助かる', 'たすかる'],
  ['タスカル', 'たすかる'],
  ['たすかー', 'たすかる'],
  // ありがとう
  ['ありがと', 'ありがとう'],
  ['ありがとー', 'ありがとう'],
  ['ありがとうー', 'ありがとう'],
  ['ありがとうございます', 'ありがとう'],
  // おめでとう
  ['おめでと', 'おめでとう'],
  ['おめでとー', 'おめでとう'],
  ['おめでとうー', 'おめでとう'],
  ['おめでとうございます', 'おめでとう'],
  // やばい
  ['ヤバい', 'やばい'],
  ['ヤバ', 'やばい'],
  ['ヤバイ', 'やばい'],
  ['やば', 'やばい'],
  ['やばー', 'やばい'],
  // すごい
  ['すご', 'すごい'],
  ['スゴイ', 'すごい'],
  ['スゴい', 'すごい'],
  ['すごー', 'すごい'],
  ['すごいー', 'すごい'],
  // なるほど
  ['なるほ', 'なるほど'],
  // お疲れ様
  ['お疲れ', 'お疲れ様'],
  ['おつかれ', 'お疲れ様'],
  ['お疲れさま', 'お疲れ様'],
  ['おつかれさま', 'お疲れ様'],
  // 好き
  ['スキ', '好き'],
  ['すき', '好き'],
  ['好きー', '好き'],
  ['ダイスキ', '大好き'],
  ['だいすき', '大好き'],
  // 楽しみ
  ['たのしみ', '楽しみ'],
  ['楽しみー', '楽しみ'],
  // 面白い
  ['面白', '面白い'],
  ['おもしろ', '面白い'],
  ['おもしろい', '面白い'],
  // かっこいい
  ['カッコいい', 'かっこいい'],
  ['カッコイイ', 'かっこいい'],
  ['かっこいー', 'かっこいい'],
  // うれしい
  ['嬉しい', 'うれしい'],
  ['うれしー', 'うれしい'],
  // 问候
  ['こんばんわ', 'こんばんは'],
  ['こんばんはー', 'こんばんは'],
  ['こんにちわ', 'こんにちは'],
  ['おはよ', 'おはよう'],
  ['おはよー', 'おはよう'],
  ['おやすみなさい', 'おやすみ'],
  // ほんと
  ['本当', 'ほんと'],
  ['ほんとう', 'ほんと'],
  ['ほんとー', 'ほんと'],
  // がんばれ
  ['頑張れ', 'がんばれ'],
  ['ガンバレ', 'がんばれ'],
  ['がんばって', 'がんばれ'],
  ['頑張って', 'がんばれ'],
])

const LATIN_ONLY_RE = /^[a-z]+$/i

/**
 * 词形归一：NFKC（全角 → 半角、半角假名 → 全角）、笑声统一 `www`、
 * 纯拉丁词小写、常见表记ゆれ映射到规范词形。
 */
export function canonicalWord(raw: string): string {
  const word = raw.normalize('NFKC')
  const lower = word.toLowerCase()
  if (LAUGH_RE.test(lower) || LAUGH_WORDS.has(word))
    return 'www'
  if (LATIN_ONLY_RE.test(word))
    return lower
  return WORD_ALIASES.get(word) ?? word
}
