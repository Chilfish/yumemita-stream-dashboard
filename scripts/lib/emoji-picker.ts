/**
 * 解析 YouTube 频道表情选择器的 HTML（`yt-emoji-picker-category-renderer`）。
 *
 * 每个频道表情就是一个 `<img>`：`id` 是 `<channelId>/<hash>`，`src` 是 48×48 的
 * `yt3.ggpht.com` 地址，`alt` / `aria-label` 是名称。把这份 HTML 存成
 * `data/emoji-<datasetId>.html`，`fetch:emoji` 就能在不需要原始回放的情况下镜像整套表情。
 */
export interface PickerEmoji {
  id: string
  name: string | null
  url: string
}

const CHANNEL_EMOJI_ID_RE = /^UC[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/
const IMG_TAG_RE = /<img\b[^>]*>/g
const ATTR_RE = /([a-zA-Z-]+)="([^"]*)"/g

function decode(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"')
}

function readAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of tag.matchAll(ATTR_RE))
    attrs[match[1]!] = decode(match[2]!)
  return attrs
}

/** 只保留频道专属表情；顺序按 HTML 里的出现顺序，id 去重。 */
export function parseEmojiPicker(html: string): PickerEmoji[] {
  const seen = new Map<string, PickerEmoji>()
  for (const tag of html.match(IMG_TAG_RE) ?? []) {
    const attrs = readAttrs(tag)
    const id = attrs.id
    const url = attrs.src
    if (!id || !url || !CHANNEL_EMOJI_ID_RE.test(id) || seen.has(id))
      continue
    const name = (attrs.alt || attrs['aria-label'] || '').replace(/^:|:$/g, '').trim() || null
    seen.set(id, { id, name, url })
  }
  return [...seen.values()]
}
