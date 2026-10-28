# 架构

## 目标与非目标

**目标**

- 把一份或多份 `stream-datapack` JSON 变成可浏览、可比较的数据台。
- 数据随仓库走，静态托管即可运行，不需要后端。
- 新增成员 / 新增场次时，尽量只动数据，不动组件。
- 图表可控：比例尺、路径、交互都由我们自己决定，方便后续加指标。

**非目标**

- 不做直播内容的正文字幕/翻译（那是归档流程的事）。
- 不做实时抓取；数据由外部 pipeline 生成后放进 `data/`。
- 不做账号体系、数据库、服务端聚合。

## 分层

```text
┌─────────────────────────────────────────────────────────┐
│ data/                    源数据（提交）                  │
│  <dataset>/manifest.json + <videoId>.datapack.json      │
└───────────────────────┬─────────────────────────────────┘
                        │ scripts/sync-data.mjs
┌───────────────────────▼─────────────────────────────────┐
│ public/data/             生成物（gitignore）             │
│  index.json + <dataset>/manifest.json + datapack        │
└───────────────────────┬─────────────────────────────────┘
                        │ fetch（浏览器）
┌───────────────────────▼─────────────────────────────────┐
│ src/lib/data.ts          请求、datapack 缓存、并发控制   │
│ src/lib/table-params.ts  数据表 URL 参数解析/序列化       │
│ src/hooks/               useDatasetIndex / useDataset /  │
│                          useStreamPacks（按需）           │
└───────────────────────┬─────────────────────────────────┘
                        │ StreamSummary[] / 按需 datapack
┌───────────────────────▼─────────────────────────────────┐
│ src/lib/aggregate.ts     纯函数：合并、聚合、找峰值      │
│ src/lib/format.ts        纯函数：数字/时间/币种格式化    │
└───────────────────────┬─────────────────────────────────┘
                        │ StreamSummary[] + DatasetTotals
                        │ （datapack 打开单场时按需拉取）
┌───────────────────────▼─────────────────────────────────┐
│ src/components/dashboard/  页面级视图、Sidebar、Header       │
│ src/pages/                 路由包装层（页面 ↔ URL）          │
│ src/router.tsx             hash 路由表                       │
│ src/components/charts/     D3 图表                           │
│ src/components/ui/         coss ui primitives（生成）        │
└─────────────────────────────────────────────────────────┘
```

### 为什么这样分

- **数据层与视图层分离**：`lib/` 不 import React，方便单元测试，也方便以后换 UI。
- **同步脚本独立**：浏览器不需要知道数据来自哪里；换数据源只改 `data-sources.json`。
- **类型镜像独立**：`src/types/datapack.ts` 是 JSON schema 的 TS 表达，所有组件共用一套类型。
- **UI 生成物隔离**：`src/components/ui/` 由 coss CLI 生成，业务代码只组合，不往里写业务逻辑。

## 数据流

1. `scripts/sync-data.mjs` 读 `data-sources.json`。
2. 对每个 dataset：读 manifest，按 manifest 的 `streams[].videoId` 复制 datapack 到 `public/data/<id>/`。
3. 同步时用 `aggregateDataset` 预聚合全量 KPI、币种、Top 词/发言者、最佳场次、峰值分钟与典型节奏，写 `insights.json`。
4. 写 `public/data/index.json`（dataset 列表 + 数量 + 生成时间）。
5. `useDatasetIndex()` 拉 index；默认选中第一个 dataset。
6. `useDataset(datasetId)` 并行拉 manifest 与 insights，然后用 `buildSummaryRows` 得到按开播时间倒序的 `StreamSummary[]`。列表页不再等待所有 datapack。
7. 列表视图（总览 / 数据表 / 对比指标）只消费 summary 与预聚合 totals；单场和对比的逐分钟曲线通过 `useStreamPacks` 按需请求 datapack，`lib/data.ts` 里有缓存与并发去重。
8. 各视图消费 `rows` / `totals`；图表组件只接收已整理好的数据。

## 路由与 URL 状态

使用 **React Router v8** 的 hash 路由（`createHashRouter`）。选 hash 而不是 history：

- 任意静态托管 / 子路径都不需要 SPA fallback，和部署承诺一致。
- 单场、对比选择可以直接分享、刷新、前进后退。

