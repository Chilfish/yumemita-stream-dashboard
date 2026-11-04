import { describe, expect, it } from 'vitest'
import { jsonEqual } from './json-equal.ts'

describe('jsonEqual', () => {
  it('ignores object key order', () => {
    expect(jsonEqual({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })).toBe(true)
  })

  it('keeps array order significant', () => {
    expect(jsonEqual([1, 2, 3], [1, 2, 3])).toBe(true)
    expect(jsonEqual([1, 2, 3], [3, 2, 1])).toBe(false)
  })

  it('compares nested arrays and nulls', () => {
    expect(jsonEqual({ rows: [{ x: 1 }], empty: null }, { empty: null, rows: [{ x: 1 }] })).toBe(
      true,
    )
    expect(jsonEqual({ rows: [{ x: 1 }] }, { rows: [{ x: 2 }] })).toBe(false)
    expect(jsonEqual(null, undefined)).toBe(false)
  })

  it('tolerates floating point noise', () => {
    expect(jsonEqual({ value: 0.1 + 0.2 }, { value: 0.3 })).toBe(true)
    expect(jsonEqual({ value: 1 }, { value: 1.001 })).toBe(false)
  })

  it('rejects different shapes', () => {
    expect(jsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(jsonEqual([1], { 0: 1 })).toBe(false)
  })
})
