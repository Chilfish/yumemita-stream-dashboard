const LAST_MEMBER_KEY = "yumemita-dashboard-last-member";

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
