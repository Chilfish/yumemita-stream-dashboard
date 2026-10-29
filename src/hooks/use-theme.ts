import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";

export type Theme = "light" | "dark";

const STORAGE_KEY = "yumemita-dashboard-theme";
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // 类名与存储必须和 React 状态在同一次绘制里落地，否则 View Transition 抓到的是旧快照。
  const apply = useCallback((next: Theme) => {
    document.documentElement.classList.toggle("dark", next === "dark");
    window.localStorage.setItem(STORAGE_KEY, next);
    flushSync(() => setTheme(next));
  }, []);

  const toggle = useCallback(() => {
    // 以 DOM 为准：快速连点时按钮读到的永远是按下的真实状态。
    const next: Theme = document.documentElement.classList.contains("dark") ? "light" : "dark";
    const startViewTransition =
      typeof document.startViewTransition === "function"
        ? document.startViewTransition.bind(document)
        : null;

    if (!startViewTransition || window.matchMedia(REDUCED_MOTION).matches) {
      apply(next);
      return;
    }

    // 整页快照交叉淡入：颜色是唯一变化，所以只看得见配色在换，布局不动。
    startViewTransition(() => apply(next));
  }, [apply]);

  return { theme, setTheme, toggle };
}
