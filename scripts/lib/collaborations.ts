/**
 * 联动场次的参与者登记与标题推断。
 *
 * pack 与 YouTube 都不提供结构化的共演信息，权威来源仍是仓库内的
 * `content/collaborations.json`：登记优先，空数组合义是「确认无联动」，
 * 用来压制标题推断的误判。没有登记的场次才用标题推断兜底。
 *
 * 校验按「单条失败跳过、不阻塞其余」处理：owner 冲突、未知成员、重复登记
 * 都只记一条日志。文件不存在时返回空表，历史数据行为与单人场完全一致。
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const COLLABORATIONS_SCHEMA = 'yumemita.stream-collaborations/v1'
export const COLLABORATIONS_PATH = 'content/collaborations.json'

export interface CollaborationFile {
  schema?: string
  /** videoId → owner 之外的成员 id；空数组表示确认这场没有联动。 */
  streams?: Record<string, unknown>
}

export interface CollaborationSkip {
  videoId: string
  datasetId: string
  reason: string
}

export interface CollaborationPlan {
  /** videoId → 去重后的参与者 id，保持登记顺序；空数组是显式覆盖。 */
  byVideo: Map<string, string[]>
  skipped: CollaborationSkip[]
}

interface LoadOptions {
  /** `data-sources.json` 里的成员 id，用于拒绝拼写错误。 */
  knownDatasetIds: Iterable<string>
  /** 已知每场 videoId 的 owner；缺省时不做 owner 冲突校验。 */
  ownerByVideo?: Map<string, string>
}

/** 纯函数：把覆盖文件规整成可写入的 map，并收集跳过项。 */
export function planCollaborations(
  file: CollaborationFile | null,
  options: LoadOptions,
): CollaborationPlan {
  const known = new Set(options.knownDatasetIds)
  const byVideo = new Map<string, string[]>()
  const skipped: CollaborationSkip[] = []
  if (!file?.streams || typeof file.streams !== 'object') return { byVideo, skipped }

  for (const [videoId, value] of Object.entries(file.streams)) {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
      skipped.push({ videoId, datasetId: '', reason: 'videoId 不是 11 位' })
      continue
    }
    if (!Array.isArray(value)) {
      skipped.push({ videoId, datasetId: '', reason: '参与者必须是数组' })
      continue
    }

    const owner = options.ownerByVideo?.get(videoId) ?? null
    const accepted: string[] = []
    for (const raw of value) {
      const datasetId = typeof raw === 'string' ? raw.trim() : ''
      if (!datasetId) {
        skipped.push({ videoId, datasetId: String(raw), reason: '参与者 id 为空' })
        continue
      }
      if (!known.has(datasetId)) {
        skipped.push({ videoId, datasetId, reason: '未知成员 id' })
        continue
      }
      if (owner && datasetId === owner) {
        skipped.push({ videoId, datasetId, reason: 'owner 不需要登记为参与者' })
        continue
      }
      if (accepted.includes(datasetId)) {
        skipped.push({ videoId, datasetId, reason: '重复登记' })
        continue
      }
      accepted.push(datasetId)
    }

    if (accepted.length > 0) byVideo.set(videoId, accepted)
    // 空数组是显式覆盖：确认这场没有联动，用来压制标题推断的误判。
    else if (value.length === 0) byVideo.set(videoId, [])
  }

  return { byVideo, skipped }
}

export interface LoadCollaborationsResult extends CollaborationPlan {
  /** 文件不存在时为 null。 */
  file: CollaborationFile | null
}

export function loadCollaborations(
  options: LoadOptions,
  path: string = COLLABORATIONS_PATH,
): LoadCollaborationsResult {
  const file = resolve(path)
  if (!existsSync(file)) return { file: null, byVideo: new Map(), skipped: [] }

  const parsed = JSON.parse(readFileSync(file, 'utf8')) as CollaborationFile
  const plan = planCollaborations(parsed, options)
  return { file: parsed, ...plan }
}

/** 标题别名：管理端给候选提示用，也用于未登记场次的参与者推断。 */
export const MEMBER_TITLE_ALIASES: Record<string, string[]> = {
  nonoka: ['宮永ののか', '宫永ののか', 'ののか', 'ののちゃん', 'のののの', 'のの'],
  arale: ['仲町あられ', 'あられ'],
  ritsu: ['峰月律', '峰月りつ', 'りっちゃん', '律'],
  miyako: ['藤都子', 'みやこ', 'みゃーちゃん', 'みゃー', '都子'],
  yuno: ['千石ユノ', 'ユノち', 'ゆの', 'ユノ'],
}

