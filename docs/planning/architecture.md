# 架构

> **当前形态（2026-11-04）**：Astro 7 SSR + Cloudflare Workers + Neon PostgreSQL。页面路由在 `src/pages/`，数据入口在 `src/db/queries/`，对象存储只放封面、表情、原始 pack 归档与逐字稿正文。迁移记录见 [archive/astro-ssr-migration.md](../archive/astro-ssr-migration.md)。

## 目标与非目标

**目标**

- 把一份或多份 `stream-datapack` JSON 变成可浏览、可比较的数据台。
- 新场次入库后立刻可在页面看到，不需要重新构建前端。
- 列表、筛选、聚合、检索由 SQL 完成；浏览器只做交互与图表。
- 新增成员 / 新增场次时，只动数据，不动组件。
- 图表可控：比例尺、路径、交互都由我们自己决定。
- Agent 可以通过 `/{datasetId}/stream/{videoId}.md` 一次拿到结构化摘要与逐字稿。

**非目标**

- 不做直播内容的正文字幕 / 翻译（那是归档流程的事）。
- 不做实时抓取；数据由外部 pipeline 抓取后入库。
- 不做账号体系、评论发布、收藏。
- 第一版不把 691 万条原始弹幕逐条入库。

## 运行模型

```text
浏览器
  └─ Cloudflare Workers（Astro SSR）
       ├─ 静态资源        ASSETS binding
       ├─ 数据页          查 PostgreSQL → 渲染 HTML → Workers Cache
       ├─ 单场 .md        查库 + 读 R2 逐字稿 → text/markdown
       ├─ sitemap / llms  查库生成 → 缓存
       └─ 内部 purge 端点  按 Cache-Tag 失效
```

- `output: 'server'`；只有 `/404`、`/500`、`/:datasetId/about` 显式预渲染。
- 数据页在请求期查库，`Astro.cache.set()` 声明 TTL 与 tag。
- 浏览器不读 manifest / insights / datapack JSON；首屏数据由页面查询后传给岛屿。

## 分层

```text
data/<dataset>/*.datapack.json        本地暂存（gitignore，唯一真源）
        │
        ├─ scripts/ingest-db.ts  ──→ Neon PostgreSQL
        │     datasets / streams / stream_details
        │     paid_events / comments / authors / stream_authors
        │     stream_words / dataset_insights / transcripts / ingest_reports
        │
        └─ scripts/publish-data.ts ──→ Cloudflare R2
              <dataset>/thumbs/<videoId>.jpg|webp
              emojis/<dataset>/*
              archive/<dataset>/<videoId>.datapack.json
              <dataset>/transcripts/<videoId>.json

请求
  src/pages/*.astro
    → src/db/queries/*（Drizzle / SQL）
    → 可序列化 DTO
    → .astro 输出正文 + 岛屿 props
```

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| `scripts/` | 抓取、归一化、ingest、资产发布、缓存失效 | 页面渲染 |
| `src/db/` | schema、查询、事务连接 | HTTP / DOM |
| `src/lib/` | 纯函数：聚合、格式化、SEO、Markdown | 数据库连接 |
| `src/pages/*.astro` | 路由、取数、SEO、布局 | 复杂交互 |
| `src/components/*` | 视图与 React 岛屿 | 首屏数据 fetch |
| R2 | 不可变对象 | 查询、排序、聚合 |

## 数据流

1. 抓取脚本写 `data/<id>/*.datapack.json`；`ingest-db` 逐场事务 upsert 到 PostgreSQL，并在成员全部写完时重算 `dataset_insights`。
2. `publish-data --assets-only` 上传封面、表情与 archive；`publish-transcripts` 上传逐字稿正文。
3. 数据库提交后调用 `POST /api/internal/cache/purge`，按 `stream-<id>` / `dataset-<id>` / `group` / `sitemap` / `llms` / `transcripts` 失效。
4. 页面请求：`.astro` frontmatter 查库 → DTO → 服务端输出正文 → 岛屿接管交互。
5. 单场正文的完整 pack 由服务端查询后随 SSR 下发；对比页只取 `stream_details.density.perMinute`，切换场次时走 `/api/densities/:datasetId?ids=...` 补拉。`/api/packs/:datasetId/:videoId` 保留给确实需要完整 pack 的调用方，不读 R2。

### 封面图

