import { Play } from "lucide-react";
import { useState } from "react";
import { thumbnailSrcSet, thumbnailUrl } from "@/lib/data";
import { cn } from "@/lib/utils";

export interface StreamCoverProps {
  datasetId: string;
  videoId: string;
  /** 标题在封面旁边已经出现，这里只用于取兜底首字，不参与 `alt`。 */
  title: string;
  /** `null` = 明确没有封面，直接兜底；`undefined` = 未知 / 旧数据，先试图片，失败再兜底。 */
  thumbnail?: string | null;
  className?: string;
  /** 首屏主图：立即加载并设置高优先级；其余一律懒加载。 */
  eager?: boolean;
  /** 布局宽度提示，配合 WebP 变体的 `srcset` 决定下哪一档。 */
  sizes?: string;
}

/**
 * 兜底用的首字：跳过 `【`「『` 这类标题前缀标点，否则封面角落只会出现一个括号。
 */
function firstGlyph(title: string): string {
  return title.replace(/^[^\p{L}\p{N}]+/u, "").charAt(0);
}

/**
 * 16:9 封面。图片失败时永久切到成员色兜底面板，任何情况下都不出现破图。
 * 兜底首字只在大尺寸封面上出现，64×36 的缩略图只留播放字形，避免挤成一团。
 */
export function StreamCover({
  datasetId,
  videoId,
  title,
  thumbnail,
  className,
  eager = false,
  sizes,
}: StreamCoverProps) {
  const src = thumbnail === null ? null : thumbnailUrl(datasetId, videoId);
  const srcSet = thumbnail === null ? null : thumbnailSrcSet(datasetId, videoId);
  // 记失败的 src 而不是布尔值：src 变化时自动恢复尝试，无需额外的 effect。
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  // 变体缺失（旧数据还没重跑 fetch:thumbs）时退回原图，再失败才兜底。
  const [failedSrcSet, setFailedSrcSet] = useState<string | null>(null);
  const useSrcSet = srcSet !== null && failedSrcSet !== src;
  const showImage = src !== null && failedSrc !== src;
  const initial = firstGlyph(title);

  return (
    <div
      className={cn(
        "@container relative aspect-video w-full overflow-hidden border border-hairline bg-member/15",
        "rounded-[var(--cover-radius,var(--radius-panel))]",
        className,
      )}
    >
      {showImage ? (
        <img
          alt=""
          className="size-full object-cover"
          decoding="async"
          fetchPriority={eager ? "high" : undefined}
          loading={eager ? "eager" : "lazy"}
          onError={() => {
            if (useSrcSet) setFailedSrcSet(src);
            else setFailedSrc(src);
          }}
          sizes={sizes}
          src={src}
          srcSet={useSrcSet ? srcSet : undefined}
        />
      ) : (
        <div
          aria-hidden="true"
          className="relative flex size-full items-center justify-center bg-linear-to-br from-member/20 via-member/10 to-member/5"
        >
          <Play
            className="size-4 text-member-ink opacity-60 @[6rem]:size-6"
            strokeWidth={1.5}
          />
          {initial ? (
            <span className="absolute right-1.5 bottom-1 hidden text-caption font-semibold text-member-ink/45 @[6rem]:block">
              {initial}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