| URL | 页面 |
| --- | --- |
| `#/` | 重定向到上次访问的成员，否则第一个数据集 |
| `#/:datasetId` | 成员首页（L1，glance） |
| `#/:datasetId/streams?q=&type=&sort=&dir=&vstats=` | 场次页（L2，browse）；筛选/排序状态可分享 |
| `#/:datasetId/stream` | 跳转到最新一场 |
| `#/:datasetId/stream/:videoId?view=` | 单场详情（L3，inspect）；`view` 为 `overview`/`timeline`/`words`/`paid`/`comments` |
| `#/:datasetId/compare?ids=a,b,c` | 对比，最多 4 场 |
| `#/:datasetId/about` | 说明 |
| `#/:datasetId/overview`、`#/:datasetId/table` | 旧地址，分别重定向到成员首页与场次页 |

路由表在 `src/router.tsx`，根路由与 `:datasetId` 都配置了 `errorElement`（`route-error.tsx`），渲染或懒加载异常会显示兜底页而不是白屏。`src/pages/` 是薄包装层：从 `useDatasetView()` 取数据、把导航动作接到 `navigate`，视图组件本身不依赖 router。

数据表的查询参数由 `src/lib/table-params.ts` 解析/序列化：`q` 搜索词、`type` 内容类型、`sort` 排序字段、`dir` 方向（`asc`/`desc`）、`vstats=1` 只看有 VSTATS 的场次。默认值不写进 URL，参数变化用 `replace`，避免输入搜索词时污染历史记录。

## 状态管理

没有引入 Redux/Zustand。状态分三层：

| 状态 | 位置 | 说明 |
| --- | --- | --- |
| dataset、当前页面、选中场次、对比选择、表格筛选/排序 | URL（React Router） | 可分享、可刷新、可前进后退 |
| manifest、insights | `useDataset` | 进入 dataset 时加载一次，路由切换不重复请求 |
| 单场 / 对比的 datapack | `useStreamPacks` | 按 videoId 按需加载，模块级缓存去重 |
| 图表 hover、复制成功提示 | 各组件内部 | 仅本页使用，不跨组件共享 |

选这个方案的原因：首屏只需要 manifest 与预聚合摘要，页面结构简单，引入全局 store 只会增加理解成本。

## 图表策略：React + D3

**React 拥有 DOM，D3 只负责数学。** 不使用 `d3-selection` 操作 React 渲染的节点。

- 尺寸：`ChartCanvas` + `useElementWidth`（ResizeObserver）拿到容器宽度。
- 比例尺：`scaleLinear` / `scaleBand` / `scaleSqrt`。
- 形状：`line` / `area` / `pie` / `arc`。
- 渲染：普通 SVG 元素（`<path>` / `<rect>` / `<circle>` / `<text>`），由 React 输出。
- 颜色：`CHART_COLORS` 映射到 coss 主题 token（`--chart-1` … `--chart-5`），自动适配深浅色。
- 可访问性：每个 SVG 有 `aria-label`；每个数据标记有 `<title>` 作为原生 tooltip。

这样做的好处：

- 不需要图表库的抽象层，新增指标只改比例尺和 path。
- 不会出现 D3 和 React 争抢同一批 DOM 节点的问题。
- 体积可控：只 import 用到的 D3 模块。

## 视图与组件

```text
src/components/dashboard/
  dataset-layout.tsx   Sidebar + Header + 数据加载 + Outlet
  dataset-index-gate.tsx  索引加载/错误门禁 + context
  app-sidebar.tsx     侧边导航：品牌、成员列表、页面、主题
  app-header.tsx      顶栏：折叠按钮、面包屑、⌘K 搜索、场次统计
  dataset-view-context.ts  页面共享 rows / totals
  loading-screen.tsx  加载骨架屏
  panel.tsx           Panel / PanelHead / PanelBody / PanelNote / SplitPanel
  page-header.tsx     页面头（标题 + facts + actions）
  metric-strip.tsx    6 / 4 项指标条
  delta.tsx           环比变化
  data-table.tsx      列定义驱动的表格（排序、吸附首列、行链接）
  member-home-view.tsx  L1 成员首页
  home-latest-stream.tsx / home-month-panel.tsx / home-recent-streams.tsx
  home-content-mix.tsx / home-meter-row.tsx / home-top-words.tsx / home-top-authors.tsx
  streams-view.tsx    L2 场次页（表格 + 工具条）
  streams-toolbar.tsx 搜索、类型筛选、仅有 VSTATS、导出 CSV、移动端筛选 Sheet
  stream-detail-view.tsx  L3 单场详情 + 分段控件
  stream-overview-panel.tsx / stream-timeline-panel.tsx
  stream-words-panel.tsx / stream-paid-panel.tsx / stream-comments-panel.tsx
  compare-view.tsx    对比（最多 4 场，受控选择）
  about-view.tsx      口径、限制与更新说明
  mobile-tab-bar.tsx  移动端底部标签栏
  member-sheet.tsx    移动端成员 Sheet
  command-palette.tsx ⌘K 搜索场次与成员
  copy-link-button.tsx 复制当前深链
  route-error.tsx     路由错误兜底页
```

