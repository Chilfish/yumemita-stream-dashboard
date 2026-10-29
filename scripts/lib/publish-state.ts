/**
 * 发布进度：记录每个对象上次上传时的内容摘要，让 publish:data 只传变化的部分。
 *
 * 记录是**本地缓存**，不是真源：远端对象是否还在、大小是否对得上，由 publish 时
 * 列一次桶来核对。换桶 / 换 `R2_PREFIX` 时 `target` 不匹配，整份记录失效（全量传一次）。
 */
import { createHash } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

export const PUBLISH_STATE_SCHEMA = 'yumemita.publish-state/v1'

export interface PublishStateEntry {
  sha256: string
  size: number
  uploadedAt: string
}

export interface PublishState {
  schema: string
  /** `${bucket}/${prefix}`；目标的标识，变了就当记录作废。 */
  target: string
  updatedAt: string
  objects: Record<string, PublishStateEntry>
}

export interface BodyDigest {
  sha256: string
  size: number
}

export function digestBody(body: string): BodyDigest {
  return {
    sha256: createHash('sha256').update(body).digest('hex'),
    size: Buffer.byteLength(body),
  }
}

function emptyState(target: string): PublishState {
  return {
    schema: PUBLISH_STATE_SCHEMA,
    target,
    updatedAt: new Date().toISOString(),
    objects: {},
  }
}

export function readPublishState(path: string, target: string): PublishState {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  }
  catch {
    return emptyState(target)
  }
  if (!raw || typeof raw !== 'object')
    return emptyState(target)

  const candidate = raw as Partial<PublishState>
  if (candidate.schema !== PUBLISH_STATE_SCHEMA || candidate.target !== target)
    return emptyState(target)

  const objects: Record<string, PublishStateEntry> = {}
  for (const [key, entry] of Object.entries(candidate.objects ?? {})) {
    if (!entry || typeof entry.sha256 !== 'string' || typeof entry.size !== 'number')
      continue
    objects[key] = {
      sha256: entry.sha256,
      size: entry.size,
      uploadedAt: typeof entry.uploadedAt === 'string' ? entry.uploadedAt : '',
    }
  }

  return {
    schema: PUBLISH_STATE_SCHEMA,
    target,
    updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : new Date().toISOString(),
    objects,
  }
}

export function writePublishState(path: string, state: PublishState): void {
  state.updatedAt = new Date().toISOString()
  const temp = `${path}.tmp`
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  renameSync(temp, path)
}

/**
 * 能否跳过上传：本地摘要一致，且远端对得上。
 * `remote` 为 `null` 表示列桶失败、远端状态未知——这时只信本地进度。
 */
export function isUnchanged(
  entry: PublishStateEntry | undefined,
  digest: BodyDigest,
  remote: ReadonlyMap<string, number> | null,
  key: string,
): boolean {
  if (!entry || entry.sha256 !== digest.sha256 || entry.size !== digest.size)
    return false
  return remote === null || remote.get(key) === digest.size
}
