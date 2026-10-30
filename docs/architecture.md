# 架构

## 目标与非目标

**目标**

- 把一份或多份 `stream-datapack` JSON 变成可浏览、可比较的数据台。
- 索引与预聚合随仓库走，逐场 datapack 放对象存储：纯静态托管即可运行，不需要后端。
- 新增成员 / 新增场次时，尽量只动数据，不动组件。
- 图表可控：比例尺、路径、交互都由我们自己决定，方便后续加指标。

**非目标**

- 不做直播内容的正文字幕/翻译（那是归档流程的事）。
- 不做实时抓取；数据由外部 pipeline 生成后上传对象存储。
- 不做账号体系、数据库、服务端聚合。

## 分层

```text
┌─────────────────────────────────────────────────────────┐
│ data/<dataset>/*.datapack.json   本地暂存（gitignore）    │
└───────────────────────┬─────────────────────────────────┘
                        │ scripts/publish-data.ts
                        │ 派生 index + manifest + insights，一起上传
┌───────────────────────▼─────────────────────────────────┐
│ 对象存储（R2 等）                                        │
│  <base>/index.json                                      │
│  <base>/<dataset>/manifest.json                         │
│                  insights.json                          │
│                  <videoId>.datapack.json                │
│                  thumbs/<videoId>.jpg                   │
│                  thumbs/<videoId>.<width>.webp          │
│                  transcripts/<videoId>.json             │
│  <base>/transcripts/index.json                          │
└───────────────────────┬─────────────────────────────────┘
                        │ fetch（浏览器启动时直接读取）
                        │ 索引 / manifest / insights / datapack
┌───────────────────────▼─────────────────────────────────┐
│ src/lib/data.ts          远端优先；public/data/ 只做兜底  │
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
│ src/router.tsx             path 路由表                       │
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

1. `scripts/publish-data.ts` 从 `data/<id>/*.datapack.json` 派生 `index.json`、`manifest.json`、`insights.json`，按 pack → manifest/insights → index 的顺序上传对象存储。
2. 页面启动时 `src/lib/data.ts` 先向对象存储请求 `<base>/index.json`。索引请求带时间戳，避免 CDN 返回旧副本；远端不可达或还没发布过索引时回退到 `public/data/index.json`。
3. manifest 与 insights 用索引的 `generatedAt` 作版本参数请求同一个 `<base>`，同样在失败时回退同源快照；构建阶段不重算。
4. `scripts/sync-data.mjs` 只负责生成兜底快照：配了 `DATAPACK_BASE` / `VITE_DATAPACK_BASE` 时原样拉取远端的 index / manifest / insights（带本地缓存），没配时用本地 `data/<id>/`。
5. `useDatasetIndex()` 拉 index；默认选中第一个 dataset。
6. `useDataset(datasetId)` 并行拉 manifest 与 insights，然后用 `buildSummaryRows` 得到按开播时间倒序的 `StreamSummary[]`。列表页不再等待所有 datapack。
7. 列表视图（总览 / 数据表 / 对比指标）只消费 summary 与预聚合 totals；单场和对比的逐分钟曲线通过 `useStreamPacks` 按 videoId 向对象存储请求 datapack（`VITE_DATAPACK_BASE`），`lib/data.ts` 里有缓存与并发去重。
8. 各视图消费 `rows` / `totals`；图表组件只接收已整理好的数据。
9. 组级页面走 `GroupLayout`：`useGroupData` 并行拉取所有成员的 manifest（不拉 datapack），`buildGroupData` 合成 `GroupStreamRow[]` / `GroupMemberSummary[]` / `GroupTotals`，再经 `GroupDataContext` 交给组首页与全组相册。单个成员失败时跳过并提示，不阻塞其余成员。

### 封面图

1. `bun run fetch:thumbs` 从 `manifest.streams[].videoId` 出发，把 YouTube 封面下载到 `data/<id>/thumbs/<videoId>.jpg`；`maxresdefault` → `mqdefault`，单张失败跳过。
2. 同一张原图用 `Bun.Image` 编码 480 / 960 / 1280w 的 WebP（quality 78），写到 `thumbs/<videoId>.<width>.webp`；只有原图时自动补齐，不重新下载。宽度与命名约定在 `src/lib/thumb-variants.ts`，`fetch:thumbs`、`publish:data` 与页面共用。
3. `publish:data` 按 **thumbs（原图 + 变体）→ pack → manifest / insights → index** 上传，增量判断与 pack 相同（`digestBytes` + 发布进度）。缺变体只警告，不阻塞发布。
4. 页面不直连 YouTube：`src/lib/data.ts` 的 `thumbnailUrl()` 拼原图 URL，`thumbnailSrcSet()` 拼三档变体；未配置远端时读 `public/data`。
5. `StreamCover` 统一 16:9，把 `srcset` + `sizes` 交给浏览器按布局宽度挑一档；首屏主图 `fetchPriority="high"`，其余懒加载。变体缺失时 `onError` 退回原图，再失败才走成员色兜底。

### 逐字稿

1. 源文件是 `content/transcripts/<datasetId>/<videoId>.md`（作者手写、进 git）。
2. `publish:transcripts` 解析 frontmatter → 先传正文 `<base>/<dataset>/transcripts/<videoId>.json`，最后写 `<base>/transcripts/index.json`；失败只记日志。
3. `useTranscriptIndex` / `useTranscript` 远端优先；远端不可达时回退到 Vite 的 `import.meta.glob("/content/transcripts/**/*.md")` 构建快照。
4. `react-markdown` + `remark-gfm` 渲染；`rewriteTimecodes` 把行首 `[12:34]` 换成 YouTube 深链，`extractToc` 生成目录。原始 HTML 不渲染。

