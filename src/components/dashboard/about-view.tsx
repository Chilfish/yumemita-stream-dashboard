import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Kbd } from "@/components/ui/kbd";
import { formatDateTime } from "@/lib/format";
import { SHORTCUTS } from "@/lib/keyboard";
import type { BatchManifest, DatasetIndexEntry } from "@/types/dataset";

interface AboutViewProps {
  dataset: DatasetIndexEntry;
  manifest: BatchManifest;
}

const STACK = ["React 19", "Vite", "TypeScript", "Tailwind CSS v4", "coss ui", "D3"];

const METRICS_NOTE: [string, string][] = [
  ["时间", "一律 JST（UTC+9）；开播时刻取 release_timestamp。"],
  ["同接 / 视聴时间 / 播放 / 点赞", "优先取 VSTATS 单场快照；无条目时为 null，相关图表跳过。"],
  ["弹幕", "live_chat 全量；纯表情单列，不与正文条数混算。"],
  ["SC / 贴纸", "按币种分组累计，不换算汇率。"],
  ["评论", "抓取上限内的条数，不等于视频总评论数。"],
  ["词频 / 发言者", "各场只保留 Top 40 / Top 20，跨场相加是近似值。"],
  ["会员里程碑", "只记录直播中出现的提示，不等于入会人数。"],
];

const ROUTES: [string, string][] = [
  ["#/:member", "首页：最近一场、本月变化、最近场次"],
  ["#/:member/streams", "场次：完整表格，搜索 / 筛选 / 排序写入 URL"],
  ["#/:member/trends", "趋势：月度趋势、月度明细、内容类型对比"],
  ["#/:member/stream/:videoId?view=", "单场：概览 / 时间轴 / 弹幕与词 / 付费 / 评论"],
  ["#/:member/compare", "对比：最多 4 场叠加与指标横表"],
  ["#/:member/about", "说明：本页"],
];

const UPDATE_COMMANDS = `cd stream-dashboard
bun install
bun run sync:data      # data/ -> public/data
bun run validate:data  # 校验 index/manifest/datapack
bun run dev            # http://localhost:5173`;

const LIMITATIONS = [
  "没有同接曲线：VSTATS 只提供平均/最大 + 最大值时刻。",
  "播放/点赞快照与 VSTATS 更新时点不同，差值是时点差，不是统计错误。",
  "会员限定场的 VSTATS 条目通常缺失，同接图表会跳过该场。",
  "币种金额不可直接相加；页面只按币种分组展示。",
];

interface SectionProps {
  title: string;
  meta?: string;
  children: ReactNode;
}

/** 标题 + 分组列表：靠发丝线分组，不再用卡片。 */
function Section({ title, meta, children }: SectionProps) {
  return (
    <section className="grid gap-2 border-t border-hairline py-6 first:border-t-0 first:pt-0 md:grid-cols-[180px_minmax(0,1fr)] md:gap-8">
      <div className="min-w-0">
        <h2 className="text-headline text-foreground">{title}</h2>
        {meta ? <p className="mt-1 text-caption text-ink-3">{meta}</p> : null}
      </div>
      <div className="flex max-w-3xl min-w-0 flex-col gap-3">{children}</div>
    </section>
  );
}

function KeyValueList({ items }: { items: [string, string][] }) {
  return (
    <dl className="flex flex-col divide-y divide-hairline">
      {items.map(([term, description]) => (
        <div
          className="grid gap-1 py-2 first:pt-0 last:pb-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4"
          key={term}
        >
          <dt className="text-footnote text-muted-foreground">{term}</dt>
          <dd className="text-footnote text-foreground">{description}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AboutView({ dataset, manifest }: AboutViewProps) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={dataset.label}
        facts={[
          { value: manifest.count, label: "场" },
          { value: formatDateTime(manifest.generatedAt), label: "数据生成于" },
        ]}
        title="说明"
      />

      <div className="flex flex-col">
        <Section title="这个页面是什么" meta="只读视图；聚合全部在浏览器里完成">
          <p className="text-body text-muted-foreground">
            把 <code>data/&lt;dataset&gt;/</code> 下的归一化 JSON 做成可交互的数据台。
            页面只读，不修改原始数据；所有聚合都在浏览器里完成。
          </p>
          <KeyValueList
            items={[
              ["数据集", `${dataset.label} · ${dataset.count} 场`],
              ["范围", `${manifest.scope}${manifest.note ? ` ${manifest.note}` : ""}`],
              ["技术栈", STACK.join(" · ")],
            ]}
          />
        </Section>

        <Section title="页面结构" meta="五条路由，状态都在地址栏里">
          <dl className="flex flex-col divide-y divide-hairline">
            {ROUTES.map(([path, description]) => (
              <div
                className="grid gap-1 py-2 first:pt-0 last:pb-0 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4"
                key={path}
              >
                <dt>
                  <code className="text-caption text-foreground">{path}</code>
                </dt>
                <dd className="text-footnote text-muted-foreground">{description}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section meta="和 stream-datapack 的 README 一致" title="数据口径">
          <KeyValueList items={METRICS_NOTE} />
        </Section>

        <Section meta="数据源在仓库的 data/ 目录，页面只同步副本" title="如何更新">
          <pre className="overflow-x-auto rounded-control border border-hairline bg-muted/40 p-3 text-caption text-foreground">
            {UPDATE_COMMANDS}
          </pre>
          <ol className="flex list-decimal flex-col gap-1.5 ps-4 text-footnote text-foreground">
            <li>
              新增一场直播：把新的 <code>datapack.json</code> 和 manifest 放进{" "}
              <code>data/&lt;dataset&gt;/</code>。
            </li>
            <li>
              新增一位成员：在 <code>data-sources.json</code> 增加一个 dataset，重新同步。
            </li>
            <li>侧栏的成员列表会自动出现新成员，不需要改组件。</li>
          </ol>
          <p className="text-caption text-ink-3">
            更细的步骤见 <code>docs/adding-data.md</code>。
          </p>
        </Section>

        <Section meta="不用离开键盘就能翻场和切换页面" title="键盘快捷键">
          <dl className="flex flex-col divide-y divide-hairline">
            {SHORTCUTS.map(shortcut => (
              <div
                className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                key={shortcut.keys}
              >
                <dt>
                  <Kbd>{shortcut.keys}</Kbd>
                </dt>
                <dd className="text-footnote text-muted-foreground">{shortcut.label}</dd>
              </div>
            ))}
          </dl>
          <p className="text-caption text-ink-3">
            在输入框、文本域或下拉框里输入时，快捷键会被忽略。
          </p>
        </Section>

        <Section meta="读图前先看这几条，避免把近似值当精确值" title="已知限制">
          <Alert variant="warning">
            <Info aria-hidden="true" />
            <AlertTitle>跨场聚合是“榜单相加”</AlertTitle>
            <AlertDescription>
              高频词、发言者、徽章、表情都来自每场 JSON 里的 Top 列表，不是重新分词/重扫弹幕。
              因此全月榜适合看趋势，不适合做精确排名；要精确值需要扩展 datapack schema。
            </AlertDescription>
          </Alert>
          <ul className="flex list-disc flex-col gap-1 ps-4 text-footnote text-foreground">
            {LIMITATIONS.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
