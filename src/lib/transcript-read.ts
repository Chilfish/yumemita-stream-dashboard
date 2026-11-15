import { readObject } from './object-read'
import type { TranscriptFile, TranscriptPayload } from './transcripts'
import { transcriptFileFromPayload } from './transcripts'

/**
 * 服务端读取逐字稿正文（`?view=transcript` 首屏预渲染用）。
 *
 * 与 `/api/transcripts/*` 读的是同一个 R2 对象、同一套载荷格式；这里只做「读不到就退回客户端加载」，
 * 不区分 miss / unconfigured / error——首屏预渲染失败不应该让整页报错。
 */
export async function readTranscriptFile(r2Key: string): Promise<TranscriptFile | null> {
  const result = await readObject(r2Key)
  if (result.kind !== 'hit') {
    if (result.kind === 'error') console.error('[transcript] object read failed', r2Key, result.error)
    return null
  }

  try {
    return transcriptFileFromPayload(JSON.parse(result.text) as TranscriptPayload)
  }
  catch (error) {
    console.error('[transcript] payload parse failed', r2Key, error)
    return null
  }
}
