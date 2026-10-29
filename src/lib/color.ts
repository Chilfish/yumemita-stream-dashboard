import type { Theme } from "@/hooks/use-theme";

const LIGHT_BACKGROUND = "#f4f4f6";
const DARK_BACKGROUND = "#161617";

function parseHex(hex: string): [number, number, number] | null {
  const value = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(value)) {
    return [...value].map(char => Number.parseInt(`${char}${char}`, 16)) as [
      number,
      number,
      number,
    ];
  }
  if (/^[0-9a-f]{6}$/i.test(value)) {
    return [0, 2, 4].map(offset => Number.parseInt(value.slice(offset, offset + 2), 16)) as [
      number,
      number,
      number,
    ];
  }
  return null;
}

function toLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function toSrgb(value: number): number {
  const channel = value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(channel * 255);
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
}

function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [light, dark] = a > b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

function mix(hex: string, target: string, amount: number): string {
  const source = parseHex(hex);
  const destination = parseHex(target);
  if (!source || !destination) return hex;
  const channels = source.map((channel, index) => {
    const from = toLinear(channel);
    const to = toLinear(destination[index]);
    return toSrgb(from + (to - from) * amount);
  }) as [number, number, number];
  return toHex(channels);
}

/** 在原色不满足对比度时，向黑/白混合到刚好达标，作为文字与图表强调色。 */
export function ensureContrast(hex: string, background: string, min = 4.5): string {
  if (!parseHex(hex)) return hex;
  if (contrastRatio(hex, background) >= min) return hex;

  const black = contrastRatio("#000000", background);
  const white = contrastRatio("#ffffff", background);
  const target = black > white ? "#000000" : "#ffffff";

  let low = 0;
  let high = 1;
  let result = hex;
  for (let step = 0; step < 20; step += 1) {
    const amount = (low + high) / 2;
    const candidate = mix(hex, target, amount);
    if (contrastRatio(candidate, background) >= min) {
      result = candidate;
      high = amount;
    } else {
      low = amount;
    }
  }
  return result;
}

export function memberAccent(hex: string, theme: Theme, min = 4.5): string {
  return ensureContrast(hex, theme === "dark" ? DARK_BACKGROUND : LIGHT_BACKGROUND, min);
}

/** 成员色作背景时，选择黑或白前景，避免黄底白字。 */
export function readableOn(hex: string): string {
  return contrastRatio(hex, "#ffffff") >= 4.5 ? "#ffffff" : "#1b1b1d";
}