1. `bun run fetch:thumbs` 下载 YouTube 封面到 `data/<id>/thumbs/<videoId>.jpg`，并生成 480 / 960 / 1280w WebP。
2. `publish-data --assets-only` 按增量上传到 `<dataset>/thumbs/`。
3. 浏览器通过 `PUBLIC_R2_BASE` 直接访问，`StreamCover` 用 `srcset` / `sizes` 选档；失败时走成员色兜底。
4. 页面不热链 YouTube。

### 逐字稿

1. 源文件是 `content/transcripts/<datasetId>/<videoId>.md`（作者手写、进 git）。
2. `publish-transcripts` 上传正文到 `<dataset>/transcripts/<videoId>.json`；`ingest-db` 把 frontmatter 写入 `transcripts` 表。
3. 索引页与单场「逐字稿」入口查库（SSR）；正文由 `/api/transcripts/:datasetId/:videoId` 从 R2 binding 读取，浏览器只请求同源 API。
4. 开发环境没有 R2 时，客户端回退到 `import.meta.glob("/content/transcripts/**/*.md")` 构建快照。
5. `react-markdown` + `remark-gfm` 渲染；`rewriteTimecodes` 把行首 `[12:34]` 换成 YouTube 深链。

## 查询层

```text
src/db/
  schema.ts          Drizzle 表定义
  connection.ts      createDb（neon-http，读）/ createWriteDb（Pool，ingest）
  client.ts          Worker 单例只读连接
  queries/
    datasets.ts      getDatasets / getDataset
    streams.ts       listStreams / getStream / getStreamNeighbors / getLatestStream
    group.ts         getGroupSummary / getGroupGallery
    insights.ts      getDatasetInsights
    transcripts.ts   getTranscriptIndex / getTranscriptMeta
    packs.ts         从数据库还原 StreamDatapack
    view-data.ts     页面 DTO 组装
```

约定：

- 聚合在 SQL 里做；不要把全量场次拉到 Worker 再算。
- 子表用 `inArray` 或 `json_agg` 一次取回，避免 N+1。
- `numeric` 在 JS 里是字符串；查询层统一转 `number | null`。
- 时间返回 ISO 字符串，格式化在 `src/lib/format.ts`。
- `rank` 用窗口函数计算，不落库。
- 列表首屏最多渲染 100 行 / 60 张封面，其余由「显示更多」接管。

## 渲染与岛屿

| 内容 | 渲染方式 |
| --- | --- |
| 标题、指标、日期、简介、逐字稿入口 | SSR，不在 `client:only` |
| 侧栏、顶栏、移动端标签栏 | `src/components/app/*` 包一个岛屿 |
| 图表 | `client:visible`；D3 只算比例尺与 path |
| 表格工具条、筛选、CSV | `client:idle`，首屏行由 SSR 输出 |
| 命令面板 | 首次 `⌘K` 动态加载 |

- 岛屿 props 必须可序列化；查询层只返回字符串 / 数字 / 布尔 / 数组 / 普通对象。
- 首屏数据由页面传入，组件不自己 fetch manifest。
- URL 状态（`q` / `type` / `sort` / `dir` / `vstats` / `member` / `cols` / `view` / `ids` / `members` / `months`）由服务端读初始值，岛屿用 `history.replaceState` 同步。
- 组级全员对比把「成员 × 月份 × 内容类型」预聚合成桶，筛选在岛屿内重算，不发额外请求。

## 路由

| URL | 页面 | 渲染 |
| --- | --- | --- |
| `/` | 组首页 | SSR |
| `/gallery?member=&type=&order=` | 全组相册 | SSR |
| `/compare?members=&type=&months=` | 全员对比（组级，聚合统计） | SSR |
| `/:datasetId` | 成员首页 | SSR |
| `/:datasetId/streams?q=&type=&sort=&dir=&vstats=` | 场次列表 | SSR |
| `/:datasetId/trends` | 趋势 | SSR |
| `/:datasetId/gallery?order=` | 成员相册 | SSR |
| `/:datasetId/transcripts` | 逐字稿索引 | SSR |
| `/:datasetId/stream` | 302 → 最新一场 | endpoint |
| `/:datasetId/stream/:videoId?view=` | 单场详情 | SSR |
| `/:datasetId/stream/:videoId.md` | Agent Markdown | SSR endpoint |
| `/:datasetId/compare?ids=` | 对比，最多 4 场 | SSR |
| `/:datasetId/about` | 说明 | 预渲染 |
| `/:datasetId/overview` | 302 → 成员首页 | 页面 |
| `/:datasetId/table` | 302 → 场次列表 | 页面 |
| `/sitemap.xml`、`/llms.txt` | SEO / Agent 入口 | SSR endpoint |
| `/api/packs/:datasetId/:videoId` | 单场 pack | endpoint |
| `/api/transcripts/:datasetId/:videoId` | 逐字稿正文 | endpoint |
| `/api/internal/cache/purge` | 内部缓存失效 | endpoint |

