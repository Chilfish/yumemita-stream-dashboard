# UI 重构实施进度

> 方案见 [ui-refactor.md](ui-refactor.md)。本文件只记录**实施状态与文件归属**，避免并行改动互相覆盖。
> 最近更新：2026-10-29。

## 阶段与状态

| 阶段 | 范围 | 状态 | 负责人 |
| --- | --- | --- | --- |
| P0-a 设计系统 | 令牌、`Panel`、`MetricStrip`、`DataTable`、`Sparkline`、`ChartFrame` | 已完成（641c42d） | F1 |
| P0-b 壳层与路由 | 新路由、成员侧栏、页面头、数据聚合/分类 | 已完成（641c42d） | F2 |
| P1 成员首页 | L1 最近一场 / 本月 / 最近场次 / 内容构成 / 高频词 | 已完成（641c42d） | L1 |
| P2 场次页 | L2 表格、工具条、类型筛选 | 已完成（641c42d） | L2 |
| P3 单场详情 | L3 五子视图 + 时间轴 | 已完成（641c42d） | L3 |
| P4 对比与说明 | 对比表、说明页、图表规范 | 已完成（641c42d） | L4 |
| P5 打磨 | 响应式、可访问性、动效、构建校验、文档 | 已完成（200% 缩放待手动复核） | F2 |

## P5 清单

| 项 | 状态 | 落点 |
| --- | --- | --- |
| 移动端底部标签栏 | 已完成 | `dashboard/mobile-tab-bar.tsx`（新增） |
| 移动端成员 Sheet | 已完成 | `dashboard/member-sheet.tsx`（新增） |
| ⌘K 命令面板（场次 + 成员） | 已完成 | `dashboard/command-palette.tsx`（新增）、`lib/keyboard.ts`、`hooks/use-keyboard-shortcuts.ts` |
| 场次表窄屏首列吸附 | 已完成 | `dashboard/data-table.tsx`、`dashboard/streams-view.tsx` |
| 移动端低频筛选收进 Sheet | 已完成 | `dashboard/streams-toolbar.tsx` |
| 跳到主要内容 / 焦点可见 | 已完成 | `dashboard/dataset-layout.tsx` |
| 320px 窄屏复核 | 已完成 | 页面无横向溢出，表格容器内部滚动 |
| 200% 缩放复核 | 待手动验证 | — |
| 数据入场动画 | 已完成 | 折线自绘 / 柱子生长，仅在视图挂载时播一次；见 P9 |

## P6 后续迭代

| 项 | 状态 | 落点 |
| --- | --- | --- |
| 更新日历（场次 / 弹幕 / SC 热力图） | 已完成 | `charts/calendar-heatmap.tsx`、`dashboard/home-calendar.tsx`、`lib/aggregate.ts` |
| 趋势页（月度趋势 + 类型对比） | 已完成 | `charts/trend-line.tsx`、`dashboard/trends-view.tsx`、`pages/trends-page.tsx`、`lib/aggregate.ts` |
| 对象存储数据链路 | 已完成 | `publish:data` / `sync:data` / `validate:data`；datapack 不进 git |
| 文档同步 | 已完成 | README、roadmap、architecture、development |

## P7 首页降噪与溢出修复

| 项 | 状态 | 落点 |
| --- | --- | --- |
| 横向溢出 | 已完成 | `dataset-layout.tsx`（`SidebarInset` 加 `min-w-0`）；`charts/chart-canvas.tsx`、`charts/calendar-heatmap.tsx` 用 `contain: inline-size` 隔离测量宽度 |
| 首页层级 | 已完成 | `dashboard/member-home-view.tsx`：页面头 → 规模指标条 → 最近一场 / 本月 / 全期记录 → 最近场次 → 更新日历 |
| 分析内容下放趋势页 | 已完成 | 典型节奏曲线、全期高频词/发言者移入 `dashboard/trends-view.tsx`；内容构成由「内容类型对比」表覆盖，`home-content-mix.tsx` 删除 |
| 更新日历默认定位最近 | 已完成 | `charts/calendar-heatmap.tsx` 渲染后滚到右端 |
| 指标字阶 | 已完成 | `index.css` 新增 `--text-stat`（24/30，600），用于规模指标与最近一场主指标 |

## P8 封面、相册与逐字稿

