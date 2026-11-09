import { isSubtitleMode, type SubtitleMode } from "./transcripts";

const LAST_MEMBER_KEY = "yumemita-dashboard-last-member";
const SUBTITLE_MODE_KEY = "yumemita-dashboard-subtitle-mode";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readLastMember(): string | null {
  try {
    return storage()?.getItem(LAST_MEMBER_KEY) ?? null;
  } catch {
    return null;
  }
}

export function rememberMember(datasetId: string): void {
  try {
    storage()?.setItem(LAST_MEMBER_KEY, datasetId);
  } catch {
    // 隐私模式下 localStorage 可能不可写，记住入口只是增强，不影响页面。
  }
}

/** 附录字幕默认只看中文：这是主要读者的阅读方式，也少渲染一半正文。 */
export function readSubtitleMode(): SubtitleMode {
  try {
    const value = storage()?.getItem(SUBTITLE_MODE_KEY);
    return isSubtitleMode(value) ? value : "zh";
  } catch {
    return "zh";
  }
}

export function rememberSubtitleMode(mode: SubtitleMode): void {
  try {
    storage()?.setItem(SUBTITLE_MODE_KEY, mode);
  } catch {
    // 同上：记不住偏好不影响页面。
  }
}
