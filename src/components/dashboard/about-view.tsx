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

const METRICS_NOTE: [string, string][] = [
  ["时间", "一律按日本时间。"],
  ["同接 / 视聴时间 / 播放 / 点赞", "来自第三方统计；没有数据时相关图表会跳过。"],
  ["弹幕", "完整抓取；纯表情单独计数，不与正文混算。"],
  ["SC / 贴纸", "按币种分别累计，不做汇率换算。"],
  ["评论", "只统计抓取到的评论，不等于视频总评论数。"],
  ["词频 / 发言者", "每场只保留高频部分，跨场相加是近似值。"],
  ["会员里程碑", "只记录直播中出现的提示，不等于入会人数。"],
];

const LIMITATIONS = [
  "没有同接曲线：第三方统计只提供平均 / 最大同接和峰值时刻。",
  "播放与点赞的更新时间不同，差值不代表统计错误。",
  "会员限定场的同接数据通常缺失，相关图表会跳过该场。",
  "不同币种的金额不能直接相加，页面按币种分开显示。",
];

interface SectionProps {
  title: string;
  children: ReactNode;
}

/** 标题 + 分组列表：靠发丝线分组，不再用卡片。 */
function Section({ title, children }: SectionProps) {
  return (
    <section className="grid gap-2 border-t border-hairline py-6 first:border-t-0 first:pt-0 md:grid-cols-[11.25rem_minmax(0,1fr)] md:gap-8">
      <div className="min-w-0">
        <h2 className="text-headline text-foreground">{title}</h2>
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
          { value: formatDateTime(manifest.generatedAt), label: "更新于" },
        ]}
        title="说明"
      />

      <div className="flex flex-col">
        <Section title="这个页面是什么">
          <p className="text-body text-muted-foreground">
            收集成员已结束直播的公开数据，做成可浏览、可对比的图表。页面只读，不会修改原始数据。
          </p>
          <KeyValueList
            items={[
              ["成员", `${dataset.label} · ${dataset.count} 场`],
              ["范围", `${manifest.scope}${manifest.note ? ` ${manifest.note}` : ""}`],
            ]}
          />
        </Section>

        <Section title="数据口径">
          <KeyValueList items={METRICS_NOTE} />
        </Section>

        <Section title="键盘快捷键">
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

        <Section title="已知限制">
          <Alert variant="warning">
            <Info aria-hidden="true" />
            <AlertTitle>跨场聚合是“榜单相加”</AlertTitle>
            <AlertDescription>
              高频词、发言者、徽章、表情都来自每场直播的排行榜，不是重新分析全部弹幕；
              全月榜适合看趋势，不适合做精确排名。
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
