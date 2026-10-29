/**
 * 封面变体的唯一约定，`scripts/` 与页面共用。
 *
 * 变体由 `bun run fetch:thumbs` 用 `Bun.Image` 从原图（1280×720 的 maxresdefault）
 * 编码成 WebP：key 只由 dataset + videoId + 宽度决定，不依赖 manifest，
 * 离线也能拼出 URL；原图与变体一起发布，前端靠 `srcset` 让浏览器按实际尺寸挑一张。
 */

/** 目标宽度（像素）。顺序即 `srcset` 顺序，必须递增。 */
export const THUMB_VARIANTS = [480, 960, 1280] as const;

/** 变体文件名：`<videoId>.480.webp`。 */
export function thumbVariantName(videoId: string, width: number): string {
  return `${videoId}.${width}.webp`;
}
