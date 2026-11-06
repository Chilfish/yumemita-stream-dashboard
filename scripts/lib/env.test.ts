import { describe, expect, it } from 'vitest'
import { parseEnvContent } from './env.ts'

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
