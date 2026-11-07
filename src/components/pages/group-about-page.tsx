import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/dashboard/page-header";
import { useGroupDataContext } from "@/components/dashboard/group-data-context";
import { formatInteger } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const PROJECT_URL = "https://github.com/Chilfish/yumemita-stream-dashboard";
const BILIBILI_URL = "https://space.bilibili.com/259486090";
const YUMEMITA_GUIDELINE = "https://bang-dream.com/yumemita-guideline";
const BDP_GUIDELINE = "https://bang-dream.com/bdp-guideline";

const LINK_CLASS =
  "text-member-ink underline-offset-2 transition-colors duration-120 ease-out hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-member-ink";

const METRICS_NOTE: [string, string][] = [
  ["时间", "一律按日本时间。"],
  ["同接 / 视聴时间 / 播放 / 点赞", "来自第三方统计 VSTATS；没有数据时相关图表会跳过或显示「—」。"],
  ["弹幕", "从 YouTube 公开回放抓取；纯表情单独计数，不与正文混算。"],
  ["SC / 贴纸", "按币种分别累计，不做汇率换算。"],
  ["评论", "只统计抓取到的评论，不等于视频总评论数。"],
  ["词频 / 发言者", "每场只保留高频部分，跨场相加是近似值。"],
];

const LIMITATIONS = [
  "没有同接曲线：第三方统计只提供平均 / 最大同接和峰值时刻。",
  "播放与点赞的更新时间不同，差值不代表统计错误。",
  "不同币种的金额不能直接相加，页面按币种分开显示。",
  "旧场次的弹幕分类可能和现在的口径不同，页面会标注。",
];

const SOURCE_NOTE: [string, string][] = [
  ["直播数据", "标题、简介、弹幕、SC 与评论来自 YouTube 公开页面 / 直播回放。"],
  ["统计快照", "同接、视聴时间、播放、点赞来自 VSTATS（非官方聚合站），按其页面口径引用。"],
  ["封面与表情", "封面镜像自 YouTube，频道表情来自频道公开资源，均由本站对象存储分发。"],
  ["逐字稿", "由作者手工整理并推送，只覆盖公开播出的场次。"],
];

const PROJECT_NOTE: [string, string][] = [
  ["非官方项目", "与 夢限大みゅーたいぷ、所属事务所、Bushiroad、YouTube、VSTATS 均无隶属或合作关系。"],
  ["非营利", "个人兴趣项目，没有广告、赞助或付费内容；不提供任何会员限定内容的替代访问。"],
  ["权利归属", "直播标题、简介、弹幕、SC、评论、封面与统计数值的权利归各自权利人所有。"],
  ["指引", "内容使用遵循 Bushiroad 的著作物利用指引；如权利人有异议，会按要求下架。"],
];

interface SectionProps {
  title: string;
  children: ReactNode;
}

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

function KeyValueList({ items }: { items: [string, ReactNode][] }) {
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

export function GroupAboutPage() {
  const data = useGroupDataContext();
  const memberCount = data.members.length;
  const streamCount = data.totals.streamCount;
  const chatTotal = data.totals.chatTotal;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="说明"
        facts={[
          { value: memberCount, label: "位成员" },
          { value: formatInteger(streamCount), label: "场公开直播" },
          { value: formatInteger(chatTotal), label: "条弹幕" },
        ]}
        title="数据说明与免责"
      />

      <div className="flex flex-col">
        <Section title="这个页面是什么">
          <p className="text-body text-muted-foreground">
            把成员已结束直播的公开数据整理成图表，方便浏览和对比。页面只读，不改动原始数据，
            也不提供视频或音频的下载。
          </p>
        </Section>

        <Section title="收录范围">
          <p className="text-body text-muted-foreground">
            只收录已结束的直播，按标题去重、保留正片。会员限定场次会照常入库以便统计，
            但默认不公开：列表、相册、对比、聚合与逐字稿索引都会跳过，直接打开单场地址也只会看到封面与标题。
          </p>
          <p className="text-footnote text-muted-foreground">
            公开范围由部署环境决定。如果你是通过带有访问参数的链接来到这里，说明当前会话被允许查看这些场次。
          </p>
        </Section>

        <Section title="数据口径">
          <KeyValueList items={METRICS_NOTE} />
        </Section>

        <Section title="来源">
          <KeyValueList items={SOURCE_NOTE} />
        </Section>

        <Section title="版权与免责">
          <Alert variant="warning">
            <Info aria-hidden="true" />
            <AlertTitle>非官方粉丝项目</AlertTitle>
            <AlertDescription>
              本站与 夢限大みゅーたいぷ、所属事务所、Bushiroad 均无隶属或合作关系。
              所有引用内容的版权归各自权利人所有。
            </AlertDescription>
          </Alert>
          <KeyValueList items={PROJECT_NOTE} />
          <ul className="flex list-disc flex-col gap-1 ps-4 text-footnote text-foreground">
            <li>
              参考指引：
              <a className={LINK_CLASS} href={YUMEMITA_GUIDELINE} rel="noreferrer" target="_blank">
                「夢限大みゅーたいぷ」配信動画に関するガイドライン
              </a>
              、
              <a className={LINK_CLASS} href={BDP_GUIDELINE} rel="noreferrer" target="_blank">
                BanG Dream! 著作物利用に関するガイドライン
              </a>
              。
            </li>
            <li>会员限定 / 付费内容不在此公开；本站不提供绕过付费墙的访问方式。</li>
            <li>如权利人要求删除，会尽快移除对应页面与数据。</li>
          </ul>
        </Section>

        <Section title="已知限制">
          <ul className="flex list-disc flex-col gap-1 ps-4 text-footnote text-foreground">
            {LIMITATIONS.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Section>

        <Section title="项目与联系">
          <dl className="flex flex-col divide-y divide-hairline">
            <div className="grid gap-1 py-2 first:pt-0 last:pb-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
              <dt className="text-footnote text-muted-foreground">项目地址</dt>
              <dd className="text-footnote">
                <a className={LINK_CLASS} href={PROJECT_URL} rel="noreferrer" target="_blank">
                  Chilfish/yumemita-stream-dashboard
                </a>
              </dd>
            </div>
            <div className="grid gap-1 py-2 first:pt-0 last:pb-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
              <dt className="text-footnote text-muted-foreground">问题反馈</dt>
              <dd className="text-footnote">
                <a
                  className={LINK_CLASS}
                  href={`${PROJECT_URL}/issues`}
                  rel="noreferrer"
                  target="_blank"
                >
                  GitHub Issues
                </a>
                <span className="ms-2 text-caption text-ink-3">数据纠错、删除请求与功能建议</span>
              </dd>
            </div>
            <div className="grid gap-1 py-2 first:pt-0 last:pb-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
              <dt className="text-footnote text-muted-foreground">作者</dt>
              <dd className="text-footnote">
                <a className={LINK_CLASS} href={BILIBILI_URL} rel="noreferrer" target="_blank">
                  @Chilfish
                </a>
                <span className="ms-2 text-caption text-ink-3">Bilibili</span>
              </dd>
            </div>
          </dl>
          <p className="text-caption text-ink-3">
            © 2026 Chilfish · 非官方粉丝项目
            <span className="mx-1.5">·</span>
            <a
              className="underline-offset-2 transition-colors duration-120 ease-out hover:text-foreground hover:underline"
              data-astro-reload
              href="/admin/schedule"
            >
              日程维护
            </a>
          </p>
        </Section>
      </div>
    </div>
  );
}