| 项 | 状态 | 落点 |
| --- | --- | --- |
| 封面抓取与发布 | 已完成 | `scripts/fetch-thumbnails.ts`、`scripts/publish-data.ts`（thumbs → pack → index）、`scripts/lib/object-storage.ts` |
| 首页与最近场次封面 | 已完成 | `dashboard/stream-cover.tsx`、`home-latest-stream.tsx`、`home-recent-streams.tsx` |
| 单场页封面 | 已完成 | `stream-detail-view.tsx` 页头改为「标题 + 右侧 16:9 封面」网格 |
| 相册页 | 已完成 | `dashboard/gallery-view.tsx`、`pages/gallery-page.tsx`；侧栏与移动端标签栏入口 |
| 逐字稿 | 已完成 | `content/transcripts/`、`scripts/transcript-*.ts`、`scripts/publish-transcripts.ts`、`hooks/use-transcript.ts`、`dashboard/transcript-view.tsx`、`transcripts-view.tsx` |
| 单场「逐字稿」分段 | 已完成 | 只在索引里有当前 `videoId` 时出现；移动端分段控件改为容器内横向滚动，避免页面溢出 |
| 验证 | 已完成 | 1440 / 390 / 320 复核；相册 287 张图 0 破图；页面横向溢出 0；`typecheck` / 101 个单测 / lint 通过 |

## P9 动效

| 项 | 状态 | 落点 |
| --- | --- | --- |
| 动效令牌与工具类 | 已完成 | `src/index.css`：`--ease-standard` / `--ease-emphasized`、`.motion-view` / `.motion-swap` / `.press` / `.chart-*` / `.scroll-edge` |
| 路由切换 | 已完成 | `dashboard/dataset-layout.tsx`、`dashboard/group-layout.tsx`：按「成员 + 栏目」重挂，只在新视图挂载时淡入 |
| 单场子视图互换 | 已完成 | `dashboard/stream-detail-view.tsx`：`.motion-swap` 按 `view` 重挂 |
| 折线自绘 | 已完成 | `charts/trend-line|sparkline|multi-line-chart|stream-timeline|chat-density|stream-shape`：`pathLength="1"` + `stroke-dashoffset` |
| 柱子生长 | 已完成 | `charts/stream-bars.tsx`：`.chart-bar` 以柱底为原点 scaleY |
| 按压反馈 | 已完成 | `ui/button.tsx`（`active` / `data-pressed` 缩放）、`dashboard/gallery-view.tsx` 的 `.press` |
| 封面淡入 | 已完成 | `dashboard/stream-cover.tsx`：按已解码的 `src` 淡入，缓存命中时补一次检查 |
| 主题切换 | 已完成 | `hooks/use-theme.ts`：`document.startViewTransition` + `flushSync`，不支持或 reduce 时直接切换 |
| 顶栏滚动阴影 | 已完成 | `dashboard/app-header.tsx`：`.scroll-edge`，`@supports (animation-timeline: scroll())` |
| 验证 | 已完成 | Chromium 1440 复核：路由过渡 `opacity`/`translate` 在跑；折线 `stroke-dashoffset` 1px → 0px；主题切换触发 1 次 `startViewTransition` 并落盘 `dark`；相册与趋势页截图无破图/无未绘制图表；`typecheck` / `lint` / `build` 通过 |

## 文件归属（同一时刻只允许一个工作流修改）

| 工作流 | 独占文件 |
| --- | --- |
| F1 | `src/index.css`、`dashboard/panel.tsx`、`dashboard/metric-strip.tsx`、`dashboard/page-header.tsx`、`dashboard/delta.tsx`、`charts/sparkline.tsx`、`charts/chart-frame.tsx`、`charts/chart-card.tsx`、`lib/chart-colors.ts` |
| F2 | `lib/routes.ts`、`router.tsx`、`pages/*`、`dashboard/app-sidebar.tsx`、`dashboard/app-header.tsx`、`dashboard/dataset-layout.tsx`、`dashboard/loading-screen.tsx`、`lib/classify.ts`、`lib/aggregate.ts`、`data-sources.json`、`scripts/sync-data.mjs` |
| L1 | `dashboard/member-home-view.tsx`、`dashboard/home-*.tsx`、`dashboard/meter-row.tsx`、`dashboard/top-words.tsx`、`dashboard/top-authors.tsx`、`pages/home-page.tsx` |
| L2 | `pages/streams-page.tsx`、`lib/table-params.ts`、`lib/table-params.test.ts` |
| L3 | `dashboard/stream-detail-view.tsx`、`dashboard/stream-*.tsx`（子视图）、`charts/stream-timeline.tsx`、`pages/stream-page.tsx` |
| L4 | `dashboard/compare-view.tsx`、`dashboard/about-view.tsx`、`charts/` 下的现有图表（除 F1、L3 新增文件） |
| P5-a 移动端 | `dashboard/mobile-tab-bar.tsx`、`dashboard/member-sheet.tsx` |
| P5-b 搜索 | `dashboard/command-palette.tsx`、`lib/keyboard.ts`、`lib/keyboard.test.ts`、`hooks/use-keyboard-shortcuts.ts` |
| P5-c 表格 | `dashboard/data-table.tsx`、`dashboard/streams-view.tsx`、`dashboard/streams-toolbar.tsx` |
| P6 日历与趋势 | `charts/calendar-heatmap.tsx`、`dashboard/home-calendar.tsx`、`charts/trend-line.tsx`、`dashboard/trends-view.tsx`、`pages/trends-page.tsx`、`lib/aggregate.ts`、`lib/aggregate.test.ts` |
| P8 封面与逐字稿 | `dashboard/stream-cover.tsx`、`dashboard/gallery-view.tsx`、`dashboard/transcript-view.tsx`、`dashboard/transcripts-view.tsx`、`pages/gallery-page.tsx`、`pages/transcripts-page.tsx`、`hooks/use-transcript.ts`、`lib/transcripts.ts`、`content/transcripts/`、`scripts/fetch-thumbnails.ts`、`scripts/transcript-*.ts`、`scripts/publish-transcripts.ts` |

