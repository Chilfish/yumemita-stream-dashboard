import { describe, expect, it } from "vitest";
import { SHORTCUTS, isEditableElement, streamNeighborIndex } from "./keyboard";

describe("streamNeighborIndex", () => {
  it("moves to the older neighbour with delta 1", () => {
    expect(streamNeighborIndex(0, 1, 3)).toBe(1);
    expect(streamNeighborIndex(1, 1, 3)).toBe(2);
  });

  it("moves to the newer neighbour with delta -1", () => {
    expect(streamNeighborIndex(2, -1, 3)).toBe(1);
    expect(streamNeighborIndex(1, -1, 3)).toBe(0);
  });

  it("clamps at both ends", () => {
    expect(streamNeighborIndex(0, -1, 3)).toBeNull();
    expect(streamNeighborIndex(2, 1, 3)).toBeNull();
  });

  it("returns null for empty and single-row datasets", () => {
    expect(streamNeighborIndex(0, 1, 0)).toBeNull();
    expect(streamNeighborIndex(0, -1, 0)).toBeNull();
    expect(streamNeighborIndex(0, 1, 1)).toBeNull();
    expect(streamNeighborIndex(0, -1, 1)).toBeNull();
  });

  it("rejects out-of-range or non-integer indexes", () => {
    expect(streamNeighborIndex(-1, 1, 3)).toBeNull();
    expect(streamNeighborIndex(3, 1, 3)).toBeNull();
    expect(streamNeighborIndex(1.5, 1, 3)).toBeNull();
    expect(streamNeighborIndex(1, 1, Number.NaN)).toBeNull();
  });
});

describe("isEditableElement", () => {
  it("detects form controls by tag name", () => {
    expect(isEditableElement({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isEditableElement({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isEditableElement({ tagName: "SELECT" } as unknown as EventTarget)).toBe(true);
    expect(isEditableElement({ tagName: "input" } as unknown as EventTarget)).toBe(true);
  });

  it("detects contenteditable elements", () => {
    expect(
      isEditableElement({ isContentEditable: true, tagName: "DIV" } as unknown as EventTarget),
    ).toBe(true);
  });

  it("returns false for non-editable, null and window-like targets", () => {
    expect(isEditableElement({ tagName: "DIV" } as unknown as EventTarget)).toBe(false);
    expect(isEditableElement({ isContentEditable: false } as unknown as EventTarget)).toBe(false);
    expect(isEditableElement({} as unknown as EventTarget)).toBe(false);
    expect(isEditableElement(new EventTarget())).toBe(false);
    expect(isEditableElement(null)).toBe(false);
  });
});

describe("SHORTCUTS", () => {
  it("lists the three bindings in display order", () => {
    expect(SHORTCUTS.map(shortcut => shortcut.keys)).toEqual(["j / k", "1–5", "/"]);
    expect(SHORTCUTS.map(shortcut => shortcut.label)).toEqual([
      "下一场（更旧）/ 上一场（更新）",
      "切换页面",
      "聚焦搜索",
    ]);
  });
});
