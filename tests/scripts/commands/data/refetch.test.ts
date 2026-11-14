import { describe, expect, it } from 'vitest'
import { parseVideoRef } from '@scripts/lib/video-ref.ts'
import { UsageError } from '@scripts/lib/cli/exit.ts'

describe('parseVideoRef', () => {
  it('接受裸 11 位视频 ID', () => {
    expect(parseVideoRef('1dGnP_rXgW0')).toBe('1dGnP_rXgW0')
    expect(parseVideoRef('  1dGnP_rXgW0  ')).toBe('1dGnP_rXgW0')
  })

  it('解析 watch?v= 链接（忽略多余参数）', () => {
    expect(parseVideoRef('https://www.youtube.com/watch?v=1dGnP_rXgW0&t=30s')).toBe('1dGnP_rXgW0')
  })

  it('解析 youtu.be / live / shorts / m.youtube.com', () => {
    expect(parseVideoRef('https://youtu.be/1dGnP_rXgW0?si=abc')).toBe('1dGnP_rXgW0')
    expect(parseVideoRef('https://www.youtube.com/live/1dGnP_rXgW0')).toBe('1dGnP_rXgW0')
    expect(parseVideoRef('https://www.youtube.com/shorts/1dGnP_rXgW0')).toBe('1dGnP_rXgW0')
    expect(parseVideoRef('https://m.youtube.com/watch?v=1dGnP_rXgW0')).toBe('1dGnP_rXgW0')
  })

  it('非 YouTube 链接抛用法错误', () => {
    expect(() => parseVideoRef('https://example.com/watch?v=1dGnP_rXgW0')).toThrow(UsageError)
  })

  it('无法解析的输入抛用法错误', () => {
    expect(() => parseVideoRef('not a link')).toThrow(UsageError)
    expect(() => parseVideoRef('https://www.youtube.com/feed/subscriptions')).toThrow(UsageError)
    expect(() => parseVideoRef('https://www.youtube.com/watch?v=short')).toThrow(UsageError)
  })
})
