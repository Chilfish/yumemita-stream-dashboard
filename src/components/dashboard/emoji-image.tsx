import { useState, type ReactNode } from "react";
import { emojiUrl } from "@/lib/data";

interface EmojiImageProps {
  datasetId: string;
  emojiId: string;
  name?: string | null;
  /** 这张表情是否有可用的镜像图（来自 pack 的 `chat.emojis`）。 */
  known?: boolean;
  fallback?: ReactNode;
  className?: string;
}

export function EmojiImage({
  datasetId,
  emojiId,
  name,
  known = true,
  fallback,
  className,
}: EmojiImageProps) {
  const [failed, setFailed] = useState(false);
  const url = emojiUrl(datasetId, emojiId);

  if (!known || !url || failed) {
    return (
      <span className={className} title={name ?? emojiId}>
        {fallback ?? name ?? emojiId}
      </span>
    );
  }

  return (
    <img
      alt={name ?? ""}
      className={className}
      decoding="async"
      loading="lazy"
      onError={() => setFailed(true)}
      src={url}
      title={name ?? undefined}
    />
  );
}
