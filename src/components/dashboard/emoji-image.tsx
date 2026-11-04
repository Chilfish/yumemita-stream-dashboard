import { useState, type ReactNode } from "react";
import { emojiUrl } from "@/lib/media";
import { isCustomEmojiId } from "@/lib/emoji";

interface EmojiImageProps {
  datasetId: string;
  emojiId: string;
  name?: string | null;
  fallback?: ReactNode;
  className?: string;
}

export function EmojiImage({
  datasetId,
  emojiId,
  name,
  fallback,
  className,
}: EmojiImageProps) {
  const [failed, setFailed] = useState(false);
  const url = emojiUrl(datasetId, emojiId);

  if (!url || failed) {
    return (
      <span className="inline-flex items-center whitespace-nowrap" title={name ?? emojiId}>
        {fallback ?? name ?? (isCustomEmojiId(emojiId) ? "[表情]" : emojiId)}
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
