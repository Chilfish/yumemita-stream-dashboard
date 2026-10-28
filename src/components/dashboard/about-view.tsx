import { Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card";
import { Kbd } from "@/components/ui/kbd";
import { formatDateTime } from "@/lib/format";
import { SHORTCUTS } from "@/lib/keyboard";
import type { BatchManifest, DatasetIndexEntry } from "@/types/dataset";

interface AboutViewProps {
  dataset: DatasetIndexEntry;
  manifest: BatchManifest;
}

const STACK = ["React 19", "Vite", "TypeScript", "Tailwind CSS v4", "coss ui", "D3"];

export function AboutView({ dataset, manifest }: AboutViewProps) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>这个页面是什么</CardTitle>
          <CardDescription>
            把 <code>data/&lt;dataset&gt;/</code> 下的归一化 JSON 做成可交互的数据台。
            页面只读，不修改原始数据；所有聚合都在浏览器里完成。
          </CardDescription>
        </CardHeader>
        <CardPanel className="grid gap-3 pt-0 md:grid-cols-3">
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-muted-foreground text-xs">数据集</p>
            <p className="mt-1 font-medium text-sm">{dataset.label}</p>
            <p className="mt-1 text-muted-foreground text-xs">
              {dataset.count} 场 · 生成于 {formatDateTime(manifest.generatedAt)}
            </p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-muted-foreground text-xs">范围</p>
            <p className="mt-1 text-sm">{manifest.scope}</p>
            <p className="mt-1 text-muted-foreground text-xs">{manifest.note}</p>
          </div>
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-muted-foreground text-xs">技术栈</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {STACK.map(item => (
                <Badge key={item} variant="outline">
                  {item}
                </Badge>
              ))}
            </div>
          </div>
        </CardPanel>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>数据口径</CardTitle>
          <CardDescription>和 stream-datapack 的 README 一致。</CardDescription>
        </CardHeader>
        <CardPanel className="pt-0">
          <dl className="flex flex-col gap-2 text-xs">
            {[
              ["时间", "一律 JST（UTC+9）；开播时刻取 release_timestamp。"],
              ["同接 / 视聴时间 / 播放 / 点赞", "优先取 VSTATS 单场快照；无条目时为 null，相关图表跳过。"],
              ["弹幕", "live_chat 全量；纯表情单列，不与正文条数混算。"],
              ["SC / 贴纸", "按币种分组累计，不换算汇率。"],
              ["评论", "抓取上限内的条数，不等于视频总评论数。"],
              ["词频 / 发言者", "各场只保留 Top 40 / Top 20，跨场相加是近似值。"],
              ["会员里程碑", "只记录直播中出现的提示，不等于入会人数。"],
            ].map(([term, description]) => (
              <div className="grid grid-cols-[8.5rem_1fr] gap-2" key={term}>
                <dt className="text-muted-foreground">{term}</dt>
                <dd className="leading-relaxed">{description}</dd>
              </div>
            ))}
          </dl>
        </CardPanel>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>如何更新</CardTitle>
          <CardDescription>数据源在仓库的 data/ 目录，页面只同步副本。</CardDescription>
        </CardHeader>
        <CardPanel className="flex flex-col gap-3 pt-0">
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
{`cd stream-dashboard
bun install
bun run sync:data      # data/ -> public/data
bun run validate:data  # 校验 index/manifest/datapack
bun run dev            # http://localhost:5173`}
          </pre>
          <ol className="list-decimal space-y-1 ps-4 text-xs leading-relaxed">
            <li>
              新增一场直播：把新的 <code>datapack.json</code> 和 manifest 放进{" "}
              <code>data/&lt;dataset&gt;/</code>。
            </li>
            <li>
              新增一位成员：在 <code>data-sources.json</code> 增加一个 dataset，重新同步。
            </li>
            <li>
              页面会自动出现 dataset 选择器；不需要改组件。
            </li>
          </ol>
          <p className="text-muted-foreground text-xs">
            更细的步骤见 <code>docs/adding-data.md</code>。
          </p>
        </CardPanel>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>键盘快捷键</CardTitle>
          <CardDescription>不用离开键盘就能翻场和切换页面。</CardDescription>
        </CardHeader>
        <CardPanel className="flex flex-col gap-3 pt-0">
          <dl className="flex flex-col gap-2 text-xs">
            {SHORTCUTS.map(shortcut => (
              <div className="flex items-center justify-between gap-3" key={shortcut.keys}>
                <dt>
                  <Kbd>{shortcut.keys}</Kbd>
                </dt>
                <dd className="text-muted-foreground">{shortcut.label}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground text-xs">
            在输入框、文本域或下拉框里输入时，快捷键会被忽略。
          </p>
        </CardPanel>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>已知限制</CardTitle>
          <CardDescription>读图前先看这几条，避免把近似值当精确值。</CardDescription>
        </CardHeader>
        <CardPanel className="pt-0">
          <Alert variant="warning">
            <Info aria-hidden="true" />
            <AlertTitle>跨场聚合是“榜单相加”</AlertTitle>
            <AlertDescription>
              高频词、发言者、徽章、表情都来自每场 JSON 里的 Top 列表，不是重新分词/重扫弹幕。
              因此全月榜适合看趋势，不适合做精确排名；要精确值需要扩展 datapack schema。
            </AlertDescription>
          </Alert>
          <ul className="mt-3 list-disc space-y-1 ps-4 text-xs leading-relaxed">
            <li>没有同接曲线：VSTATS 只提供平均/最大 + 最大值时刻。</li>
            <li>播放/点赞快照与 VSTATS 更新时点不同，差值是时点差，不是统计错误。</li>
            <li>会员限定场的 VSTATS 条目通常缺失，同接图表会跳过该场。</li>
            <li>币种金额不可直接相加；页面只按币种分组展示。</li>
          </ul>
        </CardPanel>
      </Card>
    </div>
  );
}
