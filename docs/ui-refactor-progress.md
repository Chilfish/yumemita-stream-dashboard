# UI 重构实施进度

> 方案见 [ui-refactor.md](ui-refactor.md)。本文件只记录**实施状态与文件归属**，避免并行改动互相覆盖。

## 阶段与状态

| 阶段 | 范围 | 状态 | 负责人 |
| --- | --- | --- | --- |
| P0-a 设计系统 | 令牌、`Panel`、`MetricStrip`、`DataTable`、`Sparkline`、`ChartFrame` | 已完成 | F1 |
| P0-b 壳层与路由 | 新路由、成员侧栏、页面头、数据聚合/分类 | 已完成 | F2 |
| P1 成员首页 | L1 最近一场 / 本月 / 最近场次 / 内容构成 / 高频词 | 待开始 | L1 |
| P2 场次页 | L2 表格、工具条、类型筛选 | 待开始 | L2 |
| P3 单场详情 | L3 五子视图 + 时间轴 | 待开始 | L3 |
| P4 对比与说明 | 对比表、说明页、图表规范 | 待开始 | L4 |
| P5 打磨 | 响应式、可访问性、动效、构建校验、文档 | 待开始 | F2 |

## 文件归属（同一时刻只允许一个工作流修改）

| 工作流 | 独占文件 |
| --- | --- |
| F1 | `src/index.css`、`dashboard/panel.tsx`、`dashboard/metric-strip.tsx`、`dashboard/page-header.tsx`、`dashboard/delta.tsx`、`dashboard/data-table.tsx`、`charts/sparkline.tsx`、`charts/chart-frame.tsx`、`charts/chart-card.tsx`、`lib/chart-colors.ts` |
| F2 | `lib/routes.ts`、`router.tsx`、`pages/*`、`dashboard/app-sidebar.tsx`、`dashboard/app-header.tsx`、`dashboard/dataset-layout.tsx`、`dashboard/loading-screen.tsx`、`lib/classify.ts`、`lib/aggregate.ts`、`lib/keyboard.ts`、`hooks/use-keyboard-shortcuts.ts`、`data-sources.json`、`scripts/sync-data.mjs` |
| L1 | `dashboard/member-home-view.tsx`、`dashboard/home-*.tsx`（新增）、`pages/home-page.tsx`、删除 `dashboard/kpi-grid.tsx` |
| L2 | `dashboard/streams-view.tsx`、`dashboard/streams-toolbar.tsx`、`dashboard/stream-table.tsx`、`pages/streams-page.tsx`、`lib/table-params.ts`、`lib/table-params.test.ts` |
| L3 | `dashboard/stream-detail-view.tsx`、`dashboard/stream-*.tsx`（子视图）、`charts/stream-timeline.tsx`、`pages/stream-page.tsx`、删除 `dashboard/stream-picker.tsx`、`dashboard/sc-table.tsx` |
| L4 | `dashboard/compare-view.tsx`、`dashboard/about-view.tsx`、`charts/` 下的现有图表（除 F1、L3 新增文件） |

## 共享组件契约

### 设计令牌（Tailwind v4）

| 用途 | 类名 |
| --- | --- |
| 表面 | `bg-card rounded-panel shadow-surface` |
| 发丝线 | `border-hairline` / `divide-hairline` |
| 字阶 | `text-display`(28/34) `text-title`(21/28) `text-headline`(16/22) `text-body`(14/21) `text-footnote`(12/17) `text-caption`(11/15) |
| 语义色 | `text-member` `bg-member` `text-positive` `text-paid` `text-muted-foreground` |
| 圆角 | `rounded-panel`(14) `rounded-control`(9) |
| 数值 | `tabular-nums`，右对齐，单位降一级 |

### 业务组件

```tsx
<Panel>
  <PanelHead eyebrow? title meta? actions? />
  <PanelBody flush? />
  <PanelNote />
</Panel>
<SplitPanel columns="main" | "even" />

<PageHeader eyebrow? title facts? actions? />
<MetricStrip items={[{ label, value, unit?, hint? }]} columns={3|4|6} highlight? />
<Delta value={number | null} compareLabel="vs 9 月" />
<Sparkline values={number[]} height? peakIndex? area? ariaLabel />
<DataTable columns={...} rows={...} rowKey rowHref sort onSort empty />
<ChartFrame title meta? action? note? />
```

## 已知取舍

- 路由从 `#/:id/overview|table` 改为 `#/:id`（成员首页）与 `#/:id/streams`（场次页）；旧地址保留重定向。
- 成员色写入 `data-sources.json` 的 `color`，由 `sync:data` 透传到 `index.json`，页面通过 `--member-color` 注入。
- 原型 `.commandcode/design/prototype-v2.html` 仅作视觉校验，不进入生产代码。
