/**
 * 页面级安全头。CSP 只允许本站脚本与样式，外加对象存储的图片 / 表情索引读取，
 * 以及 Cloudflare Web Analytics 的 beacon。
 *
 * `script-src` 仍带 `'unsafe-inline'`：astro 的主题初始化与 View Transitions
 * 依赖内联脚本，去掉会白屏。外部脚本只放行 Cloudflare 自己的统计脚本，
 * 仍能挡住注入 `<script src>` 这类攻击。
 */

export interface SecurityHeaderOptions {
  /** 媒体公开域名，例如 `https://ymmt-s3.chilfish.top`；本地开发可能是 SILO 地址。 */
  assetOrigin?: string | null;
}

/** Cloudflare Web Analytics：beacon 由 Cloudflare 自动注入，不放行会被 CSP 整块挡掉。 */
const CF_INSIGHTS_SCRIPT = "https://static.cloudflareinsights.com";
const CF_INSIGHTS_REPORT = "https://cloudflareinsights.com";

/**
 * CSP 的 host-source 不是任意 URL：路径不以 `/` 结尾时按精确匹配处理，
 * 本地对象存储地址带路径（`http://127.0.0.1:9000/ymmt`）会把子路径全部挡掉。
 * 这里统一收敛到 origin。
 */
function assetSource(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  }
  catch {
    return trimmed.replace(/\/+$/, "") || null;
  }
}

export function contentSecurityPolicy({ assetOrigin }: SecurityHeaderOptions = {}): string {
  const asset = assetSource(assetOrigin);
  const media = ["'self'", "data:", "blob:", ...(asset ? [asset] : [])];
  const connect = ["'self'", ...(asset ? [asset] : []), CF_INSIGHTS_REPORT];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    `script-src 'self' 'unsafe-inline' ${CF_INSIGHTS_SCRIPT}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${media.join(" ")}`,
    "font-src 'self' data:",
    `connect-src ${connect.join(" ")}`,
    "manifest-src 'self'",
    "media-src 'self'",
    "worker-src 'self' blob:",
  ].join("; ");
}
