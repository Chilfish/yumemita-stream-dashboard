"use client";

import type React from "react";
import { ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/**
 * 筛选 chip：工具栏与筛选面板共用的一颗可选标签。
 * 按下态一律反相（前景色打底），不跟随成员色，避免和数据色的含义混淆。
 */
const CHIP_CLASS =
  "rounded-full px-2.5 text-footnote text-muted-foreground before:rounded-full hover:text-foreground data-pressed:bg-foreground data-pressed:text-background data-pressed:hover:bg-foreground data-pressed:hover:text-background";

/** 差异项（`gap-1.5`、`min-h-11 md:min-h-6` 这类）由调用方通过 `className` 合进来。 */
export function FilterChip({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupItem>): React.ReactElement {
  return <ToggleGroupItem className={cn(CHIP_CLASS, className)} {...props} />;
}
