import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import type { WriteDb } from '../../src/db/connection.ts'
import { transcripts } from '../../src/db/schema.ts'

/**
 * 把 `content/transcripts/<datasetId>/*.md` 的 frontmatter 同步到 `transcripts` 表。
 *
 * 逐字稿正文由 `publish-transcripts` 上传到对象存储；本函数负责数据库元数据，
 * 让列表页与单场页知道「这场有没有稿」。两处共用，避免发布 / ingest 各写一套。
 */

function contentHash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function parseFrontmatter(raw: string): Record<string, string | string[]> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match?.[1]) return {}
  const result: Record<string, string | string[]> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if (!key) continue
    if (value.startsWith('[') && value.endsWith(']')) {
      result[key] = value.slice(1, -1).split(',').map(item => item.trim()).filter(Boolean)
      continue
    }
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith('\'') && value.endsWith('\''))
    ) {
      value = value.slice(1, -1)
    }
    result[key] = value
  }
  return result
}

export async function syncTranscripts(db: WriteDb, datasetId: string): Promise<number> {
  const dir = resolve('content', 'transcripts', datasetId)
  if (!existsSync(dir)) return 0

  const existingRows = await db
    .select({ videoId: transcripts.videoId, contentHash: transcripts.contentHash })
    .from(transcripts)
    .where(eq(transcripts.datasetId, datasetId))
  const existing = new Map(existingRows.map(row => [row.videoId, row.contentHash]))

  let count = 0
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md') || name.startsWith('_') || name.startsWith('.')) continue
    const file = join(dir, name)
    const raw = readFileSync(file, 'utf8')
    const hash = contentHash(raw)
    const meta = parseFrontmatter(raw)
    const videoId = typeof meta.videoId === 'string' && meta.videoId
      ? meta.videoId
      : basename(name, '.md')
    if (existing.get(videoId) === hash) continue

    const tags = Array.isArray(meta.tags) ? meta.tags : []
    const dateValue = typeof meta.date === 'string' ? meta.date.slice(0, 10) : null

    await db.insert(transcripts).values({
      datasetId,
      videoId,
      r2Key: `${datasetId}/transcripts/${videoId}.json`,
      title: typeof meta.title === 'string' ? meta.title : null,
      date: dateValue && /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue : null,
      summary: typeof meta.summary === 'string' ? meta.summary : null,
      tags,
      contentHash: hash,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [transcripts.datasetId, transcripts.videoId],
      set: {
        r2Key: `${datasetId}/transcripts/${videoId}.json`,
        title: typeof meta.title === 'string' ? meta.title : null,
        date: dateValue && /^\d{4}-\d{2}-\d{2}$/.test(dateValue) ? dateValue : null,
        summary: typeof meta.summary === 'string' ? meta.summary : null,
        tags,
        contentHash: hash,
        updatedAt: new Date(),
      },
    })
    count += 1
  }
  return count
}
