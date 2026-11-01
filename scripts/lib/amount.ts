/**
 * Super Chat / 贴纸的 `purchaseAmountText` → 币种 + 数值。
 *
 * YouTube 按区域输出不同前缀（`¥` / `HK$` / `MX$` / `SGD` / `₫` …），
 * 这里不维护币种白名单：第一个数字之前的部分就是币种，后面按
 * `1,234.56` 解析。认不出来时返回 `null`，调用方按「没有金额」处理。
 */
const AMOUNT_NUMBER_RE = /^\d[\d,]*(?:\.\d+)?$/

export interface ParsedAmount {
  currency: string
  amount: number
}

export function parseAmount(text: string | null | undefined): ParsedAmount | null {
  if (!text)
    return null
  const value = text.trim()
  const digits = value.search(/\d/)
  // 前缀必须是币种符号/代码；数字开头（没有币种）或后缀式（`5,00 €`）都不猜。
  if (digits <= 0)
    return null
  const currency = value.slice(0, digits).trim()
  const raw = value.slice(digits).replace(/\s+/g, '')
  if (!currency || !AMOUNT_NUMBER_RE.test(raw))
    return null
  return { currency, amount: Number(raw.replace(/,/g, '')) }
}
