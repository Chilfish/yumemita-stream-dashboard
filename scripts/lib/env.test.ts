import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadEnvFiles, parseEnvContent, readEnvFile } from './env.ts'

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

describe('readEnvFile', () => {
  it('只解析指定文件，不读取同目录的其它 env 文件', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'env-read-'))
    try {
      writeFileSync(join(cwd, '.dev.vars'), 'A=from-dev-vars\n', 'utf8')
      writeFileSync(join(cwd, '.env'), 'A=from-env\n', 'utf8')

      expect(readEnvFile(join(cwd, '.dev.vars'))).toEqual({ A: 'from-dev-vars' })
    }
    finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})

describe('loadEnvFiles', () => {
  const KEYS = ['LOCAL', 'DATABASE_URL', 'DATABASE_URL_ONLINE', 'NEON_HTTP_ENDPOINT', 'SITE_URL', 'PUBLIC_R2_BASE']
  const saved: Record<string, string | undefined> = {}
  let cwd: string

  function write(content: string): void {
    writeFileSync(join(cwd, '.dev.vars'), content, 'utf8')
  }

  beforeEach(() => {
    for (const key of KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
    cwd = mkdtempSync(join(tmpdir(), 'env-files-'))
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    rmSync(cwd, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('本地模式：用文件里的普通键，忽略 *_ONLINE', () => {
    write([
      'LOCAL=1',
      'DATABASE_URL=postgres://postgres@localhost:5432/ymmt_dev',
      'DATABASE_URL_ONLINE=postgres://neon/db',
      'SITE_URL=https://ymmt.chilfish.top',
      '',
    ].join('\n'))

    loadEnvFiles({ cwd })

    expect(process.env.DATABASE_URL).toBe('postgres://postgres@localhost:5432/ymmt_dev')
    expect(process.env.DATABASE_URL_ONLINE).toBeUndefined()
    expect(process.env.SITE_URL).toBe('https://ymmt.chilfish.top')
    expect(process.env.NEON_HTTP_ENDPOINT).toBe('http://127.0.0.1:4444/sql')
  })

  it('线上模式：*_ONLINE 替换同名键，开关不残留', () => {
    write([
      'LOCAL=0',
      'DATABASE_URL=postgres://postgres@localhost:5432/ymmt_dev',
      'DATABASE_URL_ONLINE=postgres://neon/db',
      '',
    ].join('\n'))

    loadEnvFiles({ cwd })

    expect(process.env.DATABASE_URL).toBe('postgres://neon/db')
    expect(process.env.DATABASE_URL_ONLINE).toBeUndefined()
  })

  it('线上模式但没写 *_ONLINE：清掉本机地址并提示', () => {
    write('LOCAL=0\nDATABASE_URL=postgres://postgres@localhost:5432/ymmt_dev\n')

    loadEnvFiles({ cwd })

    expect(process.env.DATABASE_URL).toBeUndefined()
    expect(console.warn).toHaveBeenCalled()
  })

  it('运行环境设的 LOCAL 压过文件，留空的 *_ONLINE 不覆盖', () => {
    process.env.LOCAL = '1'
    write('LOCAL=0\nDATABASE_URL=postgres://postgres@localhost:5432/ymmt_dev\nDATABASE_URL_ONLINE=\n')

    loadEnvFiles({ cwd })

    expect(process.env.LOCAL).toBe('1')
    expect(process.env.DATABASE_URL).toBe('postgres://postgres@localhost:5432/ymmt_dev')
  })

  it('文件只补缺失的键：运行环境里的同名变量优先', () => {
    process.env.DATABASE_URL = 'postgres://from-cli/db'
    write('LOCAL=0\nDATABASE_URL=postgres://postgres@localhost:5432/ymmt_dev\nDATABASE_URL_ONLINE=postgres://neon/db\n')

    loadEnvFiles({ cwd })

    expect(process.env.DATABASE_URL).toBe('postgres://from-cli/db')
  })

  it('没有 .dev.vars 时只保留运行环境里的值', () => {
    process.env.SITE_URL = 'https://from-process'

    loadEnvFiles({ cwd })

    expect(process.env.SITE_URL).toBe('https://from-process')
    expect(process.env.DATABASE_URL).toBeUndefined()
  })
})
