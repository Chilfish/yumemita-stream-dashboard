import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import {
  isCommandPaletteShortcut,
  isEditableElement,
  streamNeighborIndex,
} from "@/lib/keyboard";
import { VIEWS, sectionFromPathname, streamPath, viewPath } from "@/lib/routes";
import type { StreamSummary } from "@/types/dataset";

interface UseKeyboardShortcutsOptions {
  datasetId: string | null;
  rows: StreamSummary[];
  onCommandPalette?: () => void;
}

const VIEW_KEYS = ["1", "2", "3", "4", "5"] as const;

const SEARCH_SELECTOR = 'input[type="search"], [aria-label="搜索直播"]';

function videoIdFromPathname(pathname: string): string | null {
  if (sectionFromPathname(pathname) !== "stream") return null;
  const segment = pathname.split("/")[3];
  if (!segment) return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function firstVisibleSearchInput(): HTMLInputElement | null {
  for (const element of document.querySelectorAll<HTMLElement>(SEARCH_SELECTOR)) {
    if (element instanceof HTMLInputElement && element.offsetParent !== null) return element;
  }
  return null;
}

export function useKeyboardShortcuts({
  datasetId,
  rows,
  onCommandPalette,
}: UseKeyboardShortcutsOptions): void {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented) return;

      if (isCommandPaletteShortcut(event)) {
        if (!datasetId) return;
        event.preventDefault();
        onCommandPalette?.();
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableElement(event.target)) return;
      if (!datasetId) return;

      const viewIndex = VIEW_KEYS.indexOf(event.key as (typeof VIEW_KEYS)[number]);
      if (viewIndex !== -1) {
        if (event.repeat) return;
        event.preventDefault();
        navigate(viewPath(datasetId, VIEWS[viewIndex]));
        return;
      }

      if (event.key === "j" || event.key === "k") {
        if (rows.length === 0) return;
        const currentVideoId = videoIdFromPathname(pathname);
        const currentIndex =
          currentVideoId === null ? -1 : rows.findIndex(row => row.videoId === currentVideoId);

        let nextVideoId: string;
        if (currentIndex === -1) {
          nextVideoId = rows[0].videoId;
        } else {
          const nextIndex = streamNeighborIndex(
            currentIndex,
            event.key === "j" ? 1 : -1,
            rows.length,
          );
          if (nextIndex === null) return;
          nextVideoId = rows[nextIndex].videoId;
        }

        event.preventDefault();
        navigate(streamPath(datasetId, nextVideoId));
        return;
      }

      if (event.key === "/") {
        if (event.repeat) return;
        const input = firstVisibleSearchInput();
        if (!input) return;
        event.preventDefault();
        input.focus();
        input.select();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [datasetId, navigate, onCommandPalette, pathname, rows]);
}
