import { Gamepad2, MessageCircle, Music, Sparkles } from "lucide-react";
import type { ContentTypeKey } from "@/lib/classify";
import { cn } from "@/lib/utils";

interface ContentTypeIconProps {
  kind: ContentTypeKey;
  className?: string;
}

export function ContentTypeIcon({ kind, className }: ContentTypeIconProps) {
  const Icon = kind === "sing"
    ? Music
    : kind === "game"
      ? Gamepad2
      : kind === "event"
        ? Sparkles
        : MessageCircle;

  return <Icon aria-hidden="true" className={cn("size-4 shrink-0", className)} strokeWidth={1.8} />;
}
