import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ConfigError } from '@chilfish/devkit/cli'
import { applyOnlineEnv, applyProdEnv, readOnlineTarget } from '@scripts/lib/online-env.ts'
import { devkit } from '@scripts/dev.config.ts'

const REMOTE_URL = 'postgresql://user:pass@ep-test.ap-southeast-1.aws.neon.tech/neondb?sslmode=require'

function makeRepo(base: Record<string, string>, prod?: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ymmt-env-'))
  const toText = (values: Record<string, string>): string =>
    `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`
  writeFileSync(join(dir, '.dev.vars'), toText(base), 'utf8')
  if (prod)
    writeFileSync(join(dir, '.dev.vars.prod'), toText(prod), 'utf8')
  return dir
}

const savedEnv = new Map<string, string | undefined>()

function snapshotEnv(keys: string[]): void {
  for (const key of keys)
    savedEnv.set(key, process.env[key])
}

function restoreEnv(): void {
  for (const [key, value] of savedEnv) {
    if (value === undefined)
      delete process.env[key]
    else process.env[key] = value
  }
  savedEnv.clear()
}

afterEach(restoreEnv)

describe('readOnlineTarget', () => {
  it('优先读 .dev.vars.prod 的 DATABASE_URL', () => {
    const dir = makeRepo(
      { LOCAL: '1', DATABASE_URL: 'postgres://postgres@localhost:5432/ymmt_dev' },
      { DATABASE_URL: REMOTE_URL, R2_BUCKET: 'bucket-prod' },
    )
    const target = readOnlineTarget({ config: devkit, cwd: dir })
    expect(target.databaseUrl).toBe(REMOTE_URL)
    expect(target.bucket).toBe('bucket-prod')
    expect(target.prodFile.endsWith('.dev.vars.prod')).toBe(true)
  })

  it('prod 文件缺失时报配置错误，不静默使用本机地址', () => {
    const dir = makeRepo({ LOCAL: '1', DATABASE_URL: 'postgres://postgres@localhost:5432/ymmt_dev' })
    expect(() => readOnlineTarget({ config: devkit, cwd: dir })).toThrow(ConfigError)
  })

  it('prod 里指向本机时直接拒绝', () => {
    const dir = makeRepo(
      { LOCAL: '1' },
      { DATABASE_URL: 'postgres://postgres@localhost:5432/ymmt_dev' },
    )
    expect(() => readOnlineTarget({ config: devkit, cwd: dir })).toThrow(/本机/)
  })

  it('进程环境里的非本机 DATABASE_URL 可作为兜底', () => {
    const dir = makeRepo({ LOCAL: '1' })
    snapshotEnv(['DATABASE_URL'])
    process.env.DATABASE_URL = REMOTE_URL
    expect(readOnlineTarget({ config: devkit, cwd: dir }).databaseUrl).toBe(REMOTE_URL)
  })
})

describe('applyOnlineEnv', () => {
  it('切到线上：设置 LOCAL=0、改用线上地址、清掉本机端点，并能恢复', () => {
    const dir = makeRepo(
      { LOCAL: '1', NEON_HTTP_ENDPOINT: 'http://127.0.0.1:4444/sql', R2_BUCKET: 'local-bucket' },
      { DATABASE_URL: REMOTE_URL, R2_BUCKET: 'remote-bucket' },
    )
    snapshotEnv(['LOCAL', 'DATABASE_URL', 'NEON_HTTP_ENDPOINT', 'R2_BUCKET'])
    process.env.LOCAL = '1'
    process.env.NEON_HTTP_ENDPOINT = 'http://127.0.0.1:4444/sql'

    const restore = applyOnlineEnv({ config: devkit, target: readOnlineTarget({ config: devkit, cwd: dir }) })
    expect(process.env.LOCAL).toBe('0')
    expect(process.env.DATABASE_URL).toBe(REMOTE_URL)
    expect(process.env.NEON_HTTP_ENDPOINT).toBeUndefined()
    expect(process.env.R2_BUCKET).toBe('remote-bucket')

    restore()
    expect(process.env.LOCAL).toBe('1')
    expect(process.env.NEON_HTTP_ENDPOINT).toBe('http://127.0.0.1:4444/sql')
  })
})

describe('applyProdEnv', () => {
  it('覆盖已加载的本机值：LOCAL=0、进程里的本机 DATABASE_URL 被 prod 顶替', () => {
    const dir = makeRepo(
      { LOCAL: '1', DATABASE_URL: 'postgres://postgres@localhost:5432/ymmt_dev', PUBLIC_R2_BASE: 'http://127.0.0.1:9000/bucket' },
      { DATABASE_URL: REMOTE_URL, PUBLIC_R2_BASE: 'https://cdn.example.com' },
    )
    snapshotEnv(['LOCAL', 'DATABASE_URL', 'PUBLIC_R2_BASE', 'NEON_HTTP_ENDPOINT'])
    // 模拟 CLI 已按本地模式加载过：进程里是本地值。
    process.env.LOCAL = '1'
    process.env.DATABASE_URL = 'postgres://postgres@localhost:5432/ymmt_dev'
    process.env.PUBLIC_R2_BASE = 'http://127.0.0.1:9000/bucket'
    process.env.NEON_HTTP_ENDPOINT = 'http://127.0.0.1:4444/sql'

    const result = applyProdEnv({ config: devkit, cwd: dir })
    expect(result.prodFile).toBe(true)
    expect(result.databaseLocal).toBe(false)
    expect(process.env.LOCAL).toBe('0')
    expect(process.env.DATABASE_URL).toBe(REMOTE_URL)
    expect(process.env.PUBLIC_R2_BASE).toBe('https://cdn.example.com')
    expect(process.env.NEON_HTTP_ENDPOINT).toBeUndefined()
  })

  it('没有 prod 文件时保留进程环境，只报告 DATABASE_URL 仍是本机', () => {
    const dir = makeRepo({ LOCAL: '1', DATABASE_URL: 'postgres://postgres@localhost:5432/ymmt_dev' })
    snapshotEnv(['LOCAL', 'DATABASE_URL'])

    const result = applyProdEnv({ config: devkit, cwd: dir })
    expect(result.prodFile).toBe(false)
    expect(result.databaseLocal).toBe(true)
    expect(process.env.LOCAL).toBe('0')
  })
})
