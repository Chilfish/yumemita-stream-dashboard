import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultCookieCachePath,
  filterCookieDomains,
  inspectCookieJar,
  resolveCookies,
  ytdlpCookieArgs,
} from './yt-cookies.ts'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'yt-cookies-'))
  dirs.push(dir)
  return dir
}

function writeJar(dir: string): string {
  const path = join(dir, 'cookies.txt')
  writeFileSync(path, [
    '# Netscape HTTP Cookie File',
    '.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret',
    '.youtube.com\tTRUE\t/\tTRUE\t0\tVISITOR_INFO1_LIVE\tvisitor',
    '.google.com\tTRUE\t/\tTRUE\t0\tSAPISID\tabc',
    '.example.com\tTRUE\t/\tTRUE\t0\tOTHER\tnope',
  ].join('\n'), 'utf8')
  return path
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

describe('cookie 缓存路径', () => {
  it('默认落在 home 下的 ~/yt-cookies.txt', () => {
    expect(defaultCookieCachePath()).toBe(join(homedir(), 'yt-cookies.txt'))
  })
})

describe('cookie jar', () => {
  it('统计条数与登录态', () => {
    const path = writeJar(tempDir())
    const info = inspectCookieJar(path)
    expect(info.cookies).toBe(4)
    expect(info.youtube).toBe(2)
    expect(info.loggedIn).toBe(true)
    expect(statSync(path).size).toBeGreaterThan(0)
  })

  it('按域裁剪时保留 Netscape 头与 HttpOnly 行', () => {
    const dir = tempDir()
    const path = join(dir, 'cookies.txt')
    writeFileSync(path, [
      '# Netscape HTTP Cookie File',
      '#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret',
      '.google.com\tTRUE\t/\tTRUE\t0\tSAPISID\tabc',
    ].join('\n'), 'utf8')
    const result = filterCookieDomains(path, ['youtube.com'])
    expect(result).toEqual({ before: 3, after: 2 })
    const info = inspectCookieJar(path)
    expect(info.youtube).toBe(1)
    expect(info.loggedIn).toBe(true)
  })
})

describe('resolveCookies 优先级', () => {
  it('显式请求头优先，并且不再导出缓存', async () => {
    const resolved = await resolveCookies({ cookie: 'SID=manual', cookies: undefined })
    expect(resolved).toEqual({ header: 'SID=manual', jarPath: null, source: 'header' })
  })

  it('显式 jar 只取 youtube.com 的 cookie，并作为 yt-dlp 参数复用', async () => {
    const path = writeJar(tempDir())
    const resolved = await resolveCookies({ cookies: path })
    expect(resolved.source).toBe('file')
    expect(resolved.header).toBe('SID=secret; VISITOR_INFO1_LIVE=visitor')
    expect(resolved.jarPath).toBe(path)
    expect(ytdlpCookieArgs(resolved)).toEqual(['--cookies', path])
  })

  it('环境变量请求头优先于缓存', async () => {
    const resolved = await resolveCookies({ envCookie: 'SID=env' })
    expect(resolved).toEqual({ header: 'SID=env', jarPath: null, source: 'env' })
  })

  it('--no-cookies 不读缓存', async () => {
    const resolved = await resolveCookies({ disable: true })
    expect(resolved.header).toBeNull()
    expect(resolved.source).toBe('none')
  })

  it('没有 jar 时 yt-dlp 回退浏览器', () => {
    expect(ytdlpCookieArgs({ jarPath: null, source: 'header' }, { browser: 'firefox' }))
      .toEqual(['--cookies-from-browser', 'firefox'])
  })

  it('--no-cookies 不会把浏览器 cookie 又带回 yt-dlp', async () => {
    const resolved = await resolveCookies({ disable: true })
    expect(ytdlpCookieArgs(resolved, { browser: 'firefox' })).toEqual([])
  })
})
