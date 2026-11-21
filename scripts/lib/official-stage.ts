/**
 * 官方场次的参与者与归属解析。
 *
 * 抽成纯函数：`data official` 命令与单测共用，测试不需要加载发布链路
 * （那条链路依赖 `bun` 运行时的 S3 客户端）。
 */
import { CliError, UsageError } from '@chilfish/devkit/cli'

/** 没有固定频道的第三方联动聚合账号。 */
export const FALLBACK_OFFICIAL_ID = 'other'

export interface OfficialDatasetLike {
  id: string
  label: string
  kind?: 'member' | 'official'
}

/**
 * 参与者参数：`all` 或成员 id 列表。
 *
 * 未知 id 与空结果都按用法错误处理：官方场次的参与者是人工判断的结果，
 * 拼错时静默丢弃会让这一场错记到别人名下。
 */
export function resolveParticipantArgs(
  raw: string[],
  datasets: OfficialDatasetLike[],
  options: { excludeId?: string } = {},
): string[] {
  const known = datasets
    .filter(item => (item.kind ?? 'member') === 'member')
    .map(item => item.id)
  const tokens = raw
    .flatMap(value => value.split(','))
    .map(value => value.trim())
    .filter(Boolean)

  if (tokens.length === 0) {
    throw new UsageError('缺少 --participants', {
      hint: `用 --participants all，或逗号分隔的成员 id：${known.join(' / ')}`,
    })
  }

  if (tokens.length === 1 && tokens[0] === 'all')
    return known.filter(id => id !== options.excludeId)

  const picked: string[] = []
  for (const token of tokens) {
    if (!known.includes(token)) {
      throw new UsageError(`未知参与者：${token}`, {
        hint: `可用成员：${known.join(' / ')}；全部成员用 all`,
        context: { token, known },
      })
    }
    if (token === options.excludeId) continue
    if (!picked.includes(token)) picked.push(token)
  }
  if (picked.length === 0) {
    throw new UsageError('参与者过滤后为空', {
      hint: '至少保留一位成员；`all` 会自动排除场次归属的频道主',
    })
  }
  return picked
}

/** 归属：显式指定的官方账号优先，否则用聚合账号。成员频道一律拒绝。 */
export function resolveOfficialDataset<T extends OfficialDatasetLike>(
  datasets: T[],
  datasetId: string | undefined,
): T {
  const target = datasetId
    ? datasets.find(item => item.id === datasetId)
    : datasets.find(item => item.id === FALLBACK_OFFICIAL_ID)

  if (!target) {
    throw new CliError(`data-sources.json 里没有官方账号：${datasetId ?? FALLBACK_OFFICIAL_ID}`, {
      hint: `确认 data-sources.json 里有一条 kind=official 的 ${datasetId ?? FALLBACK_OFFICIAL_ID}`,
    })
  }
  if ((target.kind ?? 'member') !== 'official') {
    throw new UsageError(`${target.id} 是成员频道，不能用官方场次管线写入`, {
      hint: '成员频道里的联动场用 content/collaborations.json 登记，或直接用 data refetch',
      context: { dataset: target.id, kind: target.kind ?? 'member' },
    })
  }
  return target
}
