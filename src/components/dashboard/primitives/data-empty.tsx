import { cn } from "@/lib/utils";

export interface DataEmptyProps {
  /** 这个区块是什么、为什么空。 */
  message: string;
  /** 下一步或边界说明；不传则只显示一行。 */
  hint?: string;
  /** 撑住图表原本的高度，避免空态比有数据时矮一截造成跳动。 */
  height?: number;
  className?: string;
}

/**
 * 图表与面板区块内的空态：两行文字、固定高度、不画 0。
 *
 * 页面级空态（带图标、标题与动作）用 `components/ui/empty.tsx` 的 `Empty`；
 * 这里只解决「数据缺失时这一块怎么站位」，不重复那套结构。
 */
export function DataEmpty({ message, hint, height, className }: DataEmptyProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1 px-4 py-10 text-center",
        className,
      )}
      style={height ? { height } : undefined}
    >
      <p className="text-footnote text-muted-foreground">{message}</p>
      {hint ? <p className="max-w-sm text-balance text-caption text-ink-3">{hint}</p> : null}
    </div>
  );
}
