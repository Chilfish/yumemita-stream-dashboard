/**
 * 弹幕词频里的噪声词：英文虚词、寒暄与语气词。
 *
 * `Intl.Segmenter('ja')` 会把混在弹幕里的英文句子切成完整单词，`said` / `hi` / `the`
 * 这类不承载内容的 token 在场次里能挤到榜首，把真正有信息量的词压下去。
 * 词频统计与页面聚合都先过这一层。
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
