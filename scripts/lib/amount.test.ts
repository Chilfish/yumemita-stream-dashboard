import { describe, expect, it } from 'vitest'
import { parseAmount } from './amount'

describe('parseAmount', () => {
  it('parses every currency prefix seen in archived chats', () => {
    expect(parseAmount('¥1,000')).toEqual({ currency: '¥', amount: 1000 })
    expect(parseAmount('HK$100.00')).toEqual({ currency: 'HK$', amount: 100 })
    expect(parseAmount('NT$135')).toEqual({ currency: 'NT$', amount: 135 })
    expect(parseAmount('$5.00')).toEqual({ currency: '$', amount: 5 })
    expect(parseAmount('€11.00')).toEqual({ currency: '€', amount: 11 })
    expect(parseAmount('MX$50.00')).toEqual({ currency: 'MX$', amount: 50 })
    expect(parseAmount('CA$6.99')).toEqual({ currency: 'CA$', amount: 6.99 })
    expect(parseAmount('A$5.00')).toEqual({ currency: 'A$', amount: 5 })
    expect(parseAmount('SGD 2.00')).toEqual({ currency: 'SGD', amount: 2 })
    expect(parseAmount('MYR 6.00')).toEqual({ currency: 'MYR', amount: 6 })
    expect(parseAmount('THB 179.00')).toEqual({ currency: 'THB', amount: 179 })
    expect(parseAmount('IDR 20,000')).toEqual({ currency: 'IDR', amount: 20000 })
    expect(parseAmount('ARS 5,000.00')).toEqual({ currency: 'ARS', amount: 5000 })
    expect(parseAmount('R$10.00')).toEqual({ currency: 'R$', amount: 10 })
    expect(parseAmount('₫20,000')).toEqual({ currency: '₫', amount: 20000 })
    expect(parseAmount('₱50.00')).toEqual({ currency: '₱', amount: 50 })
    expect(parseAmount('₪6.90')).toEqual({ currency: '₪', amount: 6.9 })
    expect(parseAmount('₩5,000')).toEqual({ currency: '₩', amount: 5000 })
    expect(parseAmount('£8.00')).toEqual({ currency: '£', amount: 8 })
  })

  it('ignores values without a currency prefix or with an unparsable number', () => {
    expect(parseAmount(null)).toBeNull()
    expect(parseAmount('')).toBeNull()
    expect(parseAmount('5.00')).toBeNull()
    expect(parseAmount('5,00 €')).toBeNull()
    expect(parseAmount('¥')).toBeNull()
    expect(parseAmount('¥1.2.3')).toBeNull()
  })
})
