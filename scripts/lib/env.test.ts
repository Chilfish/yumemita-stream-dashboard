import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadEnvFiles, parseEnvContent } from './env.ts'

describe('parseEnvContent', () => {
  it('忽略空行与注释，按第一个等号切分', () => {
    const values = parseEnvContent([
      '# comment',
      '',
      'A=1',
      'B = two=2',
      'C="quoted value"',
      "D='single'",
    ].join('\n'))

    expect(values).toEqual({
      A: '1',
      B: 'two=2',
      C: 'quoted value',
      D: 'single',
    })
  })

  it('同一文件里重复 key 以最后一次为准', () => {
    expect(parseEnvContent('A=1\nA=2\n')).toEqual({ A: '2' })
  })

  it('没有等号或空 key 的行被跳过', () => {
    expect(parseEnvContent('NO_EQUALS\n=value\nA=1\n')).toEqual({ A: '1' })
  })
})

describe('loadEnvFiles', () => {
  const KEYS = ['LOCAL', 'DATABASE_URL', 'NEON_HTTP_ENDPOINT', 'SITE_URL', 'PUBLIC_R2_BASE']
  const saved: Record<string, string | undefined> = {}
  let cwd: string

  function write(name: string, content: string): void {
    writeFileSync(join(cwd, name), content, 'utf8')
  }

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
    cwd = mkdtempSync(join(tmpdir(), 'env-files-'))
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    rmSync(cwd, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('LOCAL=0 时数据库与代理地址只认 .env', () => {
    write('.env', 'LOCAL=0\nDATABASE_URL=postgres://online/db\n')
    write('.dev.vars', 'DATABASE_URL=postgres://postgres@localhost:5432/ymmt_dev\nNEON_HTTP_ENDPOINT=http://127.0.0.1:4444/sql\n')
    write('.env.local', 'DATABASE_URL=postgres://postgres@localhost:5432/ymmt_dev\n')

    loadEnvFiles({}, cwd)

    expect(process.env.DATABASE_URL).toBe('postgres://online/db')
    expect(process.env.NEON_HTTP_ENDPOINT).toBeUndefined()
  })

  it('LOCAL=1 时采用 .env.local 的本机地址，并把代理切回本机', () => {
    write('.env', 'DATABASE_URL=postgres://online/db\n')
    write('.env.local', 'LOCAL=1\nDATABASE_URL=postgres://postgres@localhost:5432/ymmt_dev\n')

    loadEnvFiles({}, cwd)

    expect(process.env.DATABASE_URL).toBe('postgres://postgres@localhost:5432/ymmt_dev')
    expect(process.env.NEON_HTTP_ENDPOINT).toBe('http://127.0.0.1:4444/sql')
  })

  it('真实进程环境的 LOCAL 优先于文件', () => {
    process.env.LOCAL = '0'
    write('.env', 'DATABASE_URL=postgres://online/db\n')
    write('.env.local', 'LOCAL=1\nDATABASE_URL=postgres://postgres@localhost:5432/ymmt_dev\n')

    loadEnvFiles({}, cwd)

    expect(process.env.DATABASE_URL).toBe('postgres://online/db')
  })

  it('开发服务器始终取本机地址，不受 LOCAL 开关影响', () => {
    write('.env', 'LOCAL=0\nDATABASE_URL=postgres://online/db\n')
    write('.env.local', 'DATABASE_URL=postgres://postgres@localhost:5432/ymmt_dev\n')

    loadEnvFiles({ devServer: true }, cwd)

    expect(process.env.DATABASE_URL).toBe('postgres://postgres@localhost:5432/ymmt_dev')
  })

  it('其余键仍按 .env → .dev.vars → .env.local 覆盖', () => {
    write('.env', 'SITE_URL=https://from-env\n')
    write('.dev.vars', 'SITE_URL=https://from-dev-vars\n')

    loadEnvFiles({}, cwd)

    expect(process.env.SITE_URL).toBe('https://from-dev-vars')
  })

  it('以文件为准，Bun 预注入的旧值挡不住后面的文件', () => {
    process.env.DATABASE_URL = 'postgres://bun-injected/db'
    write('.env', 'DATABASE_URL=postgres://online/db\n')
    write('.env.local', 'LOCAL=1\nDATABASE_URL=postgres://postgres@localhost:5432/ymmt_dev\n')

    loadEnvFiles({}, cwd)

    expect(process.env.DATABASE_URL).toBe('postgres://postgres@localhost:5432/ymmt_dev')
  })
})
