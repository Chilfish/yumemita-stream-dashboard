/**
 * URL 是否指向本机。数据库连接、开发代理、本地对象存储与 `LOCAL=1` 共用这一份判断，
 * 避免各处对 `localhost` / `127.0.0.1` / `::1` 的写法出现偏差。
 */
export function isLocalUrl(value: string | undefined | null): boolean {
  if (!value) return false
  try {
    // Node 的 URL.hostname 对 IPv6 保留方括号：`http://[::1]:9000` → `[::1]`。
    const host = new URL(value).hostname.replace(/^\[|\]$/g, '')
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
  }
  catch {
    return false
  }
}
