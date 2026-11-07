import { Check, Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

const RESET_DELAY_MS = 2000;

interface CopyLinkButtonProps {
  className?: string;
  label?: string;
}

function copyWithTextarea(text: string): boolean {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);

  try {
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

function copyText(text: string): Promise<boolean> {
  const clipboard = navigator.clipboard;
  if (clipboard && typeof clipboard.writeText === "function") {
    return clipboard.writeText(text).then(
      () => true,
      () => copyWithTextarea(text),
    );
  }
  return Promise.resolve(copyWithTextarea(text));
}

export function CopyLinkButton({ className, label = "复制链接" }: CopyLinkButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const handleCopy = () => {
    copyText(window.location.href)
      .then(success => {
        if (!success || !mountedRef.current) {
          return;
        }
        setCopied(true);
        if (timerRef.current != null) {
          window.clearTimeout(timerRef.current);
        }
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          if (mountedRef.current) {
            setCopied(false);
          }
        }, RESET_DELAY_MS);
      })
      .catch(() => undefined);
  };

  return (
    <>
      <Button
        className={className}
        onClick={handleCopy}
        size="sm"
        type="button"
        variant="outline"
      >
        {copied ? <Check aria-hidden="true" /> : <Link2 aria-hidden="true" />}
        {copied ? "已复制" : label}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? "链接已复制到剪贴板" : ""}
      </span>
    </>
  );
}