## 路由与 URL 状态

使用 **React Router v8** 的 history 路由（`createBrowserRouter`），路径就是真实 URL：

- 每个页面都有独立地址，搜索引擎与社交抓取器可以分别访问；旧 `#/...` 链接由 `index.html` 的内联脚本在应用启动前改写成真实路径。
- 纯静态托管需要 SPA 回退：仓库自带 `vercel.json` 的 rewrite（排除 `assets/`、`data/`、`avatars/`）。
- 子路径部署用 `VITE_BASE`，`basename` 从 `import.meta.env.BASE_URL` 推导，路由匹配与链接自动带前缀。
- 单场、对比选择可以直接分享、刷新、前进后退。

| URL | 页面 |
| --- | --- |
| `/` | 组首页：全组脉搏（近 7 天 / 本月）、焦点场、最近更新、成员入口 |
| `/gallery?member=&type=&order=` | 全组相册：跨成员封面墙；成员 / 内容类型筛选可分享 |
| `/:datasetId` | 成员首页（L1，glance） |
| `/:datasetId/streams?q=&type=&sort=&dir=&vstats=` | 场次页（L2，browse）；筛选/排序状态可分享 |
| `/:datasetId/trends` | 趋势页；月度趋势、月度明细、内容类型对比 |
| `/:datasetId/gallery?order=asc` | 相册；按 JST 自然月分组的封面墙，`order=asc` 为最早在前 |
| `/:datasetId/transcripts` | 逐字稿索引；按月份列出已有稿件 |
| `/:datasetId/stream` | 跳转到最新一场 |
| `/:datasetId/stream/:videoId?view=` | 单场详情（L3，inspect）；`view` 为 `overview`/`timeline`/`words`/`paid`/`comments`/`transcript`（仅在有稿时出现） |
| `/:datasetId/compare?ids=a,b,c` | 对比，最多 4 场 |
| `/:datasetId/about` | 说明 |
| `/:datasetId/overview`、`/:datasetId/table` | 旧地址，分别重定向到成员首页与场次页 |

路由表在 `src/router.tsx`，根路由与 `:datasetId` 都配置了 `errorElement`（`route-error.tsx`），渲染或懒加载异常会显示兜底页而不是白屏。`src/pages/` 是薄包装层：从 `useDatasetView()` 取数据、把导航动作接到 `navigate`，视图组件本身不依赖 router。

