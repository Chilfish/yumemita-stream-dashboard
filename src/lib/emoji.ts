/** YouTube 全局表情的 scope；这些 id 的 hash 是固定的，和成员无关，单独放 `youtube/`。 */
export const YOUTUBE_EMOJI_SCOPE = "UCkszU2WH9gy1mb0dV-11UJg";

const CHANNEL_EMOJI_ID_RE = /^(UC[A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/;

/** 频道专属表情的 id 形如 `<channelId>/<hash>`；Unicode 表情是字符本身。 */
export function isCustomEmojiId(emojiId: string): boolean {
  return CHANNEL_EMOJI_ID_RE.test(emojiId);
}

/** id 的 scope 前缀（频道 id）；不是 `<channelId>/<hash>` 时返回 null。 */
export function emojiScope(emojiId: string): string | null {
  return CHANNEL_EMOJI_ID_RE.exec(emojiId)?.[1] ?? null;
}

/** 图片文件名只取 hash 段；id 不是 `<channelId>/<hash>` 时返回 null，不猜路径。 */
export function emojiFileName(emojiId: string): string | null {
  const match = CHANNEL_EMOJI_ID_RE.exec(emojiId);
  return match ? `${match[2]}.png` : null;
}

/** 对象存储 / 本地目录：全局表情归 `youtube/`，其余按成员 dataset 归档。 */
export function emojiFolder(datasetId: string, emojiId: string): string {
  return emojiScope(emojiId) === YOUTUBE_EMOJI_SCOPE ? "youtube" : datasetId;
}
