/** 频道专属表情的 id 形如 `<channelId>/<hash>`；Unicode 表情是字符本身。 */
const CHANNEL_EMOJI_ID_RE = /^UC[A-Za-z0-9_-]+\/([A-Za-z0-9_-]+)$/;

export function isCustomEmojiId(emojiId: string): boolean {
  return CHANNEL_EMOJI_ID_RE.test(emojiId);
}

/** 图片文件名只取 hash 段；id 不是 `<channelId>/<hash>` 时返回 null，不猜路径。 */
export function emojiFileName(emojiId: string): string | null {
  const match = CHANNEL_EMOJI_ID_RE.exec(emojiId);
  return match ? `${match[1]}.png` : null;
}