数据表的查询参数由 `src/lib/table-params.ts` 解析/序列化：`q` 搜索词、`type` 内容类型、`sort` 排序字段、`dir` 方向（`asc`/`desc`）、`vstats=1` 只看有 VSTATS 的场次、`member=1` 只看会员限定、`cols` 追加显示的指标列（默认只显示日期/场次/时长/峰值/播放/弹幕）。默认值不写进 URL，参数变化用 `replace`，避免输入搜索词时污染历史记录。

## SEO

每个页面在构建时生成一份带完整 head 的静态 HTML；运行中切换路由时，由 `useSeo` 更新同一组标签。

- `src/lib/seo.ts`：纯函数 `buildSeo()` / `buildSitemap()`，客户端与构建脚本共用。标题、描述、canonical、OG 类型、JSON-LD 全部在这里定义；不读 `import.meta.env`、不碰 DOM，可在 node 环境测试。
- `src/hooks/use-seo.ts`：按 key upsert `<meta>`、`<link rel="canonical">` 与 JSON-LD，当前页面没有的受管 key 会删除，避免 SPA 导航残留上一页的 og / twitter 标签。
- `DatasetLayout` / `GroupLayout` 各调用一次 `useSeo`：数据到齐后把场次数、最新一场、真实指标写进描述；`RouteError`、不存在的单场、根路由未匹配路径都标 `noindex`。
- 分享图取该场封面（对象存储 `<dataset>/thumbs/<videoId>.jpg`，绝对地址）；没有封面时退回该成员最近一场。
- canonical 永远是绝对地址且不带 query：`?view=`、表格筛选、相册筛选都归一到基路径。
- `scripts/generate-seo.ts` 在 `vite build` 之后按 `<!--seo:start-->` / `<!--seo:end-->` / `<!--seo:body-->` 标记注入 head 与 `<noscript>` 摘要，为组首页、全组相册、每位成员的 6 个栏目页与 1891 个单场页各写一份 `dist/<path>/index.html`；同时输出 `dist/sitemap.xml` 与 `dist/robots.txt`。
- 结构化数据只做低风险的 `WebSite` / `BreadcrumbList` / `WebPage`，不做 `VideoObject`（页面主体是分析，不是视频本身）。
- 对比页与未知路径不收录；单场页在静态托管上仍是 200，用 `noindex` 兜底（真 404 需要服务端函数，非目标）。
- 新场次通过 `publish:data` 发布后客户端 meta 立即正确；静态 head 要等下一次构建（CI）才会更新。

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
  group-layout.tsx    组级壳层：全组数据加载 + Outlet（组首页 / 全组相册）
  group-data-context.ts  GroupData 的 context
  group-hero.tsx      组首页首屏：最近一场焦点 + 其他成员列表 + 本周活跃
  group-pulse.tsx     近 7 天 / 本月三项数字 + 全组累计脚注
  group-recent-updates.tsx 跨成员最近更新列表
  group-member-entries.tsx 按成员进入 + 全组相册入口
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
  home-calendar.tsx    更新日历：按日热力图 + 场次 / 弹幕 / SC 指标切换
  stream-cover.tsx     16:9 封面：远端优先、懒加载、成员色兜底
  gallery-view.tsx     相册：按 JST 自然月分组的封面墙
  transcript-view.tsx  单场逐字稿：Markdown 渲染、目录、时间戳跳转
  transcripts-view.tsx 逐字稿索引：按月份列出已有稿件
  home-content-mix.tsx / home-meter-row.tsx / home-top-words.tsx / home-top-authors.tsx
  streams-view.tsx    L2 场次页（表格 + 工具条）
  streams-toolbar.tsx 搜索、类型筛选、仅有 VSTATS / 会员、列选择、导出 CSV、移动端筛选 Sheet
  trends-view.tsx     趋势：月度趋势、月度明细、内容类型对比
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
  group-home-page.tsx / group-gallery-page.tsx
  home-page.tsx / streams-page.tsx / stream-index-page.tsx / trends-page.tsx
  gallery-page.tsx / transcripts-page.tsx
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
  calendar-heatmap.tsx 按日热力图（场次 / 弹幕 / SC）
  trend-line.tsx      月度趋势折线（单指标 + 空值断线）
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
7. 组级（跨成员）视图挂在根路由的 `GroupLayout` 下：把 key 加进 `GROUP_VIEWS`，数据从 `useGroupDataContext()` 取 `GroupData`。

