const FULL_WIDTH_DIGIT_START = 0xff10;
const ASCII_DIGIT_START = 0x30;
const MINUTES_PER_DAY = 24 * 60;

type Period = "am" | "pm";

const PERIOD_RULES: ReadonlyArray<{ pattern: RegExp; period?: Period }> = [
  { pattern: /凌晨|早上|早晨|上午|a\.m\.|am/i, period: "am" },
  { pattern: /下午|傍晚|晚上|夜里|p\.m\.|pm/i, period: "pm" },
  { pattern: /中午/, period: undefined },
];

/**
 * 把用户输入解析为「当天第几分钟」。
 *
 * 支持 `9`、`930`、`09:30`、`9.30`、`9am`、`12pm`、`下午3点30分`
 * 以及全角数字等写法。无法识别或越界时返回 `null`。
 */
export function parseTime(input: string): number | null {
  let text = input.trim().toLowerCase();
  if (!text) return null;

  let period: Period | undefined;
  for (const rule of PERIOD_RULES) {
    if (!rule.pattern.test(text)) continue;
    period = rule.period;
    text = text.replace(rule.pattern, "");
    break;
  }

  text = text
    .replace(/[\uFF10-\uFF19]/g, char =>
      String.fromCharCode(char.charCodeAt(0) - FULL_WIDTH_DIGIT_START + ASCII_DIGIT_START))
    .replace(/[：:．。.点时時]/g, ":")
    .replace(/分/g, "")
    .replace(/\s+/g, "")
    .replace(/:+$/, "");

  if (!text) return null;

  const match = /^(\d{1,2}):(\d{1,2})$/.exec(text)
    ?? /^(\d{3,4})$/.exec(text)
    ?? /^(\d{1,2})$/.exec(text);
  if (!match) return null;

  const rawHour = match[1] ?? "";
  const rawMinute = match[2];
  let hour: number;
  let minute: number;
  if (rawMinute === undefined && rawHour.length >= 3) {
    hour = Number(rawHour.slice(0, -2));
    minute = Number(rawHour.slice(-2));
  }
  else {
    hour = Number(rawHour);
    minute = Number(rawMinute ?? 0);
  }

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (minute > 59) return null;
  if (period) {
    if (hour < 1 || hour > 12) return null;
  }
  else if (hour > 23) {
    return null;
  }

  if (period === "am") hour %= 12;
  if (period === "pm") hour = (hour % 12) + 12;

  return hour * 60 + minute;
}

/**
 * 把「当天第几分钟」格式化为 `HH:mm`，`hour12` 为真时输出 `h:mm AM/PM`。
 */
export function formatTime(minutes: number, hour12 = false): string {
  const total = Math.round(minutes) % MINUTES_PER_DAY;
  const normalized = total < 0 ? total + MINUTES_PER_DAY : total;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;

  if (!hour12) return `${pad(hour)}:${pad(minute)}`;

  const period = hour < 12 ? "AM" : "PM";
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${pad(minute)} ${period}`;
}

/**
 * 把任意可识别的输入规范化为 `HH:mm`，无法识别时返回 `null`。
 */
export function normalizeTime(input: string): string | null {
  const minutes = parseTime(input);
  return minutes === null ? null : formatTime(minutes);
}

/**
 * 按 `step` 分钟步进，跨过午夜时自动回绕到当天。
 */
export function stepTime(
  minutes: number,
  step: number,
  direction: 1 | -1,
): number {
  const size = Math.max(1, Math.round(step));
  const total = minutes + size * direction;
  return ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * 将分钟间隔规范为能整除 60 的值，非法或非整除时回退到 10。
 */
export function normalizeMinuteStep(step: number): number {
  const rounded = Math.round(step);
  if (rounded < 1 || rounded > 60) return 10;
  return 60 % rounded === 0 ? rounded : 10;
}

/**
 * 生成一小时内按间隔排列的分钟选项，如 `00`、`10`、`20`、`30`。
 */
export function createMinuteOptions(step = 10): string[] {
  const size = normalizeMinuteStep(step);
  const options: string[] = [];
  for (let minute = 0; minute < 60; minute += size) {
    options.push(pad(minute));
  }
  return options;
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
