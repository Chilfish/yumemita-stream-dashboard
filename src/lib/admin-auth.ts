/** 管理端凭证：HTTP Basic 用于首次登录与 Agent 直连，签名 Cookie 用于浏览器后续请求。 */

export const SESSION_COOKIE = "ymmt_admin";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface BasicCredentials {
  user: string;
  password: string;
}

export function parseBasicAuth(header: string | null): BasicCredentials | null {
  if (!header) return null;
  const [scheme, ...rest] = header.trim().split(" ");
  if (scheme?.toLowerCase() !== "basic") return null;

  try {
    const decoded = atob(rest.join(" ").trim());
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      user: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  }
  catch {
    return null;
  }
}

/** 常数时间比较，避免按字符逐位提前返回。 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function signSession(expMs: number, secret: string): Promise<string> {
  const payload = `v1.${expMs}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(payload));
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

export async function verifySession(
  cookie: string | undefined,
  secret: string,
  now = new Date(),
): Promise<boolean> {
  if (!cookie) return false;
  const parts = cookie.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;

  const expMs = Number(parts[1]);
  if (!Number.isFinite(expMs) || expMs <= now.getTime()) return false;

  const expected = await signSession(expMs, secret);
  return safeEqual(cookie, expected);
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure,
    maxAge: SESSION_TTL_MS / 1000,
  };
}
