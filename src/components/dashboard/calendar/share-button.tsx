import { Copy, Download, Share2 } from "lucide-react";
import { domToBlob } from "modern-screenshot";
import { useEffect, useRef, useState } from "react";
import { ShareCard } from "@/components/dashboard/calendar/share-card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DayPlan } from "@/types/calendar";

interface ShareButtonProps {
  plan: DayPlan;
  now: Date;
}

export function ShareButton({ plan, now }: ShareButtonProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const filename = `ymmt-schedule-${plan.days[0]?.date ?? "plan"}.png`;

  useEffect(() => {
    if (!open) return;
    let active = true;

    async function generate(): Promise<void> {
      await document.fonts.ready;
      await new Promise<void>(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });

      const node = cardRef.current;
      if (!node) throw new Error("分享卡片未就绪");

      const result = await domToBlob(node, { scale: 1, backgroundColor: null });
      if (!result) throw new Error("导出分享卡片失败");
      if (!active) return;

      setBlob(result);
      setPreview(URL.createObjectURL(result));
    }

    generate()
      .catch(reason => {
        if (active) setError(reason instanceof Error ? reason.message : "生成分享卡片失败");
      })
      .finally(() => {
        if (active) setGenerating(false);
      });

    return () => {
      active = false;
    };
  }, [open, plan, now]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function download(): Promise<void> {
    if (!blob) return;
    setBusy(true);
    setStatus(null);
    try {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus("已导出 PNG");
    }
    finally {
      setBusy(false);
    }
  }

  async function copy(): Promise<void> {
    if (!blob) return;
    setBusy(true);
    setStatus(null);
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setStatus("已复制图片");
    }
    catch {
      setStatus("浏览器不允许复制，请改用下载");
    }
    finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        aria-label="分享直播日程"
        onClick={() => {
          setBlob(null);
          setPreview(null);
          setStatus(null);
          setError(null);
          setGenerating(true);
          setOpen(true);
        }}
        size="icon-sm"
        title="分享卡片"
        variant="ghost"
      >
        <Share2 aria-hidden="true" />
      </Button>

      {open ? (
        <div aria-hidden="true" className="pointer-events-none fixed left-[-2000px] top-0">
          <ShareCard now={now} plan={plan} ref={cardRef} />
        </div>
      ) : null}

      <Dialog
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setGenerating(false);
        }}
        open={open}
      >
        <DialogPopup>
          <DialogHeader className="shrink-0">
            <DialogTitle className="text-lg sm:text-xl">分享直播日程</DialogTitle>
            <DialogDescription className="text-caption sm:text-sm">
              生成一张夢限大みゅーたいぷ的日程卡片。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6">
            {preview
              ? (
                  <a
                    aria-label="在新标签页查看原图"
                    className="block"
                    href={preview}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <img
                      alt="夢限大みゅーたいぷ 直播日程分享卡片"
                      className="w-full rounded-xl border border-hairline bg-muted/30"
                      src={preview}
                    />
                  </a>
                )
              : (
                  <div className="flex h-48 items-center justify-center rounded-xl border border-hairline bg-muted/30 px-6 text-center text-caption text-muted-foreground sm:h-72">
                    {error
                      ? `生成分享卡片失败：${error}`
                      : generating
                        ? "正在生成分享卡片…"
                        : "暂时没有可分享的日程"}
                  </div>
                )}
            {status ? <p className="mt-2 text-caption text-muted-foreground">{status}</p> : null}
          </div>

          <DialogFooter className="shrink-0 max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Button disabled={!blob} loading={busy} onClick={download} size="sm">
              <Download aria-hidden="true" />
              下载 PNG
            </Button>
            <Button disabled={!blob} loading={busy} onClick={copy} size="sm" variant="outline">
              <Copy aria-hidden="true" />
              复制图片
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
