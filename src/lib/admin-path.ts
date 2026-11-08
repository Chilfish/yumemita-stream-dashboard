/**
 * 管理端路径分类。
 *
 * 用显式前缀清单，避免把 `/api/admin` 这类无尾斜杠路径漏在守卫外。
 * 路径先做尾斜杠规范化，`/admin/` 与 `/admin` 等价。
 */

export function normalizePathname(pathname: string): string {
  if (pathname === "/") return "/";
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : "/";
}

export function isAdminPath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return path === "/admin"
    || path.startsWith("/admin/")
    || path === "/api/admin"
    || path.startsWith("/api/admin/");
}

export function isApiPath(pathname: string): boolean {
  return normalizePathname(pathname).startsWith("/api/");
}