站内导航用 `<a href>`（ClientRouter 接管）；脚本内用 `navigate()`。不要用 `window.location.href`。

## 缓存与失效

- 数据页用 `Astro.cache.set({ maxAge, swr, tags })`；endpoint 用 `context.cache.set()`。
- 404 与 purge 端点 `no-store`，避免未知单场被长期缓存。
- tag：`group`、`gallery`、`dataset-<id>`、`stream-<videoId>`、`transcripts`、`sitemap`、`llms`。
- ingest 提交后调用 purge；缓存是 Workers Cache，zone 级 purge 不影响它。
- 部署默认 `cross_version_cache: false`，新版本从冷缓存开始。

## SEO 与 Agent

- `src/lib/seo.ts` 定义 title / description / canonical / OG / JSON-LD；`SEO.astro` 在请求期输出。
- 单场页静态 head 由 SSR 直接输出，不再有构建期注入脚本。
- `sitemap.xml` 查 `datasets` + `streams`，条数为 `2 + 6 × 成员数 + 单场数`。
- `.md` 不进 sitemap，带 `X-Robots-Tag: noindex`；HTML 单场页带 `<link rel="alternate" type="text/markdown">`。
- `llms.txt` 列出成员、最近场次与 `.md` 链接。

## 图表策略：React + D3

**React 拥有 DOM，D3 只负责数学。** 不使用 `d3-selection` 操作 React 渲染的节点。

- 尺寸：`ChartCanvas` + `useElementWidth`（ResizeObserver）。
- 比例尺：`scaleLinear` / `scaleBand` / `scaleSqrt`。
- 形状：`line` / `area` / `pie` / `arc`。
- 渲染：普通 SVG 元素，由 React 输出。
- 颜色：`CHART_COLORS` 映射到 coss 主题 token。
- 可访问性：每个 SVG 有 `aria-label`，数据标记有 `<title>`。

## 目录

```text
src/pages/                文件路由 + endpoint
src/layouts/Layout.astro  SEO、主题内联脚本、ClientRouter、全局岛屿
src/components/app/       DatasetPage / GroupPage / 侧栏 / 顶栏 / 标签栏
src/components/dashboard/ 视图组件（表格、相册、单场、趋势、对比……）
src/components/charts/    D3 数学 + React SVG
src/components/ui/        coss primitives（生成，不写业务）
src/components/shared/    SEO.astro / router-compat
src/db/                   schema、连接、查询
src/lib/                  纯函数与 DTO（aggregate / format / seo / agent-markdown）
src/types/                datapack / dataset / db DTO
```

## 扩展点

### 加一个页面

1. 在 `src/pages/` 新建 `.astro`，显式 `export const prerender = false`。
2. 在 frontmatter 查库，组装可序列化 props。
3. 视图挂在 `DatasetPage` / `GroupPage` 的分支里，或新建岛屿。
4. 在 `src/lib/routes.ts` 与 `dashboard/shell/app-sidebar.tsx` 的 `NAV_ITEMS` 补路由。
5. 补 `sitemap.xml`（如果应该被收录）与缓存 tag。

### 加一个图表

1. 用 `ChartCanvas` 包一层，拿 `width/height`。
2. 用 D3 算比例尺和 path；渲染普通 SVG。
3. 处理空数据与 `null` 值。
4. 给数据点加 `<title>`，给 SVG 加 `aria-label`。

### 加一个 dataset

见 [adding-data.md](../data/adding-data.md)。把成员加进 `data-sources.json`，ingest 后页面自动出现。

### 加一篇逐字稿

见 [adding-data.md](../data/adding-data.md)。稿件只影响逐字稿索引与单场分段，不改路由。

### 加一个字段

1. 确认 pack 里已有该字段。
2. 更新 `src/types/datapack.ts` 与 `src/db/schema.ts`。
3. 更新 `ingest-db` 投影与查询层 DTO。
4. 如需聚合，更新 `src/lib/aggregate.ts` 与测试。
5. 更新 `docs/data/data-model.md`。