```text
src/pages/
  lazy-pages.tsx      路由级 lazy() 包装
  home-redirect.tsx   重定向到上次访问 / 首个 dataset
  home-page.tsx / streams-page.tsx / stream-index-page.tsx
  stream-page.tsx / compare-page.tsx / about-page.tsx
  legacy-redirects.tsx 旧 overview / table 地址重定向
```

```text
src/components/charts/
  chart-canvas.tsx    响应式 SVG 容器
  chart-card.tsx      Card 包装 + 空状态
  chart-frame.tsx     无卡片图表容器（标题 + 口径 + 动作）
  axis.tsx            网格线 / 刻度 / 轴标题
  sparkline.tsx       迷你曲线 / 面积，供首页与行内复用
  stream-bars.tsx     每场平均/最大同接
  chat-density.tsx    逐分钟弹幕 + SC 条 + hover
  ten-minute-bars.tsx 每 10 分钟分布
  scatter-plot.tsx    同接 × 每千同接弹幕
  currency-donut.tsx  SC 币种构成
  top-bars.tsx        横向 Top 排行
  multi-line-chart.tsx 多场逐分钟叠加
  stream-shape.tsx    典型节奏曲线（按进度对齐 + 分位带）
  stream-timeline.tsx 单场双轨时间轴（弹幕面积 + SC 刻度 + 悬停读数）
```

## 扩展点

### 加一个视图

1. 在 `src/components/dashboard/` 新建视图组件，接收 `StreamRow[]` / `DatasetTotals`。
2. 在 `src/pages/` 新建路由页面，从 `useDatasetView()` 取数据。
3. 在 `src/pages/lazy-pages.tsx` 导出 `lazy()` 组件。
4. 在 `src/router.tsx` 的 `:datasetId` children 加一条 route。
5. 在 `src/lib/routes.ts` 的 `VIEWS` 加 key，并在 `app-sidebar.tsx` 的 `NAV_ITEMS` 加导航项。
6. 需要新指标时，先加到 `src/lib/aggregate.ts`，不要在视图里重复算。

### 加一个图表

1. 用 `ChartCanvas` 包一层，拿 `width/height`。
2. 用 D3 算比例尺和 path；渲染普通 SVG。
3. 处理空数据（`EmptyChart`）和 `null` 值。
4. 给每个数据点加 `<title>`，给 SVG 加 `aria-label`。
5. 在 `docs/development.md` 的图表清单里补一行。

### 加一个 dataset

见 [adding-data.md](adding-data.md)。页面不需要改代码；`AppHeader` 在 dataset 数 > 1 时自动显示选择器。

### 加一个字段

1. 确认 JSON 里已存在该字段。
2. 更新 `src/types/datapack.ts` 或 `src/types/dataset.ts`。
3. 如需聚合，更新 `src/lib/aggregate.ts` 与测试。
4. 更新 `docs/data-model.md`。
5. 兼容旧数据：字段可能缺失时用 `?? null`，不要假设一定存在。

## 关键设计决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 图表库 | D3 + 手写 SVG | 可控、体积小、方便加自定义指标 |
| UI 库 | coss ui | Base UI 的可访问性 + Tailwind token，风格统一 |
| 数据加载 | 静态 JSON + fetch | 无后端、可静态托管、数据随仓库走 |
| 聚合位置 | 同步时预聚合 + 浏览器局部计算 | 列表页不再下载全部 datapack；单场明细按需加载 |
| 状态管理 | React 局部状态 | 页面简单，避免全局 store |
| 数据源 | `data/` → `public/data/` | 源数据可读可 diff，生成物不进 git |

## 性能与限制

- 首屏只加载 `index.json` + `manifest.json` + `insights.json`（当前约 150 KB 以内），不再一次性拉全部 datapack。
- 单场页只请求该场的 datapack；对比页最多请求所选 4 场。`fetchDatapack` 用模块级缓存与 in-flight 去重，来回切换不会重复下载。
- `insights.json` 由 `sync:data` 预聚合，页面内不再对全部场次重算 totals；`buildSummaryRows` 只做排序。
- 图表用 ResizeObserver，窗口缩放不会重建数据。
- 词频/发言者是“各场 Top 列表相加”，不是全量重扫；精确聚合需要扩展 datapack schema。
- 使用 hash 路由，刷新/分享任一页面都能还原；视图按路由 `React.lazy()` 拆包，首屏只加载当前页。
- 数据增长时只需重新 `sync:data`：manifest/insights 保持小体积，datapack 始终按需加载。
