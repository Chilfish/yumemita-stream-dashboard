import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface DatasetSource {
  id: string
  kind?: string
  sync?: 'channel' | 'filtered' | 'manual'
  include?: unknown
}

const CONFIG_PATH = fileURLToPath(new URL('../../data-sources.json', import.meta.url))

function datasets(): DatasetSource[] {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as { datasets?: DatasetSource[] }
  return config.datasets ?? []
}

describe('data-sources.json', () => {
  it('bangdream 走手动添加，不进每日自动更新', () => {
    const bangdream = datasets().find(source => source.id === 'bangdream')
    expect(bangdream).toBeDefined()
    expect(bangdream?.sync).toBe('manual')
    expect(bangdream?.include).toBeUndefined()
  })

  it('每日自动更新只覆盖 channel 账号', () => {
    const auto = datasets()
      .filter(source => (source.sync ?? 'channel') !== 'manual')
      .map(source => source.id)
    expect(auto).toContain('yumemita')
    expect(auto).not.toContain('bangdream')
    expect(auto).not.toContain('other')
  })
})
