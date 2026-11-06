import { describe, expect, it } from 'vitest'
import { isUnchanged, type BodyDigest, type PublishStateEntry } from './publish-state.ts'

const digest: BodyDigest = { sha256: 'abc', size: 10 }
const entry: PublishStateEntry = { sha256: 'abc', size: 10, uploadedAt: '2026-11-06T00:00:00.000Z' }

describe('isUnchanged', () => {
  it('本地摘要一致且远端大小对得上时跳过', () => {
    expect(isUnchanged(entry, digest, new Map([['a', 10]]), 'a')).toBe(true)
  })

  it('摘要一致但远端大小不同时重传', () => {
    expect(isUnchanged(entry, digest, new Map([['a', 11]]), 'a')).toBe(false)
  })

  it('列桶失败时只信本地摘要', () => {
    expect(isUnchanged(entry, digest, null, 'a')).toBe(true)
  })

  it('没有本地记录时按远端大小对齐', () => {
    expect(isUnchanged(undefined, digest, new Map([['a', 10]]), 'a', { adoptRemoteSize: true })).toBe(true)
    expect(isUnchanged(undefined, digest, new Map([['a', 11]]), 'a', { adoptRemoteSize: true })).toBe(false)
    expect(isUnchanged(undefined, digest, null, 'a', { adoptRemoteSize: true })).toBe(false)
  })

  it('已有记录且摘要变化时不按大小跳过', () => {
    const changed: BodyDigest = { sha256: 'def', size: 10 }
    expect(isUnchanged(entry, changed, new Map([['a', 10]]), 'a', { adoptRemoteSize: true })).toBe(false)
  })

  it('远端没有这个对象时重传', () => {
    expect(isUnchanged(undefined, digest, new Map(), 'a', { adoptRemoteSize: true })).toBe(false)
    expect(isUnchanged(entry, digest, new Map(), 'a')).toBe(false)
  })
})
