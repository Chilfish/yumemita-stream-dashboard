import { UsageError } from '@chilfish/devkit/cli'

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/

/** 从链接或裸 ID 里取 11 位视频 ID；不合法时抛用法错误。 */
export function parseVideoRef(input: string): string {
  const trimmed = input.trim()
  if (VIDEO_ID_RE.test(trimmed))
    return trimmed

  let url: URL
  try {
    url = new URL(trimmed)
  }
  catch {
    throw new UsageError(`无法解析视频链接或 ID：${input}`, {
      hint: '支持 watch?v= / youtu.be / /live/ / /shorts/ 链接，或 11 位视频 ID',
      context: { input },
    })
  }

  const host = url.hostname.replace(/^www\./, '')
  if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'youtu.be') {
    throw new UsageError(`不是 YouTube 链接：${input}`, {
      hint: '示例：https://www.youtube.com/watch?v=1dGnP_rXgW0',
      context: { input },
    })
  }

  const fromQuery = url.searchParams.get('v')
  if (fromQuery && VIDEO_ID_RE.test(fromQuery))
    return fromQuery

  const last = url.pathname.split('/').filter(Boolean).at(-1)
  if (last && VIDEO_ID_RE.test(last))
    return last

  throw new UsageError(`链接里没有可识别的视频 ID：${input}`, {
    hint: '支持 watch?v= / youtu.be / /live/ / /shorts/ 链接，或 11 位视频 ID',
    context: { input },
  })
}