## 关键设计决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 渲染 | Astro SSR + 岛屿 | 首屏完整 HTML，交互按需水合 |
| 数据 | PostgreSQL 查询 + R2 对象 | 排序 / 筛选 / 聚合走 SQL，大对象不撑库 |
| 图表库 | D3 + 手写 SVG | 可控、体积小 |
| UI 库 | coss ui | Base UI 可访问性 + Tailwind token |
| 聚合位置 | ingest 预聚合 + SQL | 请求期不重算全量场次 |
| 状态管理 | URL + 局部状态 | 可分享、可刷新，避免全局 store |
| 缓存 | Workers Cache + tag purge | 数据更新不靠重新部署 |
| 标题搜索 | SQL（可选 pg_trgm） | 不为单个数字拉完整 manifest |

## ADR

### ADR-001：Astro 文件路由 + 请求期 SSR

- **决策**：页面在 `src/pages/`，`output: 'server'`，只有稳定页预渲染。
- **理由**：单场页入库即生效；真 404；请求期输出完整 SEO head。
- **后果**：依赖数据库与 Workers 运行时；需要错误态与缓存策略。

### ADR-002：D3 只算数学，React 拥有 DOM

- **决策**：D3 只算比例尺与形状，SVG 节点由 React 渲染。
- **理由**：避免争抢节点；新增指标只改比例尺与 path。
- **后果**：图表需要 `ChartCanvas` 提供宽度；空值与 `null` 显式处理。

### ADR-003：coss UI + Tailwind Token

- **决策**：基础组件来自 `src/components/ui/`；颜色 / 圆角 / 间距用 CSS 变量。
- **理由**：可访问性 + 统一风格；浅色 / 深色同时成立。
- **后果**：不手写基础组件；不硬编码颜色。

### ADR-004：PostgreSQL 是查询面，R2 是对象面

- **决策**：结构化数据进库；封面、表情、archive、逐字稿正文放 R2。
- **理由**：SQL 支持排序 / 筛选 / 聚合 / 检索；对象存储适合不可变大文件。
- **后果**：新场次需要 ingest；缓存失效与数据库新鲜度绑定。

### ADR-005：时间一律 JST，金额不换算汇率

- **决策**：所有时间按 JST（UTC+9）展示；SC / 贴纸金额按原始币种分组。
- **理由**：成员与观众都在日本时区；汇率换算不可追溯。
- **后果**：跨币种不能直接相加；旧数据缺时区时按 JST 解释。

### ADR-006：Agent 用 `.md` 路由，不做内容协商

- **决策**：`/{datasetId}/stream/{videoId}.md` 返回 `text/markdown`，不实现 `Accept` 协商。
- **理由**：独立 URL 可缓存、可发现、不产生缓存变体；内容更完整。
- **后果**：`.md` 不进 sitemap，需要 `noindex` 防重复收录。

### ADR-007：行为状态用显式联合与单一判定函数

- **决策**：需要转移的行为状态用判别联合或单一判定函数表达；能落库的状态在写入时记录，依赖 `now` 的状态只允许一个函数计算。副作用返回可区分的结果类型（命中 / 缺失 / 未配置 / 跳过 / 错误），不用布尔或 `null` 折叠。
- **理由**：当前生命周期多由可空字段与时间组合推导，同一事实在不同入口出现分歧；授权与缓存把「未执行」报成「成功」，无法在调用方区分。显式状态能审计、能测试，也能避免同一规则多份实现。
- **后果**：新增状态需要同时更新类型、判定函数与测试；数据库迁移只为可审计的生命周期服务，读时派生仍保留给直播状态等短周期值。方案与阶段见 [archive/state-machine-remediation.md](../archive/state-machine-remediation.md)。

## 性能与限制

完整记录见 [performance.md](../engineering/performance.md)。当前关键数字：

- 全量场次已入库；列表 + insights 查询本机 → ap-southeast-1 的 p50 约 120 ms。
- 首屏 HTML：`/` 约 99 KB、`/gallery` 约 1.65 MB、`/nonoka/streams` 约 1.16 MB、单场约 696 KB、`.md` 约 14 KB、`sitemap.xml` 192 KB。
- 列表首屏 100 行、相册首屏 60 张，其余「显示更多」。
- 跨区 Neon RTT 是 SSR 的主要延迟；Workers 同区部署后应显著下降。
- Workers Free 10 ms CPU 可能不足，上线前用 Paid 并观察 CPU / wall time。
