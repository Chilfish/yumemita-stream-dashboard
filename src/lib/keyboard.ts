export interface ShortcutHint {
  keys: string;
  label: string;
}

export const SHORTCUTS: readonly ShortcutHint[] = [
  { keys: "j / k", label: "下一场（更旧）/ 上一场（更新）" },
  { keys: "1–5", label: "切换页面" },
  { keys: "/", label: "聚焦搜索" },
];

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export function streamNeighborIndex(
  currentIndex: number,
  delta: 1 | -1,
  length: number,
): number | null {
  if (!Number.isInteger(length) || length <= 0) return null;
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= length) {
    return null;
  }
  const next = currentIndex + delta;
  return next >= 0 && next < length ? next : null;
}

export function isEditableElement(target: EventTarget | null): boolean {
  if (target == null || typeof target !== "object") return false;
  const candidate = target as { isContentEditable?: unknown; tagName?: unknown };
  if (candidate.isContentEditable === true) return true;
  return typeof candidate.tagName === "string" && EDITABLE_TAGS.has(candidate.tagName.toUpperCase());
}
