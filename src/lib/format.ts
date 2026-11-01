const numberFormat = new Intl.NumberFormat("zh-CN");
const compactFormat = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const decimalFormat = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 2,
});

const JST = "Asia/Tokyo";

function parts(iso: string | null, options: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: JST, ...options }).format(date);
}

export function formatInteger(value: number | null | undefined): string {
  return value == null ? "—" : numberFormat.format(value);
}

export function formatCompact(value: number | null | undefined): string {
  return value == null ? "—" : compactFormat.format(value);
}

export function formatDecimal(value: number | null | undefined): string {
  return value == null ? "—" : decimalFormat.format(value);
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  return value == null ? "—" : `${value.toFixed(digits)}%`;
}

export function formatDate(iso: string | null): string {
  return parts(iso, { month: "2-digit", day: "2-digit" });
}

export function formatFullDate(iso: string | null): string {
  return parts(iso, { year: "numeric", month: "2-digit", day: "2-digit" });
}

export function formatTime(iso: string | null): string {
  return parts(iso, { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatDateTime(iso: string | null): string {
  return parts(iso, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDateTimeSeconds(iso: string | null): string {
  return parts(iso, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatWeekday(iso: string | null): string {
  return parts(iso, { weekday: "short" });
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export function formatDurationLong(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分`;
}

/** 事件时刻 → 开播后秒数，用于跳转 YouTube 对应位置；缺开播时刻时返回 null。 */
export function streamOffsetSeconds(at: string, startedAt: string | null): number | null {
  if (!startedAt) return null;
  const offset = (Date.parse(at) - Date.parse(startedAt)) / 1000;
  return Number.isFinite(offset) ? Math.max(0, Math.round(offset)) : null;
}

const CURRENCY_LABELS: Record<string, string> = {
  "¥": "日元",
  "₩": "韩元",
  "NT$": "新台币",
  "HK$": "港币",
  "$": "美元",
  "MX$": "墨西哥比索",
  "CA$": "加元",
  "C$": "加元",
  "A$": "澳元",
  "SGD": "新加坡元",
  "MYR": "林吉特",
  "THB": "泰铢",
  "IDR": "印尼盾",
  "ARS": "阿根廷比索",
  "R$": "巴西雷亚尔",
  "₱": "菲律宾比索",
  "₪": "以色列谢克尔",
  "₫": "越南盾",
  "€": "欧元",
  "£": "英镑",
};

export function currencyLabel(currency: string): string {
  return CURRENCY_LABELS[currency] ?? currency;
}

export function formatCurrency(currency: string, amount: number): string {
  return `${currency} ${decimalFormat.format(amount)}`;
}

export function formatMinuteOffset(offset: number): string {
  const hours = Math.floor(offset / 60);
  const minutes = offset % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}`;
  return `${minutes} 分`;
}