> P5 完成后，`data-table.tsx` 回到 F1，`streams-view.tsx` / `streams-toolbar.tsx` 回到 L2。

## 共享组件契约

### 设计令牌（Tailwind v4）

| 用途 | 类名 |
| --- | --- |
| 表面 | `bg-card rounded-panel shadow-surface` |
| 发丝线 | `border-hairline` / `divide-hairline` |
| 字阶 | `text-display`(28/34) `text-stat`(24/30) `text-title`(21/28) `text-headline`(16/22) `text-body`(14/21) `text-footnote`(12/17) `text-caption`(11/15) |
| 语义色 | `text-member` `bg-member` `text-positive` `text-paid` `text-muted-foreground` |
| 圆角 | `rounded-panel`(14) `rounded-control`(9) |
| 数值 | `tabular-nums`，右对齐，单位降一级 |

### 业务组件

```tsx
<StreamCover datasetId videoId title thumbnail? eager? sizes? className? />
<GalleryView datasetId rows />
<TranscriptView datasetId videoId />
<TranscriptsView datasetId datasetLabel? />
```

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

<DataTable
  columns={...}
  rows={...}
  rowKey
  rowHref
  sort
  onSort
  stickyHeader?
  stickyFirstColumn?
  empty
/>

<ChartFrame title meta? action? note? />

<MobileTabBar datasetId datasets activeSection activeMemberId latestVideoId onMemberSelect />
<MemberSheet datasets activeId open onOpenChange onSelect />
<CommandPalette open onOpenChange datasetId datasets rows />
```

### 快捷键

`j` / `k` 翻场 · `1`–`5` 切页 · `/` 聚焦搜索 · `⌘K` 搜索场次与成员 · `⌘B` 收起/展开侧栏。
除 `⌘K` 外，输入框内自动忽略。

## 验证

```bash
bun run check        # typecheck + 77 个单测 + lint
bun run build        # sync:data + tsc -b + vite build
bun run test:smoke   # 需先启动 dev/preview
```

当前基线（2026-10-28）：

- `bun run typecheck`：通过。
- `bun run test`：6 个文件 / 77 个用例通过。
- `bun run lint`：0 warning / 0 error。
- `bun run build`：通过，主包约 349 KB（gzip ~112 KB）。
- `bun run test:smoke`：6/6 场景通过（首页重定向、单场深链、无效 id、对比深链、趋势深链、前进后退）。
- 浏览器复核（390 / 320 / 1440）：
  - 底栏贴底（间距 0）、高 53px，≥44px 触控目标；
  - 场次表横向滚动 260px 时首列位移 0（吸附生效）；
  - 筛选 Sheet 与成员 Sheet 均可打开；
  - `⌘K` 命令面板可打开、可过滤场次；
  - 更新日历渲染 1085 个日期格，覆盖 258 个直播日；场次 / 弹幕 / SC 切换会更新读数；
  - 趋势页渲染 36 个月折线、36 行月度明细、4 类内容对比；深链刷新与移动端无溢出；
  - 页面无 console error，320px 下页面横向溢出为 0。

## 已知取舍

- 路由从 `#/:id/overview|table` 改为 `#/:id`（成员首页）与 `#/:id/streams`（场次页）；旧地址保留重定向。
- 成员色写入 `data-sources.json` 的 `color`，由 `publish:data` 写进 `index.json`；页面注入 `--member-color`（品牌原色，图表/色点）与 `--member-ink`（对比度达标的前景色，文字/焦点环）。
- 原型 `.commandcode/design/prototype-v2.html` 仅作视觉校验，不进入生产代码。
- 移动端使用底部标签栏 + 成员 Sheet；侧栏在移动端仍可通过顶栏按钮以抽屉打开。
- `⌘K` 命令面板是全局搜索，输入框内也生效；`⌘B` 由 coss `SidebarProvider` 提供。
- 场次表在窄屏保留横向滚动，首列（日期）吸附；不做卡片化。
- `<md` 的类型筛选与“仅有 VSTATS”收进底部 Sheet，桌面布局不变。
- 数据规模以对象存储上的 `manifest.json` 为准；本页不写死场次数，避免抓取推进后文档过期。
- 路由切换只给内容区做淡入，不用整页 View Transition：整页快照会把侧栏与顶栏一起拖进淡入，观感更像重载。View Transition 只用在主题切换这种「颜色是唯一变化」的场景。