/**
 * 组合名 / 联动 tag：命中即视为这两人同场。
 * 只收专有名词，不收 `納期`、`みやみや` 这类会出现在单人内容里的泛词。
 * 出处见 `docs/planning/collaboration-streams.md` §8 与组合名对照档。
 */
export const PAIR_TAGS: Record<string, string[]> = {
  'arale|nonoka': ['ふわキラゆめみ隊', 'ふわキラ'],
  'arale|ritsu': ['りつとあられ'],
  'arale|miyako': ['健全シスターズ'],
  'arale|yuno': ['甘辛豆腐メンタル', 'あらユノ', 'あられユノ'],
  'nonoka|ritsu': ['ぎたーグミ', 'ギターぐみ'],
  'nonoka|miyako': ['ミルミルグッズ化推進委員会', 'ののかみやこ', 'ののみや'],
  'nonoka|yuno': ['ののゆの', 'ののユノ'],
  'ritsu|miyako': ['りつみやコラボ'],
  'ritsu|yuno': ['ユノ食べろ律食べるな', 'ユノりつ'],
  'miyako|yuno': ['納期シスターズ'],
}

/**
 * 标题里出现成员名但不同场的固定说法。
 * 已知模式：画成员（繪回）、介绍周边 / 试吃、ASMR シチュボ、转述某人的话（`律いわく`）。
 */
const NON_COLLAB_TITLE = /描[くきい]|デザイン|実食|ASMR|シチュボ|いわく/i

/** 只用于匹配，不改变原文：`旋律`、`法律` 里的「律」不是峰月律。 */
const TITLE_NOISE = /旋律|法律|規律|律動|律速/g

function aliasParticipants(
  title: string,
  ownerId: string,
  knownDatasetIds: Iterable<string>,
): string[] {
  const known = new Set(knownDatasetIds)
  const fromAliases = Object.entries(MEMBER_TITLE_ALIASES)
    .filter(([id]) => id !== ownerId && known.has(id))
    .filter(([, aliases]) => aliases.some(alias => title.includes(alias)))
    .map(([id]) => id)

  const fromPairs = Object.entries(PAIR_TAGS)
    .filter(([, tags]) => tags.some(tag => title.includes(tag)))
    .flatMap(([pair]) => pair.split('|'))
    .filter(id => id !== ownerId && known.has(id))

  return [...new Set([...fromAliases, ...fromPairs])]
}

/**
 * 按标题给出参与者候选。用于候选清单，不做误判过滤：
 * 别名可能是普通词汇的一部分（`語りつつ` 含 `りつ`），不能当真相。
 */
export function suggestParticipants(
  title: string,
  ownerId: string,
  knownDatasetIds: Iterable<string>,
): string[] {
  return aliasParticipants(title, ownerId, knownDatasetIds)
}

/**
 * 未登记场次的自动参与者推断。
 *
 * 与 `suggestParticipants` 的差别只在于先剔除已知的非联动说法，
 * 结果是确定性的：同一标题永远得到同一组 id，可以直接入库。
 */
export function inferParticipants(
  title: string,
  ownerId: string,
  knownDatasetIds: Iterable<string>,
): string[] {
  if (!title) return []
  const cleaned = title.replace(TITLE_NOISE, '')
  if (NON_COLLAB_TITLE.test(cleaned)) return []
  return aliasParticipants(cleaned, ownerId, knownDatasetIds)
}

export type ParticipantSource = 'manual' | 'title' | 'none'

export interface ResolvedParticipants {
  ids: string[]
  source: ParticipantSource
}

/**
 * 参与者取值优先级：手动登记（含显式空数组）> 标题推断 > 空。
 * ingest 与每日对账共用这一个函数，避免两处口径漂移。
 */
export function resolveParticipants(options: {
  videoId: string
  ownerId: string
  title: string | null | undefined
  manual: Map<string, string[]>
  knownDatasetIds: Iterable<string>
}): ResolvedParticipants {
  const manual = options.manual.get(options.videoId)
  if (manual !== undefined) {
    return { ids: manual.filter(id => id !== options.ownerId), source: 'manual' }
  }
  const inferred = inferParticipants(options.title ?? '', options.ownerId, options.knownDatasetIds)
  return { ids: inferred, source: inferred.length > 0 ? 'title' : 'none' }
}
