"use client";

import { useEffect, useState } from "react";
import { LiveChatPreview } from "@/components/dev/live-chat-preview";
import type { PreviewData } from "@/lib/live-chat-preview";

/**
 * 开发预览的数据加载壳：实际文件读取由 `astro.config.mjs` 里的 Vite 中间件完成
 * （workerd 里没有真实文件系统），这里只负责请求与 loading / error 状态。
 */
export function LiveChatPreviewLoader({ initialSession }: { initialSession: string | null }) {
  const [data, setData] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const session =
      new URLSearchParams(window.location.search).get("session") ?? initialSession;
    const query = session ? `?session=${encodeURIComponent(session)}` : "";

    fetch(`/dev/live-chat-data${query}`, { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as PreviewData;
      })
      .then(payload => {
        if (!cancelled) setData(payload);
      })
      .catch(caught => {
        if (cancelled) return;
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : String(caught));
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [initialSession]);

  if (error) {
    return (
      <div className="min-h-dvh bg-background p-8">
        <p className="text-footnote text-destructive">读取失败：{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-dvh bg-background p-8">
        <p className="text-footnote text-ink-3">正在读取 live chat 预览数据…</p>
      </div>
    );
  }

  return <LiveChatPreview data={data} />;
}
