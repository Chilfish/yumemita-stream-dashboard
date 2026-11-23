import { describe, expect, it } from 'vitest'
import { runPool } from '@scripts/lib/pool.ts'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('runPool', () => {
  it('空列表直接返回，不启动任何任务', async () => {
    let calls = 0
    const result = await runPool([], 4, async () => {
      calls += 1
    })
    expect(calls).toBe(0)
    expect(result).toEqual({ total: 0, succeeded: 0, failed: 0, failures: [] })
  })

  it('并发不超过上限', async () => {
    let inFlight = 0
    let peak = 0
    const items = Array.from({ length: 20 }, (_, index) => index)

    await runPool(items, 3, async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await sleep(5)
      inFlight -= 1
    })

    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(1)
  })

  it('单项失败不中断其余项，并汇总失败 key 与错误', async () => {
    const seen: number[] = []
    const result = await runPool([1, 2, 3, 4], 2, async (item) => {
      seen.push(item)
      if (item === 2)
        throw new Error(`boom-${item}`)
    })

    expect(seen.sort()).toEqual([1, 2, 3, 4])
    expect(result.succeeded).toBe(3)
    expect(result.failed).toBe(1)
    expect(result.failures).toEqual([{ key: '1', error: 'boom-2' }])
  })

  it('默认按数组下标做 key，不依赖条目的可序列化形式', async () => {
    const items = [new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])]
    const result = await runPool(items, 2, async () => {
      throw new Error('nope')
    })

    expect(result.failures.map(failure => failure.key).sort()).toEqual(['0', '1'])
  })

  it('支持自定义 key 并回调每项失败', async () => {
    const notified: string[] = []
    const result = await runPool(['a', 'b'], 2, async (item) => {
      if (item === 'b')
        throw new Error('bad b')
    }, {
      key: item => `key-${item}`,
      onFailure: failure => notified.push(`${failure.key}:${failure.error}`),
    })

    expect(result.failures).toEqual([{ key: 'key-b', error: 'bad b' }])
    expect(notified).toEqual(['key-b:bad b'])
  })

  it('retries 会在失败后重试到成功', async () => {
    const attempts = new Map<number, number>()
    const result = await runPool([1, 2], 1, async (item) => {
      const used = (attempts.get(item) ?? 0) + 1
      attempts.set(item, used)
      if (item === 1 && used < 2)
        throw new Error('flaky')
    }, { retries: 1 })

    expect(result.succeeded).toBe(2)
    expect(result.failed).toBe(0)
    expect(attempts.get(1)).toBe(2)
  })
})
