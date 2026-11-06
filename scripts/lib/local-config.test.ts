import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_LOCAL_ACCESS_KEY,
  DEFAULT_LOCAL_BUCKET,
  DEFAULT_LOCAL_DATABASE_URL,
  DEFAULT_LOCAL_ENDPOINT,
  DEFAULT_LOCAL_PROXY_ENDPOINT,
  describeEnvironment,
  isLocalMode,
  isLocalUrl,
  localBucket,
  localEndpoint,
  localPublicBase,
  publishStatePath,
} from './local-config.ts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isLocalMode', () => {
  it('识别 1 / true / yes，大小写与空白不敏感', () => {
    for (const value of ['1', 'true', 'TRUE', ' yes ']) {
      vi.stubEnv('LOCAL', value)
      expect(isLocalMode()).toBe(true)
    }
  })

  it('未设置或其它值视为关闭', () => {
    vi.stubEnv('LOCAL', '')
    expect(isLocalMode()).toBe(false)
    vi.stubEnv('LOCAL', '0')
    expect(isLocalMode()).toBe(false)
  })
})

describe('本地地址', () => {
  it('默认指向 SILO 的 path-style 地址', () => {
    expect(localEndpoint()).toBe(DEFAULT_LOCAL_ENDPOINT)
    expect(localBucket()).toBe(DEFAULT_LOCAL_BUCKET)
    expect(localPublicBase()).toBe(`${DEFAULT_LOCAL_ENDPOINT}/${DEFAULT_LOCAL_BUCKET}`)
  })

  it('S3_ENDPOINT 覆盖端点并去掉尾部斜杠', () => {
    vi.stubEnv('S3_ENDPOINT', 'http://127.0.0.1:9100/')
    expect(localEndpoint()).toBe('http://127.0.0.1:9100')
    expect(localPublicBase()).toBe('http://127.0.0.1:9100/yumemita-data')
  })

  it('R2_BUCKET 覆盖本地桶名', () => {
    vi.stubEnv('R2_BUCKET', 'dev-bucket')
    expect(localBucket()).toBe('dev-bucket')
  })

  it('默认凭据与 SILO 启动参数一致', () => {
    expect(DEFAULT_LOCAL_ACCESS_KEY).toBe('silo-admin')
  })

  it('数据库与代理有本地默认值', () => {
    expect(DEFAULT_LOCAL_DATABASE_URL).toContain('localhost:5432')
    expect(DEFAULT_LOCAL_PROXY_ENDPOINT).toContain('127.0.0.1')
  })
})

describe('isLocalUrl', () => {
  it('只把 localhost / 127.0.0.1 / ::1 当本机', () => {
    expect(isLocalUrl('postgres://postgres@localhost:5432/ymmt_dev')).toBe(true)
    expect(isLocalUrl('http://127.0.0.1:9000')).toBe(true)
    expect(isLocalUrl('http://[::1]:9000')).toBe(true)
    expect(isLocalUrl('postgres://user@ep-xxx.neon.tech/db')).toBe(false)
    expect(isLocalUrl(undefined)).toBe(false)
    expect(isLocalUrl('not a url')).toBe(false)
  })
})

describe('describeEnvironment', () => {
  it('本地模式列出本机数据库与 SILO 地址', () => {
    expect(describeEnvironment({
      LOCAL: '1',
      DATABASE_URL: 'postgres://postgres@localhost:5432/ymmt_dev',
    })).toBe('本地模式（LOCAL=1） · 数据库 localhost:5432/ymmt_dev · 对象存储 http://127.0.0.1:9000/yumemita-data')
  })

  it('本地模式下即使环境里是远程库，也显示实际会用的本机库', () => {
    expect(describeEnvironment({
      LOCAL: '1',
      DATABASE_URL: 'postgres://user:secret@ep-xxx.neon.tech/neondb',
    })).toBe('本地模式（LOCAL=1） · 数据库 localhost:5432/ymmt_dev · 对象存储 http://127.0.0.1:9000/yumemita-data')
  })

  it('线上模式显示桶与前缀，不泄露账号密码', () => {
    const text = describeEnvironment({
      DATABASE_URL: 'postgres://user:secret@ep-xxx.neon.tech/neondb',
      R2_BUCKET: 'yumemita-data',
      R2_PREFIX: '/prod/',
    })
    expect(text).toBe('线上模式 · 数据库 ep-xxx.neon.tech/neondb · 对象存储 R2 yumemita-data/prod')
    expect(text).not.toContain('secret')
  })

  it('没配置的部分直接省略', () => {
    expect(describeEnvironment({})).toBe('线上模式')
  })
})

describe('publishStatePath', () => {
  it('本地与线上使用独立的进度文件', () => {
    const root = 'C:/repo'
    vi.stubEnv('LOCAL', '1')
    expect(publishStatePath(root)).toMatch(/\.publish-state\.local\.json$/)
    vi.stubEnv('LOCAL', '')
    expect(publishStatePath(root)).toMatch(/\.publish-state\.json$/)
  })
})
