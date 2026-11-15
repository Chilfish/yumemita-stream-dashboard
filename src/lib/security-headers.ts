/**
 * 页面级安全头。CSP 只允许本站脚本与样式，外加对象存储的图片 / 表情索引读取。
 *
 * `script-src` 仍带 `'unsafe-inline'`：astro 的主题初始化与 View Transitions
 * 依赖内联脚本，去掉会白屏。外部脚本仍然被禁止，能挡住注入 `<script src>` 这类攻击。
 */

export interface SecurityHeaderOptions {
  /** 媒体公开域名，例如 `https://ymmt-s3.chilfish.top`；本地开发可能是 SILO 地址。 */
  assetOrigin?: string | null;
}

export function contentSecurityPolicy({ assetOrigin }: SecurityHeaderOptions = {}): string {
  const asset = assetOrigin?.trim().replace(/\/+$/, "") || null;
  const media = ["'self'", "data:", "blob:", ...(asset ? [asset] : [])];
  const connect = ["'self'", ...(asset ? [asset] : [])];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${media.join(" ")}`,
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    "manifest-src 'self'",
    "media-src 'self'",
    "worker-src 'self' blob:",
  ].join("; ");
}