### 加一个图表

1. 用 `ChartCanvas` 包一层，拿 `width/height`。
2. 用 D3 算比例尺和 path；渲染普通 SVG。
3. 处理空数据（`EmptyChart`）和 `null` 值。
4. 给每个数据点加 `<title>`，给 SVG 加 `aria-label`。
5. 在 `docs/development.md` 的图表清单里补一行。

### 加一个 dataset

见 [adding-data.md](adding-data.md)。页面不需要改代码；`AppHeader` 在 dataset 数 > 1 时自动显示选择器。

### 加一篇逐字稿

见 [adding-data.md](adding-data.md) 的「加逐字稿」。稿件只影响 `/:datasetId/transcripts` 与单场页的「逐字稿」分段，不改路由或组件。

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
| 数据加载 | 索引静态托管 + datapack 对象存储 | 无后端；大文件不进 git，按需拉取 |
| 聚合位置 | 发布时预聚合 + 浏览器局部计算 | 列表页不需要任何 datapack；预聚合由 publish 生成 |
| 状态管理 | React 局部状态 | 页面简单，避免全局 store |
| 数据源 | pack 派生 index/manifest/insights，整体上传对象存储 | 单一真源，索引不会与 pack 漂移；发布即生效 |
| 封面 | 镜像到对象存储，不热链 YouTube | URL 稳定、无 CORS/限流，相册可懒加载 |
| 逐字稿 | git 存 Markdown，发布成 JSON，运行时渲染 | 作者可版本管理；发布即生效，不重构建 |
| 精确词频 / 发言者 | 全量字段写进 v2 datapack，发布时聚合 | 只保留一份真源；页面不重扫，换机器恢复 pack 后仍可精确重算 |

## 性能与限制

- 首屏只加载 `index.json` + 当前 dataset 的 `manifest.json` + `insights.json`（单个 dataset 约 300 场时约 400 KB，gzip 后约 47 KB），不拉任何 datapack。
- 单场页只请求该场的 datapack；对比页最多请求所选 4 场。`fetchDatapack` 用模块级缓存与 in-flight 去重，来回切换不会重复下载。
- `insights.json` 由 `publish:data` 预聚合，页面内不再对全部场次重算 totals；`buildSummaryRows` 只做排序。
- 图表用 ResizeObserver，窗口缩放不会重建数据。
- 词频/发言者：v2 datapack 带全量 `wordCounts` / `authors`，`publish:data` 据此精确聚合；v1 场次逐场回退到 Top 列表，`insights.totals.aggregation` 标明 `full` / `partial` / `top-lists` 与覆盖率。
- v2 datapack 单场约多 20–30 KB（全量词表 + 作者），只在单场页按需下载；首屏与列表页不读这些字段。
- 使用 path 路由，刷新/分享任一页面都能还原；视图按路由 `React.lazy()` 拆包，首屏只加载当前页。
- 构建产物会多出约 1900 个静态 HTML（每个路由一份 head）+ `sitemap.xml` / `robots.txt`，体积约 15 MB；它们只影响托管文件数，不进入首屏 JS。
- 索引每次启动带时间戳重新取；manifest / insights 用索引的 `generatedAt` 做版本参数，发布后自动换 URL，不吃 CDN 旧缓存；datapack 按 videoId 长缓存。仓库体积与场次数无关。
- manifest 会随场次线性增长（3000 场约 4 MB raw / 460 KB gzip）。再往上需要按年份切片或引入服务端分页。
- 封面原图约 144 KB（1280×720 JPEG），三档 WebP 分别约 24 / 56 / 78 KB；列表与相册靠 `srcset` 只下 480w，首屏主图下 960w 或 1280w。相册按可视区域懒加载，`StreamCover` 用 `aspect-video` 预留高度，避免 CLS。
- 逐字稿的构建快照走 `import.meta.glob`，稿件数量大时 bundle 会增长；超过百篇后把兜底改为 `public/data` 快照。
