# Astro + Cloudflare 迁移方案

> 状态：实施中。阶段 0（Astro 脚手架）于 2026-11-03 完成；阶段 1（数据库与 ingest）未开始。调研日期 2026-11-03（JST）。
> 目标：把当前的 React Router 8 + Vite 静态站迁到 Astro 7 + Cloudflare Workers，数据从「R2 上的 JSON + 浏览器运行时拉取」改为「PostgreSQL 查询 + R2 存对象」，单场页改为请求期 SSR，并为 Agent 提供 `{videoId}.md` 的 Markdown 视图。
> 本文只描述已经验证过 API 的方案，不把未验证的平台行为写成事实。

## 目录

1. 结论
2. 目标与非目标
3. 平台与版本基线
4. 目标架构
5. 渲染模型
6. 数据模型
7. 数据摄取
8. 查询层
9. 页面迁移
10. Agent Markdown（`.md` 路由）
11. 缓存与失效
12. 发布流程
13. 迁移步骤
14. 验收清单
15. 风险与待决
16. 参考

## 1. 结论

采用 **Astro 7 + `@astrojs/cloudflare` 14 + Cloudflare Workers + Neon PostgreSQL + Drizzle + R2**。

核心判断：

- **数据页全部请求期 SSR，不做全站 SSG。** 单场页、成员页、列表页从数据库查询后直接输出 HTML；新场次入库后不需要构建，也不需要 R2 反代或静态页全量重生成。
- **PostgreSQL 是查询面，R2 是对象面。** 结构化、要排序/筛选/聚合/检索的数据进库；逐字稿正文、封面、表情、原始 datapack 归档放 R2。
- **只预渲染真正稳定的页面。** `/about`、404、静态资源走 `prerender = true`；其余数据页 `prerender = false`。
- **Agent 视图用 `.md` 路由后缀作为唯一契约。** 不实现 `Accept: text/markdown` 内容协商，也不依赖 Cloudflare Markdown for Agents。`/{datasetId}/stream/{videoId}.md` 直接返回结构化 Markdown，包含概览、部分指标和原始逐字稿。
- **缓存用 Astro 7 的 route caching + Cloudflare Workers Cache。** 数据更新后按 tag purge，不靠重新部署。

这套方案替代 [ssg-research.md](../archive/ssg-research.md) 里的「完整重建 / R2 混合 / 全站 SSG」三条路线。那份文档里的静态页预渲染、稳定入口、`asset hash`、Vercel 2048 routes 等问题，在 SSR + 数据库方案里不再出现。

### 与旧方案的关键差异

| 维度 | 当前 / 旧方案 | 新方案 |
| --- | --- | --- |
| 单场页 | 构建期写静态 HTML，数据更新后过期 | 请求期查库 SSR，入库即生效 |
| 新场次上线 | 触发构建 / 写 R2 静态对象 | 只做增量 ingest + cache purge |
| 索引 / manifest | R2 上的 JSON，浏览器 fetch | PostgreSQL 查询 |
| 列表筛选 | 浏览器拉 manifest 后本地过滤 | SSR 查询 + 岛屿内交互 |
| 全文检索 / 聚合 | 浏览器重算或离线脚本 | SQL / 物化预聚合 |
| 逐字稿 | R2 JSON，运行时 fetch | 正文 R2，元数据入库 |
| SEO | 构建期 `generate-seo` 注入 | 请求期输出完整 HTML + 自定义 sitemap |
| 未知单场 | 静态托管软 404 | SSR 真 404 |

## 2. 目标与非目标

### 目标

- 一位成员新增一场后，只写数据库和 R2，页面在下一次请求（或 purge 后）就能看到，不触发前端构建。
- 单场页、成员页、组首页、趋势、相册、对比、逐字稿索引都由数据库查询驱动。
- R2 只承担不可变对象：逐字稿正文、封面原图与 WebP 变体、表情、原始 datapack 归档。
- 保留现有分析能力：逐分钟曲线、Top 词/发言者、SC 明细、评论、跨场对比。
- 为后续「完整弹幕入库 / 检索 / 观众重叠」留出 schema 扩展位。
- Agent 可以通过 `.md` 一次拿到一场直播的结构化摘要和逐字稿，不需要解析 HTML。
- 保留现有 URL、分享链接、键盘快捷键、主题、移动端布局。

### 非目标

- 不做实时抓取 / 直播中数据。
- 不做用户系统、评论发布、收藏。
- 不在第一版把 691 万条原始弹幕全部入库。
- 不做 `Accept` 内容协商，也不做 Cloudflare Markdown for Agents 的配置。
- 不做增量静态生成；SSR 下没有这个概念。
- 不做多区域读写分离或自建数据库。

## 3. 平台与版本基线

### 依赖

| 项 | 版本 / 选择 | 说明 |
| --- | --- | --- |
| Astro | 7.x | 模板当前 `^7.4.5` |
| `@astrojs/cloudflare` | 14.x | `output: 'server'`，Workers 部署 |
| React | 19.x | 岛屿 |
| Tailwind CSS | 4.x | 模板已配置 |
| coss-ui | 模板 `src/components/ui/` | 57 个组件，可直接复用 |
| PostgreSQL | Neon | `drizzle-orm` + `@neondatabase/serverless` |
| 对象存储 | Cloudflare R2 | 逐字稿、封面、表情、原始 pack |
| 缓存 | Astro route caching + Workers Cache | `cacheCloudflare()` |
| 包管理 | Bun 1.4+ | 与当前仓库一致 |
| 运行时 | Cloudflare Workers | `nodejs_compat` |

### Workers 限额（2026-10 文档）

| 项 | Free | Paid |
| --- | --- | --- |
| 请求 | 100,000/天 | 无限制 |
| CPU / 请求 | 10 ms | 默认 30 秒，最高 5 分钟 |
| 内存 / isolate | 128 MB | 128 MB |
| 子请求 / 请求 | 50 | 10,000 |
| 同时打开连接 / 请求 | 6 | 6 |

SSR 页面要控制 CPU：数据库等待不计 CPU，但大表 SSR、复杂 Markdown 渲染会算。按当前 1,892 场、500 行/成员的规模，单页查询和渲染都在可控范围；上线前用 Workers 日志记录 CPU 与 wall time。

### 数据库驱动

- **Worker 读路径**：`drizzle-orm/neon-http`，单次查询一次 HTTP 往返，适合只读页面。
- **ingest 写入路径**：Neon HTTP 驱动不支持交互式事务。ingest 跑在 GitHub Actions / Bun，使用 `postgres`（或 `pg`）直连，或用 Neon WebSocket 驱动的 Pool，保证「一场直播的多张子表」在一个事务里提交。
- 不要把 ingest 放进 Worker；Worker 只读。

### R2 访问方式

- **Worker 运行时**：通过 `wrangler.jsonc` 的 `r2_buckets` 绑定读取逐字稿与原始 pack，避免运行时 S3 凭据和外网往返。
- **浏览器**：封面 / 表情走 R2 公开自定义域名；逐字稿正文不直接暴露给浏览器，由 SSR 页面渲染。
- **发布脚本**：继续用现有 S3 兼容客户端（Bun `S3Client` / `aws4fetch`）写对象。
- 构建期不需要 R2 凭据：页面都在请求期查库；只有 `/about` 等静态页不依赖 R2。

## 4. 目标架构

```text
抓取（GitHub Actions / 本地，现有脚本）
  daily-update.ts
    → data/<id>/*.datapack.json
        │
        ├─ ingest-db.ts（新）
        │    校验 → upsert 事务 → ingest_reports
        │         │
        │         ▼
        │   Neon PostgreSQL
        │     datasets / streams / stream_details
        │     paid_events / comments / authors
        │     stream_words / transcripts / insights
        │
        └─ publish-assets.ts（由 publish:data 拆分）
             逐字稿正文 / 封面 / 表情 / 原始 pack
                 │
                 ▼
             Cloudflare R2
               transcripts/<datasetId>/<videoId>.json
               <datasetId>/thumbs/*
               emojis/*
               archive/<datasetId>/<videoId>.datapack.json

请求
  Cloudflare Workers（Astro SSR）
    ├─ 静态资源：ASSETS 直接返回
    ├─ 数据页：查 PostgreSQL → 渲染 HTML → Workers Cache
    ├─ .md 页：查 PostgreSQL + 读 R2 逐字稿 → text/markdown
    ├─ sitemap.xml / llms.txt：查库生成，缓存
    └─ 内部 purge 端点：ingest 后按 tag 失效
```

### 分层职责

| 层 | 负责 | 不负责 |
| --- | --- | --- |
| `scripts/` | 抓取、归一化、ingest、资产发布 | 页面渲染 |
| `src/db/` | schema、查询、事务 | HTTP / DOM |
| `src/lib/` | 纯函数：聚合、格式化、分类、SEO、Markdown | 数据库连接 |
| `src/pages/*.astro` | 路由、取数、SEO、布局 | 复杂交互 |
| `src/components/*` | 视图与 React 岛屿 | 直接 fetch 数据（首屏数据由页面传入） |
| R2 | 不可变对象 | 查询、排序、聚合 |

## 5. 渲染模型

`astro.config.mjs` 使用 `output: 'server'`，每个页面显式声明 `export const prerender`。默认按需渲染，只有明确稳定的页面才预渲染。

### 路由表

| 路由 | 渲染 | 缓存 | Cache-Tag | 岛屿 |
| --- | --- | --- | --- | --- |
| `/` | SSR | `maxAge: 60, swr: 300` | `group` | 组首页交互、成员入口 |
| `/gallery` | SSR | `maxAge: 300, swr: 600` | `group`, `gallery` | 筛选 |
| `/:datasetId` | SSR | `maxAge: 60, swr: 300` | `dataset-<id>` | 日历、指标切换 |
| `/:datasetId/streams` | SSR | `maxAge: 60, swr: 300` | `dataset-<id>` | 表格工具条 |
| `/:datasetId/trends` | SSR | `maxAge: 300, swr: 600` | `dataset-<id>` | 图表 |
| `/:datasetId/gallery` | SSR | `maxAge: 300, swr: 600` | `dataset-<id>` | 排序 / 筛选 |
| `/:datasetId/transcripts` | SSR | `maxAge: 300, swr: 600` | `dataset-<id>`, `transcripts` | 无 |
| `/:datasetId/stream/:videoId` | SSR | `maxAge: 300, swr: 600` | `stream-<videoId>`, `dataset-<id>` | 分段切换、图表 |
| `/:datasetId/stream/:videoId.md` | SSR endpoint | `maxAge: 300, swr: 600` | `stream-<videoId>`, `dataset-<id>` | 无 |
| `/:datasetId/compare` | SSR | `maxAge: 60, swr: 300` | `dataset-<id>`, `compare` | 选择与图表 |
| `/:datasetId/about` | 预渲染 | 静态 | — | 无 |
| `/:datasetId/overview` | 302 → `/:datasetId` | — | — | — |
| `/:datasetId/table` | 302 → `/:datasetId/streams` | — | — | — |
| `/:datasetId/stream` | 302 → 最新一场 | — | — | — |
| `/sitemap.xml` | SSR endpoint | `maxAge: 300, swr: 600` | `sitemap` | 无 |
| `/llms.txt` | SSR endpoint | `maxAge: 300, swr: 600` | `llms` | 无 |
| `/robots.txt` | 静态 | — | — | — |
| `/api/internal/cache/purge` | SSR endpoint | `no-store` | — | 无 |
| `/404` | 预渲染 | — | — | 无 |

说明：

- 缓存值用 `Astro.cache.set({ maxAge, swr, tags })`（页面）或 `context.cache.set(...)`（endpoint）；也可以在 `astro.config.mjs` 的 `routeRules` 里给整组路由设默认值，再由页面覆盖。
- `Cache-Tag` 只允许可打印 ASCII、不能含空格。`stream-W0bKqP-Eyj4`、`dataset-nonoka` 这类格式是安全的。
- 404 和 purge 端点显式 `no-store`，避免 Workers Cache 按默认启发式缓存。
- 302 用 `Astro.redirect()` 或 `src/pages/_redirects` 的静态规则；动态重定向不要写进 `_redirects`。
- `.md` 路由的文件名是 `src/pages/[datasetId]/stream/[videoId].md.ts`。Astro 会去掉最后的 `.ts`，映射为 `/:datasetId/stream/:videoId.md`。

### 岛屿策略

- **全局**：`ThemeProvider`、`ProgressBar` 用 `client:load` + `transition:persist`，保留模板现有做法。
- **首屏正文**：由 `.astro` 输出，不加 `client:only`。单场页的标题、指标、日期、简介、逐字稿都先服务端渲染。
- **图表**：`client:visible`。D3 只算比例尺和 path，React 输出 SVG；宽度为 0 时渲染空，服务端安全。
- **表格**：首屏行由 SSR 输出；工具条（搜索、筛选、列选择、CSV）用 `client:load`。500 行以内的成员数据可以直接作为 props 传入，筛选在客户端完成；更大的数据集再走 `/api/streams` 分页。
- **命令面板**：`client:idle` 或首次 `⌘K` 时动态加载，不进入首屏。
- **逐字稿**：正文用服务端 Markdown → HTML 输出；目录、时间码跳转可以在客户端增强，但不要用 `client:only` 渲染正文。
- **对比页**：选择器与图表 `client:load`，选中项写在 query string 里。

### 数据流

```text
.astro frontmatter
  → src/db/queries/*（Drizzle / SQL）
  → 可序列化 DTO
  → 传给 .astro 渲染 + 岛屿 props
  → 岛屿内交互
       ├─ 本地筛选 / 排序 / 切换（不请求）
       ├─ 需要新数据时 fetch /api/*
       └─ URL 状态用 history.replaceState 同步
```

现有 `useDataset` / `useStreamPacks` 这类「组件自己 fetch 首屏数据」的 hook 不再作为首屏入口。它们要么改成岛屿内的增量加载，要么删除。首屏数据由页面查询后传入，减少 waterfall 和 hydration 不确定性。

### URL 状态

- 表格筛选：`q` / `type` / `sort` / `dir` / `vstats` / `member` / `cols`。
- 单场分段：`view`。
- 对比：`ids`。
- 相册：`order` / `member` / `type`。

服务端从 `Astro.url.searchParams` 读初始值；客户端工具条修改后调用 `history.replaceState`，同时更新岛屿本地状态，不触发整页导航。监听 `popstate` 恢复前进后退。这样既保留可分享链接，也避免每次输入都重新请求 SSR。

## 6. 数据模型

### 规模基线

| 项 | 数值 |
| --- | --- |
| 成员 | 5 |
| 场次 | 1,892（nonoka 287 / arale 505 / ritsu 339 / miyako 322 / yuno 439） |
| 本地 datapack | 约 151 MB，平均约 80 KB/场，最大约 467 KB |
| manifest | 约 2.5 MB（5 份） |
| 弹幕总量 | 约 691 万条（当前只在聚合层使用，未逐条入库） |
| 逐字稿 | 当前少量，正文在 R2 |
| 封面 | 每场原图 + 480/960/1280w WebP |

### 表设计

#### `datasets`

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `text` PK | 与 `data-sources.json` 一致 |
| `label` | `text` | 显示名 |
| `color` | `text` | 成员色 |
| `avatar_key` | `text` | `avatars/nonoka.jpg` |
| `channel_id` | `text` | YouTube channel ID |
| `subject` / `scope` / `note` | `text` | 页面说明 |
| `created_at` / `updated_at` | `timestamptz` | — |

#### `streams`（列表页与 manifest 的主查询面）

一场一行，宽表。字段与现在的 `StreamSummary` 对齐：

| 列 | 类型 | 来源 |
| --- | --- | --- |
| `id` | `bigserial` PK | 代理键 |
| `dataset_id` | `text` FK | — |
| `video_id` | `text` | `video.id` |
| `title` | `text` | `video.title` |
| `url` | `text` | YouTube URL |
| `date` | `date` | JST 开播日 |
| `started_at` / `ended_at` | `timestamptz` | `video.startedAt` / `endedAt` |
| `duration_sec` | `int` | `video.durationSec` |
| `duration_hms` | `text` | `video.durationHms` |
| `availability` | `text` | `public` / `subscriber_only` |
| `avg_concurrent` / `max_concurrent` | `numeric` / `int` | `vstats` |
| `max_concurrent_at` | `text` | `vstats` |
| `watch_time_hours` | `numeric` | `vstats` |
| `vstats_views` / `vstats_likes` | `int` | `vstats` |
| `snapshot_views` / `snapshot_likes` / `snapshot_comments` | `int` | `video.snapshot` |
| `chat_total` | `int` | `chat.total` |
| `chat_by_kind` | `jsonb` | `chat.byKind` |
| `pure_emoji_only` | `int` | `chat.pureEmojiOnly` |
| `unique_authors` | `int` | `chat.uniqueAuthors` |
| `superchats` / `stickers` / `memberships` | `int` | `chat` |
| `gifts` / `gifted_memberships` | `int` | `chat` |
| `sc_totals_by_currency` | `jsonb` | `chat.paid` |
| `comments_captured` | `int` | `comments.total` |
| `chat_per_1000_avg_viewers` / `likes_per_1000_views` / `sc_per_hour` | `numeric` | `derived` |
| `thumbnail_key` | `text` | `thumbs/<videoId>.jpg` |
| `source_generated_at` | `timestamptz` | pack `generatedAt` |
| `source_schema` | `text` | `v1` / `v2` |
| `ingest_batch_id` | `bigint` | 关联 `ingest_reports` |
| `updated_at` | `timestamptz` | — |

索引：

```sql
unique (dataset_id, video_id)
index (dataset_id, started_at desc)
index (dataset_id, date desc)
index (dataset_id, availability)
index (title gin_trgm_ops)          -- 可选，用于标题搜索
```

`rank` 不落库，查询时用 `row_number() over (partition by dataset_id order by started_at desc)` 计算，避免新增场次后全表重排。

#### `stream_details`（单场页的扩展数据）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `stream_id` | `bigint` PK FK | — |
| `density` | `jsonb` | `perMinute` / `perMinuteSc` / `perFiveMinute` / `perTenMinute` / `peakMinute` |
| `coverage_pct` | `numeric` | 弹幕覆盖时长 |
| `time_range` | `jsonb` | `firstAt` / `lastAt` / `preRollSec` |
| `badges` | `jsonb` | 徽章分布 |
| `hashtags` | `jsonb` | 标签计数 |
| `emoji_kinds` | `jsonb` | 表情种类与 Top |
| `owner_chats` | `jsonb` | 主播本人发言明细 |
| `emojis` | `jsonb` | 本场频道表情 |
| `video_extra` | `jsonb` | 简介、外链、章节、字幕/回放标记 |
| `raw_detail` | `jsonb` | 可选：未投影字段，便于 schema 演进 |

`density.perMinute` 用 `jsonb` 而不是 `int[]`：现有 pack 是数组，JSONB 读写和版本兼容更省事；如果后续要做 SQL 窗口聚合，再拆成 `stream_minutes(stream_id, minute, chat, sc)`。

#### `paid_events`

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `bigserial` PK | — |
| `stream_id` | `bigint` FK | — |
| `kind` | `text` | `superchat` / `sticker` / `membership` / `gift` |
| `at` | `timestamptz` | 事件时刻 |
| `author` / `author_id` | `text` | 显示名 / 稳定 ID |
| `amount_text` | `text` | 原文金额 |
| `currency` | `text` | 币种前缀 |
| `amount` | `numeric` | 数值 |
| `message` | `text` | SC 留言 |
| `emojis` | `jsonb` | 留言表情 |

索引：`index (stream_id, kind)`、`index (stream_id, at)`。

#### `comments`

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `bigserial` PK | — |
| `stream_id` | `bigint` FK | — |
| `author` / `author_id` | `text` | — |
| `likes` | `int` | — |
| `at` | `timestamptz` | — |
| `pinned` / `by_uploader` | `boolean` | — |
| `text` | `text` | — |

索引：`index (stream_id, likes desc)`。

#### `authors` + `stream_authors`

| 表 | 列 |
| --- | --- |
| `authors` | `author_id` PK, `name`, `first_seen`, `last_seen` |
| `stream_authors` | `(stream_id, author_id)` PK, `messages`, `superchats`, `stickers`, `memberships` |

`stream_authors` 是观众重叠、跨场 Top 发言者的查询面。索引：`index (author_id)`、`index (stream_id, messages desc)`。

旧 v1 pack 可能没有 `authorId`。`author_id` 为空的记录不要直接做主键：用 `name:<hash>` 生成临时 key，或跳过全量作者表、只在页面回退到显示名。观众重叠只能基于有稳定 ID 的场次计算，页面上要标注覆盖率。

#### `stream_words`

| 列 | 类型 |
| --- | --- |
| `stream_id` | `bigint` |
| `word` | `text` |
| `count` | `int` |

主键 `(stream_id, word)`；索引 `(word)`。只写入 `count >= 3` 的词，和当前 `topWords` 口径一致。完整 `wordCounts` 留在原始 pack / R2 archive，不进入热表；后续要做全量词检索再单独建表或分区。

#### `dataset_insights`

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `dataset_id` | `text` PK FK | — |
| `totals` | `jsonb` | 与现有 `insights.json` 的 `totals` 一致 |
| `aggregation` | `jsonb` | `full` / `partial` / `top-lists` + coverage |
| `generated_at` | `timestamptz` | — |

由 ingest 预聚合，页面直接读，不在请求期重算 1,892 场。

#### `transcripts`

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `dataset_id` | `text` | — |
| `video_id` | `text` | — |
| `r2_key` | `text` | `transcripts/<datasetId>/<videoId>.json` |
| `title` / `date` / `summary` | — | 索引与列表用 |
| `tags` | `text[]` | — |
| `updated_at` | `timestamptz` | — |
| `content_hash` | `text` | 可选，判断是否需要重传 |

主键 `(dataset_id, video_id)`。正文不落库，只存 R2 key 和元数据。

#### `ingest_reports`

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | `bigserial` PK | 批次 ID |
| `started_at` / `finished_at` | `timestamptz` | — |
| `status` | `text` | `success` / `partial` / `failed` |
| `datasets` | `jsonb` | 每个成员的 `newIds` / `forceIds` / `deferredIds` / 发布结果 |
| `new_ids` / `force_ids` | `text[]` | 汇总 |
| `failures` | `int` | — |
| `structural` | `boolean` | 新增/删除成员、配置变化 |
| `notes` | `text` | — |

#### 预留：`chat_events`

完整弹幕要上时再加，按月分区：

```sql
chat_events (
  id bigserial,
  stream_id bigint not null,
  at timestamptz not null,
  kind text not null,
  author_id text,
  author_name text,
  text text,
  emojis jsonb,
  primary key (id, at)
) partition by range (at);
```

写入走批量 `COPY` 或 `postgres` 的 `copyFrom`，不要逐条 `insert`。6.91M 行、1–2 GB 文本对 Postgres 是可控规模，但要单独评估索引与分区维护；第一版不启用。

### 字段映射

| pack / manifest | 目标 |
| --- | --- |
| `StreamSummary.*` | `streams` 对应列；`rank` 查询时计算 |
| `video.description` / `links` / `chapters` / `captionsJa` | `stream_details.video_extra` |
| `chat.byKind` / `topAuthors` / `topWords` | `streams.chat_by_kind` / `stream_authors` / `stream_words` |
| `chat.paid.superchats` / `stickers` / `memberships` / `gifts` | `paid_events` |
| `chat.density` / `coveragePct` / `timeRange` | `stream_details` |
| `chat.authors` / `wordCounts` | `stream_authors`（全量作者）/ `stream_words`（`count >= 3`）；全量词频留 archive |
| `comments.items` | `comments` |
| `derived.*` | `streams` 派生列 |
| `insights.totals` | `dataset_insights.totals` |
| `transcripts/*.json` | `transcripts` 元数据 + R2 正文 |

### Schema 演进

- 每张表带 `source_schema` / `schema_version`，ingest 按 pack 版本选择投影规则。
- 新增字段先加可空列或 JSONB，不阻塞旧数据；确认回填后再加约束。
- 删除字段前先在查询层停止使用，再跑一次 migration。
- `raw` 不放进热表；完整 pack 归档在 R2 的 `archive/<datasetId>/<videoId>.datapack.json`。需要重放时从 R2 读，避免数据库被 151 MB JSON 撑大。
- 如果以后希望库内自包含，再加 `datapack_archive(stream_id, raw jsonb)`，并按需分区。

## 7. 数据摄取

### 真源与产物

- 抓取侧仍然以本地 `data/<id>/*.datapack.json` 为唯一真源。
- ingest 把 pack 投影到 PostgreSQL；完整 pack 归档到 R2 `archive/<datasetId>/<videoId>.datapack.json`。
- 逐字稿源文件仍在 `content/transcripts/<datasetId>/<videoId>.md`；发布时正文写 R2，元数据写 `transcripts` 表。
- R2 不再承载 `index.json` / `manifest.json` / `insights.json` / `group-*.json`；这些由数据库查询生成。

### `scripts/ingest-db.ts`

```bash
bun scripts/ingest-db.ts                  # 增量：读 data/<id>/ 下所有 pack
bun scripts/ingest-db.ts --dataset nonoka
bun scripts/ingest-db.ts --ids new-ids.txt
bun scripts/ingest-db.ts --all            # 全量重建
bun scripts/ingest-db.ts --dry-run
bun scripts/ingest-db.ts --batch-size 50
```

流程：

```text
读 data-sources.json
  → 逐成员读取 pack
  → 校验（video.id 与文件名、chat.total、density、paid 金额结构）
  → 每场一个事务：
       upsert datasets
       upsert streams（unique(dataset_id, video_id)）
       delete + insert stream_details / paid_events / comments / stream_words / stream_authors
       upsert transcripts 元数据（如果该场有稿）
  → 该成员全部场次写完后：
       aggregateDataset() → upsert dataset_insights
  → 写 ingest_reports
```

要点：

- **幂等**：所有写入都是 upsert；子表用「按 `stream_id` 删除后重插」保证重跑结果一致。
- **事务边界**：使用 `postgres` / `pg` 直连（ingest 在 Bun 里跑），一场一个事务；一个成员的所有场次完成后再更新 insights。Neon HTTP 驱动不支持交互式事务，不要用它做 ingest。
- **批次**：默认 50 场一批；每批结束写一次进度，失败可重跑。`--all` 用于 schema 变更后的全量重投影。
- **跳过未变化**：用 `content_hash`（pack 内容的 sha256）或 `source_generated_at` 判断；未变化且 `--force` 未设置时跳过写入，只更新报告。
- **失败隔离**：单场失败记录到 `ingest_reports.datasets[].error`，继续处理同成员其他场次；一个成员全部失败不影响其他成员。
- **不删除旧数据**：只有 upsert 和按 stream 替换子表；下架场次用显式 `--delete` 或 `archived_at`，不要用「先 truncate 再灌」。
- **保留 R2 发布路径**：迁移期 `publish-assets.ts` 继续上传封面/表情/逐字稿/archive，数据库出问题时可以回到 JSON 读取。

### 对账

新增 `scripts/verify-db.ts`：

- `streams` 行数与本地 `manifest.streams.length` 一致。
- 每场的 `chat_total`、`superchats`、`sc_totals_by_currency` 与 pack 一致。
- `stream_authors.messages` 之和等于 `chat.total`；作者数等于 `uniqueAuthors`。
- `dataset_insights.totals` 与 `aggregateDataset()` 重算结果一致。
- `paid_events` 条数与 `paid.superchats + stickers + memberships + gifts` 一致。
- `comments` 条数与 `comments.total` 一致。
- `transcripts` 的 `r2_key` 在 R2 上存在。

对账脚本先本地跑，再接 CI。字段级 diff 是切换数据库读取前必须通过的验收。

### 现有脚本的改造点

不写 R2 manifest 之后，几个依赖它的脚本要同步改：

| 脚本 | 现状 | 改法 |
| --- | --- | --- |
| `scripts/daily-update.ts` | `loadManifest()` 读 R2 / 本地 `manifest.json` 做差集 | 改成 `select video_id from streams where dataset_id = $1`；`localAhead` 比 `dataset_insights.generated_at` 或最近 `ingest_reports`；发布步骤改为 `ingest-db` + `publish-assets` + purge |
| `scripts/fetch-streams.ts` | `--restore` 从 R2 manifest / datapack 恢复本地 pack | 从 R2 `archive/<datasetId>/<videoId>.datapack.json` 恢复；没有 archive 时只抓本地缺失 |
| `scripts/publish-transcripts.ts` | 写 R2 正文 + `transcripts/index.json`，用本地 manifest 校验 videoId | 写 R2 正文 + upsert `transcripts` 元数据；videoId 校验查库；`transcripts/index.json` 可保留为兼容产物，但页面不再读取 |
| `scripts/validate-data.mjs` | 校验 `public/data` 的 index / manifest / insights / group-* | 保留 pack 级校验；整站校验换成 `verify-db.ts` |
| `scripts/verify-data.ts` | 对比本地 manifest / insights / authors | 改为查询数据库后重算对比 |
| `scripts/generate-seo.ts` | 构建期写 1,900 份 HTML + sitemap | 删除；改由 SSR + `sitemap.xml` endpoint |
| `scripts/sync-data.mjs` | 拉 R2 数据到 `public/data` | 删除；本地开发用 fixture 适配器或 Neon dev branch |
| `scripts/add-datapack.mjs` | 写本地 pack 并更新本地 manifest | 继续写 pack；写完后跑 `ingest-db --dataset` |
| `scripts/smoke-routes.mjs` | 静态站路由冒烟 | 改为对 Worker 预览 / 线上域名发请求，补 `.md`、404、缓存头检查 |

`fetch-thumbnails.ts`、`fetch-emoji.ts`、`stream-datapack.ts`、`missing-danmaku.ts`、`enrich-chat.ts` 仍然只操作本地文件，不需要改；跑完后由 ingest 投影。

### 全量弹幕（后续）

当前 pack 不含逐条弹幕文本，只有聚合、密度、Top 列表、SC/评论/ownerChats。完整弹幕上线时：

1. 从归档工程的 `danmaku_<videoId>.jsonl` 归一化出 `chat_events` 行。
2. 按月分区，批量 `COPY`；不要走 drizzle 逐条 insert。
3. 先回填最近 1–2 个月，验证查询与索引，再补历史。
4. 聚合仍由 `streams` / `dataset_insights` 提供，`chat_events` 只服务检索与明细。

## 8. 查询层

### 连接

- `src/db/client.ts`：Worker 读路径，`drizzle(neon(DATABASE_URL))`，只读。
- `src/db/ingest-client.ts`：只在脚本中使用，`postgres` 直连，支持事务。
- `DATABASE_URL` 通过 `astro:env/server` 读取；本地 `.dev.vars`，线上 `wrangler secret put DATABASE_URL`。
- 查询层不 import React / DOM。

### 查询模块

```text
src/db/queries/
  datasets.ts      getDatasetIndex / getDataset
  streams.ts       listStreams / getStream / getStreamNeighbors / getLatestStream
  group.ts         getGroupSummary / getGroupGallery
  insights.ts      getDatasetInsights
  transcripts.ts   getTranscriptIndex / getTranscriptMeta
  search.ts        searchStreams
  authors.ts       getAuthorIndex / getAuthorOverlap
```

返回类型放在 `src/types/db.ts`，与现有 `StreamSummary` / `StreamRow` 保持字段兼容，减少组件改动。

### 查询预算

| 页面 | 目标查询数 | 说明 |
| --- | --- | --- |
| 组首页 | 2–3 | members 汇总 + 最近场次 + 日期桶（可合并为一条 CTE） |
| 成员首页 | 2–3 | streams + insights + 最近场次 |
| 场次列表 | 2 | streams + insights；筛选在 SQL 或客户端 |
| 单场页 | 3–5 | stream + details + paid/comments/words/authors，`Promise.all` |
| 趋势 | 2 | 月度聚合 + insights |
| 相册 | 1 | 全部精简行 |
| 逐字稿索引 | 1 | transcripts 元数据 |
| `.md` | 2–3 | stream/details + transcript 元数据 + R2 正文 |

实现约定：

- **聚合在 SQL 里做**：月度、Top、覆盖率、日期桶用 `GROUP BY` / 窗口函数 / `FILTER`，不要把 1,892 行拉到 Worker 再算。
- **避免 N+1**：子表用 `inArray` 一次取回，或在一条查询里 `json_agg`。
- **numeric 返回字符串**：Drizzle 的 `numeric` 在 JS 里是 string；查询层统一 `Number()` / `null` 转换，不要漏到组件。
- **时间**：返回 ISO 字符串；格式化在 `src/lib/format.ts`，按 JST 显示。
- **rank**：用 `row_number() over (partition by dataset_id order by started_at desc)`；不要落库。
- **分页**：列表页首屏最多 500 行；超过时用 `limit/offset` 或 cursor。当前 1,892 场、单成员最多 505 场，首版可以不分页。
- **缓存**：查询层不做模块级长期缓存；依赖 Workers Cache 和 `dataset_insights` 预聚合。需要时可以在 isolate 内做 30–60 秒的短缓存，但不要把新鲜度寄托在 isolate 复用上。

### 错误与降级

- 查询抛错时，页面显示错误态（成员级 / 组级），不要静默返回空数组。
- 组首页单个成员失败时，其余成员继续渲染，并在页面标注。
- `stale-if-error` 可以让 Workers Cache 在 Worker 异常时继续返回旧响应；如果希望错误可见，显式设置 `stale-if-error=0`。
- 本地开发如果不方便连 Neon，可以保留一个 fixture 适配器：`DATABASE_URL` 缺失时从本地 `data/` 读 pack，按与查询层相同的 DTO 返回。这个适配器只用于本地，不部署。

## 9. 页面迁移

### 复用与替换

| 处理 | 文件 |
| --- | --- |
| 直接复用 | `src/components/ui/*`（57 个 coss 组件）、`src/components/charts/*`、大部分 `src/components/dashboard/*` |
| 复用纯函数 | `src/lib/aggregate.ts`、`format.ts`、`classify.ts`、`table-params.ts`、`transcripts.ts`、`thumb-variants.ts`、`stopwords.ts`、`author-index.ts`、`src/types/*` |
| 改造为 Astro 布局 | `dataset-layout.tsx`、`group-layout.tsx`、`app-sidebar.tsx`、`app-header.tsx`、`mobile-tab-bar.tsx` |
| 替换数据入口 | `src/lib/data.ts`、`use-dataset.ts`、`use-dataset-index.ts`、`use-stream-packs.ts` → `src/db/queries/*` |
| 替换 SEO | `src/hooks/use-seo.ts`、`src/lib/seo.ts`、`scripts/generate-seo.ts` → `src/lib/seo.ts` + `SEO.astro` + sitemap endpoint |
| 删除 | `src/router.tsx`、`src/main.tsx`、`index.html`、`vite.config.ts`、`vercel.json`、`public/data/`、`scripts/sync-data.mjs` |
| 拆分 | `scripts/publish-data.ts` → `scripts/ingest-db.ts` + `scripts/publish-assets.ts` |
| 保留并适配 | `fetch-streams.ts`、`fetch-thumbnails.ts`、`fetch-emoji.ts`、`stream-datapack.ts`、`daily-update.ts`、`publish-transcripts.ts`、`validate-*`、`verify-*` |

### React Router 解耦

当前 `src/` 下有 32 个文件、84 处 React Router 依赖。大部分是 `Link`，机械替换即可；少数需要适配：

| React Router | Astro / 替代 |
| --- | --- |
| `createBrowserRouter` | `src/pages/` 文件路由 |
| `<Link to>` / `<NavLink>` | `<a href>`（`ClientRouter` 会拦截站内导航） |
| `useNavigate()` | `navigate()` from `astro:transitions/client`，或整页跳转 |
| `useLocation()` | `.astro` 用 `Astro.url`；岛屿用 `window.location`（`useEffect` 内） |
| `useParams()` | `.astro` 用 `Astro.params`；组件用 props |
| `useSearchParams()` | `.astro` 用 `Astro.url.searchParams`；岛屿用 `URLSearchParams` + `history.replaceState` |
| `<Outlet>` | `<slot />` / 嵌套布局 |
| `useMatches()` | 布局 props / `Astro.locals` |
| `<ScrollRestoration>` | `ClientRouter` 默认处理 |
| `errorElement` | `404.astro` / `500.astro` + React error boundary |
| `<Navigate>` | `Astro.redirect()` |

建议加一个薄适配层 `src/lib/router-compat.ts`，提供 `buildDatasetPath()` / `buildStreamPath()`，避免每个组件手拼 URL；同时把 `Link` 的替换集中在少数文件里。

### 页面迁移顺序

1. **壳层**：`Layout.astro`、`ThemeProvider`、`ProgressBar`、`AppSidebar`、`AppHeader`、移动端标签栏。
2. **组首页** `/`：`getGroupSummary` + 岛屿。
3. **成员首页** `/:datasetId`：`getDataset` + `listStreams` + insights。
4. **场次列表** `/:datasetId/streams`：SSR 表格 + 工具条岛屿。
5. **单场页** `/:datasetId/stream/:videoId`：详情、图表、逐字稿。
6. **趋势 / 相册 / 逐字稿索引 / 对比**。
7. **`.md` 端点、sitemap、llms.txt**。
8. **旧地址重定向、hash 链接兼容、404**。

每迁完一页，用现有 `smoke-routes.mjs` 的路径清单跑一遍，并补一条 SSR 404 与缓存头的检查。

### 数据与 props

- 岛屿 props 必须可序列化：只传字符串、数字、布尔、数组、普通对象；不要传 `Date`、函数、类实例。
- 图表组件继续接收已经整理好的 `rows` / `totals`，不要在岛屿里重新请求完整 manifest。
- `DatasetViewContext` 可以保留，但数据由页面通过 props 注入，context 只做组件间共享。
- 表格筛选在客户端完成时，把完整 `rows` 传给岛屿；如果以后超过几千行，改成 `/api/streams?datasetId=&q=&type=&sort=&page=`。

### SEO

- `src/lib/seo.ts` 保留 `buildSeo()` / canonical / OG / JSON-LD 规则，补上 Astro 需要的 `site` 配置。
- `SEO.astro` 输出 title、description、canonical、OG、twitter、robots、JSON-LD。
- 单场页的静态 head 由 SSR 直接输出，不再需要 `generate-seo.ts` 注入。
- `sitemap.xml` 用 `src/pages/sitemap.xml.ts`：
  - 查 `datasets` + `streams`，生成组首页、全组相册、每位成员的 6 个栏目页、全部单场页。
  - `lastmod` 用 `streams.source_generated_at`；成员页/组页用 `dataset_insights.generated_at`。
  - 不收录 `compare`、`.md`、`/api/*`。
  - 条数公式：`2 + 6 × 成员数 + 单场数`；当前应是 `2 + 30 + 1892 = 1924`。
- `robots.txt` 指向 `/sitemap.xml`；`.md` 不写进 sitemap，用 `X-Robots-Tag: noindex` 防止重复收录。
- `llms.txt`：列出成员、最近场次、`.md` 链接和站点说明，方便 Agent 发现。

### 404 与错误

- 未知 `datasetId` / `videoId`：页面设置 `Astro.response.status = 404` 并渲染专门的 404 视图；endpoint 返回 `404` + `text/plain` 或 Markdown。
- 数据库不可用：渲染 500 / 错误页，提供重试和状态说明；不要让异常冒成空白页。
- `src/pages/404.astro`、`src/pages/500.astro` 预渲染；`ClientRouter` 的导航错误由 React error boundary 兜底。

### 主题、图片、字体

- 主题沿用模板：Zustand persist + `<head>` 内联脚本 + `ThemeProvider`；删掉现有 `use-theme` 的重复实现。
- 封面继续用现有 `thumbnailUrl()` / `thumbnailSrcSet()`，服务端拼 R2 公开地址，`<img srcset>` 交给浏览器。不要用 `astro:assets` 处理远端 R2 图片，现有 WebP 变体已经够用。
- 字体用模板的 Fonts API；`Layout.astro` 已配置 Inter / Noto Sans SC / Geist Mono。
- 头像继续放 `public/avatars/`，或迁到 R2；文件小，放 `public/` 更简单。

## 10. Agent Markdown（`.md` 路由）

### 约定

只提供 `.md` 路由后缀，不做 `Accept: text/markdown` 内容协商，也不启用 Cloudflare Markdown for Agents。

- 规范地址：`GET /{datasetId}/stream/{videoId}.md`
- 与 HTML 单场页一一对应，便于 Agent 从页面里的 `<link rel="alternate">` 发现。
- 返回 `text/markdown; charset=utf-8`，不重定向到 R2。
- HTML 单场页在 `<head>` 里加：

```html
<link
  rel="alternate"
  type="text/markdown"
  href="/nonoka/stream/W0bKqP-Eyj4.md"
/>
```

- `.md` 不进 sitemap；用 `X-Robots-Tag: noindex` 避免和 HTML 页重复收录。
- `llms.txt` 里列出成员、最近场次和 `.md` 链接。

### 文件与处理

```text
src/pages/[datasetId]/stream/[videoId].md.ts
src/lib/agent-markdown.ts
```

`[videoId].md.ts` 去掉最后 `.ts` 后映射为 `/:datasetId/stream/:videoId.md`。endpoint 显式 `export const prerender = false`。

处理顺序：

```text
GET
  → 校验 datasetId / videoId 格式
  → 查 streams + stream_details（一条或两条查询）
  → 查 transcripts 元数据
  → 有稿：从 R2 binding 读正文 JSON
  → renderStreamMarkdown(dto)
  → context.cache.set({ maxAge: 300, swr: 600, tags: [...] })
  → 返回 Response
```

- 数据不存在：返回 404 的 Markdown，`Cache-Control: no-store`。
- 逐字稿缺失：仍然返回 200，在「逐字稿」一节写明没有稿件。
- R2 读取失败：返回 200，正文处写「逐字稿暂时不可用」，不要把整页变成 500。
- 只读：不写数据库、不触发 ingest。

### 内容结构

```markdown
---
title: "【ライブ振り返り】バンドリ！13thライブをふりかえる！"
description: "宮永ののか 2026-10-13 的直播数据总览：时长 1:23:45，峰值同接 1,234。"
image: "https://data.example.com/nonoka/thumbs/W0bKqP-Eyj4.jpg"
canonical: "https://ymmt.example.com/nonoka/stream/W0bKqP-Eyj4"
dataset: nonoka
member: "宮永ののか"
video_id: W0bKqP-Eyj4
date: 2026-10-13
duration: "1:23:45"
youtube: "https://www.youtube.com/watch?v=W0bKqP-Eyj4"
generated_at: 2026-10-14T02:10:00+09:00
markdown_url: "https://ymmt.example.com/nonoka/stream/W0bKqP-Eyj4.md"
---

# 【ライブ振り返り】バンドリ！13thライブをふりかえる！

> 宮永ののか · 2026-10-13 · 1:23:45 · 公开

## 概览

| 指标 | 值 |
| --- | --- |
| 平均同接 | 626 |
| 峰值同接 | 1,234（21:04） |
| 播放（VSTATS） | 45,678 |
| 点赞（VSTATS） | 2,345 |
| 弹幕 | 12,345 |
| SC | 89 笔 / ¥123,456 |
| 贴纸 | 12 |
| 会员里程碑 | 34 |
| 评论（抓取） | 210 |

## 时间轴

每 10 分钟一档，峰值分钟单独标注。

| 区间 | 弹幕 | SC |
| --- | ---: | ---: |
| 00:00–00:10 | 1,234 | 3 |
| ... | ... | ... |

峰值：第 74 分钟（21:04），1,234 条。

## 弹幕与互动

- 弹幕总量：12,345
- 纯表情：345
- 发言人数：1,234
- 每千同接弹幕：19.7

### 高频词

| 词 | 次数 |
| --- | ---: |
| … | … |

### 发言者 Top 20

| 发言者 | 条数 | SC | 贴纸 | 会员 |
| --- | ---: | ---: | ---: | ---: |
| … | … | … | … | … |

## 付费

### 币种合计

| 币种 | 笔数 | 金额 |
| --- | ---: | ---: |
| ¥ | 80 | 120,000 |
| HK$ | 9 | 3,456 |

### 最近 SC（最多 20 条）

| 时刻 | 金额 | 发言者 | 留言 |
| --- | --- | --- | --- |
| … | … | … | … |

## 评论（最多 20 条）

| 赞 | 作者 | 内容 |
| ---: | --- | --- |
| … | … | … |

## 逐字稿

<!-- 原文 Markdown，保留 [12:34] 时间码 -->

## 数据说明

- 时间一律 JST（UTC+9）。
- 同接来自 VSTATS；`vstats` 缺失时相关指标显示「—」。
- SC / 贴纸金额按币种分列，不做汇率换算。
- 评论是抓取上限内的条数，不等于视频总评论数。
- 逐字稿由人工整理，原文时间码保留。

## 链接

- HTML 页面：https://ymmt.example.com/nonoka/stream/W0bKqP-Eyj4
- YouTube：https://www.youtube.com/watch?v=W0bKqP-Eyj4
```

### 数据裁剪

默认返回「够分析、不臃肿」的版本：

| 区块 | 默认上限 | 说明 |
| --- | ---: | --- |
| 时间轴 | 10 分钟一档 | 不返回逐分钟，避免几百行 |
| 高频词 | Top 40 | 与现有 `topWords` 口径一致 |
| 发言者 | Top 20 | 与 `topAuthors` 一致 |
| SC | 最近 / 金额 Top 20 | 全量 SC 在 HTML 单场页与数据库里 |
| 评论 | 点赞 Top 20 | 全量在 HTML 页与数据库里 |
| 逐字稿 | 全文 | 这是 Agent 视图的主要价值，不裁剪 |

可选参数：

- `?transcript=0`：不返回逐字稿，只返回结构化摘要。
- `?full=1`：返回完整 Top 列表与全部 SC/评论。默认关闭，避免 Agent 一次拉太多。
- `?lang=ja` / `?lang=zh`：只影响标题与说明的措辞，不翻译原文；首版可不做。

### 响应头

```http
HTTP/2 200
content-type: text/markdown; charset=utf-8
cache-control: public, max-age=300, stale-while-revalidate=600
x-robots-tag: noindex
link: <https://ymmt.example.com/nonoka/stream/W0bKqP-Eyj4>; rel="alternate"; type="text/html"
content-signal: ai-train=no, search=yes, ai-input=yes
```

- **不设置 `Vary: Accept`**：`.md` 是独立 URL，不做内容协商。
- `Cache-Control` / `Cache-Tag` 由 `context.cache.set()` 交给 `cacheCloudflare()`；如果直接返回 `Response`，也可以显式设置相同的头。
- `ETag` 可选：用 `streams.source_generated_at` + `transcripts.updated_at` 生成；命中 `If-None-Match` 时返回 304。
- `X-Robots-Tag: noindex`：避免搜索引擎把 Markdown 当重复内容。
- `Content-Signal`：按站点政策设置。建议 `ai-train=no, search=yes, ai-input=yes`；这是站点自己的声明，不是平台默认。
- `Link` 指回 HTML 页面，方便 Agent 纠错或跳转。

### 缓存与失效

- 与 HTML 单场页共用 `stream-<videoId>` / `dataset-<id>` tag；ingest 或逐字稿更新后一起 purge。
- `.md` 的缓存 key 就是 URL；没有 `Vary`，命中率高。
- 如果以后确实要加 `Accept` 协商，改为在 middleware 里 rewrite 到 `.md`，并对原 URL 设置 `Vary: Accept` + 短 TTL 或 `no-store`，避免 Accept 字符串造成缓存变体爆炸。当前不做。

### 测试

| 检查 | 操作 | 预期 |
| --- | --- | --- |
| 基本返回 | `curl -i /nonoka/stream/<id>.md` | 200，`text/markdown; charset=utf-8` |
| frontmatter | 检查首段 | 有 title / date / dataset / video_id |
| 逐字稿 | 打开有稿的场次 | 「逐字稿」一节包含原文 |
| 无稿 | 打开无稿场次 | 200，写明没有稿件 |
| 未知 id | `/nonoka/stream/not-a-real-id.md` | 404，`no-store` |
| HEAD | `curl -I` | 200，无 body |
| 缓存 | 连续请求两次 | 第二次 `Cf-Cache-Status: HIT` |
| 失效 | ingest 后请求 | 返回新 `source_generated_at` |
| 大小 | 最大一场 | 响应体 < 200 KB（有逐字稿时按实际） |

### 为什么不使用 Cloudflare Markdown for Agents

Cloudflare 的 Markdown for Agents 是在边缘把 HTML 转成 Markdown：只从 HTML 转换、有 6 MiB 上限、需要 Pro/Business/Enterprise 计划，且不会包含逐字稿原文。我们的 `.md` 路由直接查数据库并读 R2 逐字稿，内容更完整、可控，也不依赖计划与边缘配置。因此不启用该功能，也不做 `Accept` 协商。

## 11. 缓存与失效

### Astro 配置

```js
// astro.config.mjs
import cloudflare from '@astrojs/cloudflare'
import { cacheCloudflare } from '@astrojs/cloudflare/cache'

export default defineConfig({
  site: 'https://ymmt.example.com',
  output: 'server',
  session: false,
  adapter: cloudflare({ prerenderEnvironment: 'node' }),
  cache: { provider: cacheCloudflare() },
  routeRules: {
    '/': { maxAge: 60, swr: 300, tags: ['group'] },
    '/gallery': { maxAge: 300, swr: 600, tags: ['group', 'gallery'] },
    '/[datasetId]': { maxAge: 60, swr: 300, tags: ['datasets'] },
    '/[datasetId]/streams': { maxAge: 60, swr: 300, tags: ['datasets'] },
    '/[datasetId]/trends': { maxAge: 300, swr: 600, tags: ['datasets'] },
    '/[datasetId]/gallery': { maxAge: 300, swr: 600, tags: ['datasets'] },
    '/[datasetId]/transcripts': { maxAge: 300, swr: 600, tags: ['transcripts'] },
    '/[datasetId]/stream/[videoId]': { maxAge: 300, swr: 600, tags: ['streams'] },
    '/[datasetId]/stream/[videoId].md': { maxAge: 300, swr: 600, tags: ['streams'] },
  },
})
```

页面里用 `Astro.cache.set({ maxAge, swr, tags })` 补上具体 tag；endpoint 用 `context.cache.set(...)`。`routeRules` 是默认值，页面调用会合并/覆盖。开发环境 `Astro.cache.enabled` 为 `false`，缓存调用是 no-op；要验证缓存必须 `bun run build` 后 `astro preview` 或线上观察。

### Workers Cache 配置

`cacheCloudflare()` 会启用 Cloudflare Workers Cache，并用 `Cloudflare-CDN-Cache-Control` + `Cache-Tag` 表达策略。`wrangler.jsonc` 可按需加：

```jsonc
{
  "cache": {
    "enabled": true,
    "cross_version_cache": false
  }
}
```

- `cross_version_cache: false`（默认）：每次部署是新版本，缓存从冷启动开始，行为最简单，推荐首版使用。
- `cross_version_cache: true`：部署后仍复用旧缓存，命中率高；代价是代码变更后旧响应可能继续存在，必须靠 purge 或版本 tag 处理。确认需要后再开。
- Workers Cache 是 **Worker 自己的缓存**：按 Worker / entrypoint 隔离，zone 级 purge 不会影响它。ingest 后的 purge 必须走 Worker 端点。

### Cache-Tag 约定

| tag | 用在 |
| --- | --- |
| `group` | 组首页、全组相册 |
| `gallery` | 全组相册 |
| `dataset-<id>` | 成员页、列表、趋势、相册、单场页 |
| `stream-<videoId>` | 单场 HTML、单场 `.md` |
| `transcripts` | 逐字稿索引 |
| `sitemap` | `/sitemap.xml` |
| `llms` | `/llms.txt` |

tag 必须是可打印 ASCII、不能含空格；`<id>` 和 `videoId` 都满足。一次响应最多 1000 个 tag，当前远低于上限。

### Purge 端点

```text
POST /api/internal/cache/purge
Authorization: Bearer <PURGE_TOKEN>
Content-Type: application/json

{ "tags": ["stream-W0bKqP-Eyj4", "dataset-nonoka", "group", "sitemap", "llms"] }
```

实现：

- `export const prerender = false`，`context.cache.set(false)` 或 `Cache-Control: no-store`。
- 校验 token 用常数时间比较；token 只存在 Worker secret 里。
- 调用 `context.cache.invalidate({ tags })`（Astro API，软失效）或 `cache.purge({ tags })`（`cloudflare:workers`，硬删除）。数据正确性优先用 `purge`；如果希望保留 stale-while-revalidate，用 `invalidate`。
- 返回 `{ success: boolean, errors?: unknown[] }`，调用方（ingest 脚本）记录失败但不阻塞发布。
- purge 失败时，TTL 内的旧内容仍可能被返回；在报告里写明，必要时手动重试。
- 不要把 purge 端点暴露给公网无鉴权调用；它是内部端点。

### 失效规则

| 变更 | purge |
| --- | --- |
| 新场次 / 重抓指标 | `stream-<videoId>`、`dataset-<id>`、`group`、`sitemap` |
| 新增逐字稿 / 改稿 | `stream-<videoId>`、`transcripts`、`sitemap`（如果索引页变化） |
| 新增 / 删除成员 | `group`、`gallery`、`sitemap`、`llms` |
| 组首页数据变化 | `group` |
| 代码部署 | 默认冷缓存；若开 `cross_version_cache`，按版本 tag 或部署后 purge |

### 错误与观察

- `stale-if-error`：Workers 默认在 Worker 刷新失败时可能长期返回旧响应。需要错误可见时显式设 `stale-if-error=0`；需要韧性时设一个有限窗口（如 3600 秒）。
- 观察 `Cf-Cache-Status`（HIT / MISS / EXPIRED / REVALIDATED / STALE / BYPASS）与 middleware 的 `x-response-time`。
- 如果响应带 `Set-Cookie`、请求带 `Authorization`，Workers Cache 会按规则 bypass 或需要 `public`；数据页不设 cookie。
- 404 默认会被启发式缓存 180 秒；未知单场页显式 `no-store` 或短 TTL，避免新场次上线后仍命中 404。

## 12. 发布流程

### 数据更新（每天）

```text
GitHub Actions（现有 data.yml）
  1. daily-update.ts：频道差集 → 抓新场次 / 重抓 → 本地 pack
  2. ingest-db.ts：事务 upsert → dataset_insights → ingest_reports
  3. publish-assets.ts：逐字稿正文、封面/变体、表情、archive 写 R2
  4. POST /api/internal/cache/purge：按 tags 失效
  5. 可选 IndexNow：提交新 URL
  6. 失败开 issue；成功写报告
```

- 没有新场次、也没有待补数据时，ingest 不写库、不 purge。
- ingest 与资产发布都幂等；失败重跑不会产生重复行。
- purge 在数据库提交之后调用；顺序不能反。
- 逐字稿更新可以单独跑：`publish-transcripts` → upsert `transcripts` → purge `stream-<id>`。
- 全量弹幕以后另开任务，不进每日低频流程。

### 代码发布

```text
CI
  bun install --frozen-lockfile
  drizzle-kit generate / migrate（或部署前手动跑）
  bun run build
  wrangler deploy
  冒烟：/、/nonoka、/nonoka/stream/<id>、/nonoka/stream/<id>.md、/sitemap.xml
```

- `astro build` 只预渲染 `/about`、404 等稳定页；构建不需要数据库或 R2。
- `wrangler deploy` 同时上传 Worker 与静态资源；`_headers` 只作用于静态资源，Worker 渲染的响应由 middleware 设置安全头。
- migration 与代码部署的顺序：先加列/建表（向后兼容），再部署使用新列的代码；删除列放到下一次。

### 新增成员

1. `data-sources.json` 加一条。
2. `datasets` upsert。
3. ingest 该成员 pack。
4. purge `group`、`gallery`、`sitemap`、`llms`。
5. 页面路由是动态的，不需要加代码。

### 新增逐字稿

1. `content/transcripts/<datasetId>/<videoId>.md`。
2. `publish-transcripts` 写 R2 正文 + `transcripts` 元数据。
3. purge `stream-<videoId>`、`transcripts`。
4. 不需要构建。

### 定时与凭据

- 抓取依赖 yt-dlp、PO token、cookie、可选代理，继续放 GitHub Actions；Workers Cron 没有这些能力，不适合做 ingest。
- Worker Cron 只适合做轻量任务：预热 sitemap、清理过期缓存、健康检查。模板的 `triggers.crons` 可以删除或改成这类用途。
- 凭据：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Secret | `DATABASE_URL` | Worker 读 + ingest 写 |
| Secret | `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_PREFIX` | ingest / 资产发布 |
| Secret | `PURGE_TOKEN` | ingest 调 purge 端点 |
| Secret | `YT_COOKIES` / `MIHOMO_SUB_URL` | 抓取 |
| Var | `SITE_URL` / `PUBLIC_R2_BASE` | canonical、封面地址 |

- `DATABASE_URL` 不要进入客户端 bundle；只在 `astro:env/server` 或服务端读取。
- R2 公开域名用于封面/表情；逐字稿正文通过 Worker binding 读取，不直接暴露。

### R2 布局

```text
<prefix>/
  archive/<datasetId>/<videoId>.datapack.json   # 原始 pack，重放用
  <datasetId>/thumbs/<videoId>.jpg              # 原图
  <datasetId>/thumbs/<videoId>.<width>.webp     # 480 / 960 / 1280
  emojis/<datasetId>/<hash>.png
  emojis/youtube/<hash>.png
  transcripts/<datasetId>/<videoId>.json        # 正文
```

索引不再写 R2；`manifest` / `insights` / `group-*` 由数据库生成。

### 回滚

| 层 | 方式 |
| --- | --- |
| 代码 | `wrangler rollback` / 重新部署上一版 |
| 数据库 | Neon 分支 / 时间点恢复；或按 `ingest_reports.id` 从 archive 重放 |
| R2 | 版本控制或从本地 `data/` 重新上传 |
| 缓存 | 部署后 purge；开 `cross_version_cache` 时尤其要 purge |

## 13. 迁移步骤

### 阶段 0：基线与脚手架

- 从 `D:\git\starter-astro-react` fork 一个新仓库，保留模板的 `src/components/ui`、`Layout.astro`、`SEO.astro`、`ThemeProvider`、`auth` 之外的基础设施。
- 搬入本仓库的 `src/components/dashboard`、`src/components/charts`、`src/lib` 纯函数、`src/types`、`content/transcripts`、`data-sources.json`。
- 删除模板的 `articles`、`examples`、`site_stats`、`src/content/articles`、`src/pages/api/stats.ts`。
- 配置 `astro.config.mjs`：`site`、`output: 'server'`、`cloudflare()`、`cacheCloudflare()`、`react()`、Tailwind、字体、`routeRules`。
- 配置 `wrangler.jsonc`：`name`、`compatibility_date`、`nodejs_compat`、`assets`、R2 binding、`cache`。
- 配置环境：`.env` / `.dev.vars`，Neon 项目，R2 bucket，`drizzle.config.ts`。
- 验证：`bun dev`、`bun run build`、`bun run cf:preview`、`wrangler deploy` 到 preview 域名；`GET /` 返回 200。

### 阶段 1：数据库与 ingest

1. 写 `src/db/schema.ts`：`datasets`、`streams`、`stream_details`、`paid_events`、`comments`、`authors`、`stream_authors`、`stream_words`、`dataset_insights`、`transcripts`、`ingest_reports`。
2. `drizzle-kit generate` 生成迁移；在 Neon 分支上 `migrate`。
3. 写 `scripts/ingest-db.ts`：读 pack、校验、事务 upsert、更新 insights、写报告。
4. 写 `scripts/verify-db.ts`：对账行数、字段、聚合、作者、评论、SC。
5. 写 `src/db/queries/*`：先用 `streams` + `dataset_insights` 跑通成员页和列表页所需查询。
6. 先在本地仓库跑全量 ingest 与对账，再在 Neon 预发库跑一次。

验收：

- 5 个成员的 `streams` 行数与本地 manifest 完全一致。
- 每场 `chat_total`、`superchats`、`sc_totals_by_currency` 与 pack 一致。
- `dataset_insights.totals` 与 `aggregateDataset()` 重算一致。
- `verify-db.ts` 退出码 0；故意改坏一条 pack 能变红。
- 单成员列表查询 + insights 查询的总耗时在可接受范围（记录 P50/P95）。

### 阶段 2：壳层与 SEO

1. `Layout.astro`：SEO、主题内联脚本、ClientRouter、字体、全局岛屿。
2. `DatasetLayout.astro` / `GroupLayout.astro`：侧栏、顶栏、移动端标签栏、错误边界。
3. `src/lib/seo.ts` + `SEO.astro`：canonical、OG、JSON-LD、`noindex`。
4. `src/pages/sitemap.xml.ts`、`public/robots.txt`、`src/pages/llms.txt.ts`。
5. `404.astro`、`500.astro`；未知 dataset/stream 的 404 视图。

验收：

- `/`、`/nonoka`、`/nonoka/streams` 返回 200，HTML 里有 title / description / canonical。
- `/sitemap.xml` 条数为 `2 + 6 × 5 + 1892 = 1924`（以实际 ingest 结果为准）。
- 未知路径返回 404；未知单场页返回 404 而不是首页。
- 主题切换无闪烁；移动端 390 / 320px 无横向溢出。

### 阶段 3：页面与岛屿

1. 组首页 `/`。
2. 成员首页 `/:datasetId`。
3. 场次列表 `/:datasetId/streams`。
4. 单场页 `/:datasetId/stream/:videoId`。
5. 趋势 `/:datasetId/trends`、成员相册、全组相册。
6. 逐字稿索引、逐字稿正文。
7. 对比 `/:datasetId/compare`。
8. 旧地址重定向、`#/...` 兼容。

每页迁移时同步处理：

- 把 `Link` / `NavLink` 换成 `<a>`。
- 把 `useSearchParams` / `useNavigate` / `useParams` 换成 props、`Astro.url` 或 `history.replaceState`。
- 图表、表格、命令面板按岛屿策略水合。
- 删除对 `src/lib/data.ts`、`useDataset`、`useStreamPacks` 的首屏依赖。

验收：

- `rg "react-router" src` 为空。
- `smoke-routes.mjs` 的路径全部 200（对比页 noindex 但可访问）。
- 单场深链刷新、前进后退、`j/k`、`1–5`、`⌘K` 正常。
- 首屏 HTML 含指标与标题；岛屿只在水合后接管交互。
- `/nonoka/stream/<id>` 的 `view=` 分段可分享。

### 阶段 4：Agent Markdown 与缓存

1. `src/lib/agent-markdown.ts`：DTO → Markdown。
2. `src/pages/[datasetId]/stream/[videoId].md.ts`：查库、读 R2、返回 `text/markdown`。
3. HTML 单场页加 `<link rel="alternate" type="text/markdown">`。
4. `llms.txt` 列出成员与最近场次的 `.md` 链接。
5. `src/pages/api/internal/cache/purge.ts`：token 校验 + `cache.purge`。
6. `routeRules` 与 `Astro.cache.set` 补齐；ingest 后调用 purge。
7. 观察 `Cf-Cache-Status`、`x-response-time`、Worker CPU。

验收：

- `curl -i /nonoka/stream/<id>.md` 返回 200，`content-type: text/markdown; charset=utf-8`。
- frontmatter 有 title / dataset / video_id / date / canonical。
- 有稿场次包含原始逐字稿；无稿场次 200 且写明没有稿件。
- 未知 id 返回 404 且 `no-store`。
- 第二次请求命中缓存；ingest 后 purge 生效。
- `.md` 不出现在 sitemap；带 `X-Robots-Tag: noindex`。

### 阶段 5：切换与清理

1. 双写/双读一段时间：数据库与 R2 JSON 同时可用，随机抽样对比。
2. 把预览域名切到 Worker；确认 canonical、OG、sitemap、404、缓存。
3. 移除 Vercel 项目、`vercel.json`、`public/data/`、`sync-data.mjs`、`generate-seo.ts`。
4. 更新 `README.md`、`docs/planning/architecture.md`、`docs/data/data-model.md`、`docs/engineering/deployment.md`、`docs/data/adding-data.md`、`docs/README.md`。
5. 清理 Actions：保留抓取与 ingest；删除前端部署 Hook；新增 purge 调用。
6. 记录一次回滚演练。

验收：

- 线上 sitemap 条数、canonical、OG 与新数据一致。
- 新场次从抓取到页面可见不需要前端部署。
- 停掉 R2 JSON 索引后页面仍正常（数据库是唯一读源）。
- 停掉数据库时页面显示错误态，不会白屏。
- 回滚：`wrangler rollback` 能恢复上一版；数据库能从 Neon 分支恢复。

## 14. 验收清单

### 数据

- [ ] 5 个成员的 `streams` 行数与本地 manifest 一致（1,892 场）。
- [ ] 每场 `chat_total` / `superchats` / `sc_totals_by_currency` 与 pack 一致。
- [ ] `stream_authors.messages` 之和等于 `chat.total`。
- [ ] `dataset_insights.totals` 与 `aggregateDataset()` 一致。
- [ ] `paid_events` / `comments` 条数与 pack 一致。
- [ ] `transcripts.r2_key` 在 R2 上存在。
- [ ] 全量 ingest 可重跑，结果幂等。
- [ ] 单场失败不影响同成员其他场次；报告可定位。

### 页面

- [ ] `/` 正常，单个成员失败不阻塞其他成员。
- [ ] 成员页、场次列表、趋势、相册、逐字稿索引、对比页返回 200。
- [ ] 未知 dataset / videoId 返回 404。
- [ ] 单场深链刷新、前进后退、分段 URL 可分享。
- [ ] 首屏 HTML 含标题、指标、日期与简介。
- [ ] 图表在服务端不执行 DOM 逻辑；水合后交互正常。
- [ ] 主题无闪烁；移动端无横向溢出。
- [ ] `rg "react-router" src` 为空。

### SEO / Agent

- [ ] 单场页 HTML 有 title / description / canonical / OG / JSON-LD。
- [ ] `/sitemap.xml` 条数为 `2 + 6 × 成员数 + 单场数`。
- [ ] `.md` 不在 sitemap，带 `X-Robots-Tag: noindex`。
- [ ] `curl /nonoka/stream/<id>.md` 返回 `text/markdown`，frontmatter 完整。
- [ ] 有稿场次的 `.md` 包含原始逐字稿；无稿场次有说明。
- [ ] `llms.txt` 可访问，包含成员与 `.md` 链接。
- [ ] HTML 单场页有 `rel="alternate" type="text/markdown"`。

### 缓存 / 发布

- [ ] 第二次请求 `Cf-Cache-Status: HIT`（或 `REVALIDATED`）。
- [ ] ingest 后 purge 生效，页面与 `.md` 返回新数据。
- [ ] purge 端点拒绝无 token 请求。
- [ ] 部署后缓存行为符合 `cross_version_cache` 配置。
- [ ] `stale-if-error` 行为符合预期。
- [ ] 新场次从抓取到页面可见不触发前端构建。
- [ ] 代码部署不影响已有数据；数据库 migration 向后兼容。

### 运维

- [ ] `DATABASE_URL` 只在服务端读取。
- [ ] R2 公开域名只暴露封面/表情；逐字稿通过 binding。
- [ ] 定时任务失败会开 issue。
- [ ] 回滚演练通过。
- [ ] Worker 日志能定位慢查询与 CPU 超限。

## 15. 风险与待决

| 风险 / 待决 | 影响 | 处理 |
| --- | --- | --- |
| Workers Free 10 ms CPU | SSR 可能超限 | 使用 Workers Paid；首版实测 CPU 后再上线 |
| Neon 跨区延迟 | 首屏慢 | 选离 Worker 主流量近的区域；控制查询数；缓存 |
| Neon HTTP 无交互事务 | ingest 无法原子写入 | ingest 用 `postgres` / WebSocket Pool，不用 `neon-http` |
| 全量弹幕体积 | 6.91M 行、GB 级 | 首版只入聚合；`chat_events` 预留分区，后补 |
| `stream_words` 膨胀 | 词表行数大 | 只存 `count >= 3`；全量词频留 archive |
| React Router 耦合 | 32 文件 / 84 处 | 先做 `router-compat` 与批量 `Link` 替换；按页面验收 |
| 岛屿 props 序列化 | Date / 函数不能传 | 查询层统一返回字符串；DTO 只含普通对象 |
| 缓存 purge 范围 | zone purge 不影响 Workers Cache | 只走 Worker 内部 purge 端点 |
| `cross_version_cache` | 部署后旧缓存 | 首版关闭；需要时按版本 tag 或部署后 purge |
| `.md` 内容过大 | 逐字稿很长 | 默认裁剪 Top 列表；`?transcript=0` 可选；监控响应体 |
| 重复收录 | HTML 与 `.md` 竞争 | `.md` 加 `noindex`，不进 sitemap；HTML 做 canonical |
| 会员限定内容 | Agent 可能放大传播 | `.md` 与 HTML 可见性一致；敏感场次可在查询层排除 |
| DB 成为单点 | 页面不可用 | 错误态 + `stale-if-error` 窗口；Neon 备份/分支 |
| schema 演进 | 旧 pack 与新表不一致 | `source_schema` + 可空列 + 分阶段回填 |
| 本地无数据库 | 开发不便 | Neon dev branch；或保留只读 fixture 适配器 |
| `Content-Signal` 政策 | 影响 AI 使用 | 站点层面决定；默认 `ai-train=no, search=yes, ai-input=yes` |

需要先拍板的事：

1. Workers 是否直接上 Paid（建议是）。
2. Neon 区域与是否用 dev branch。
3. 原始 pack 是否只放 R2，还是也在库里留一份 JSONB。
4. 全量弹幕的优先级（首版不做）。
5. `Content-Signal` 的具体取值。
6. 是否保留 `?full=1` / `?transcript=0` 这类 Agent 参数。

## 16. 参考

### Astro

- [Astro: Route caching](https://docs.astro.build/en/guides/caching/)
- [Astro: On-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/)
- [Astro: Endpoints](https://docs.astro.build/en/guides/endpoints/)
- [Astro: Middleware](https://docs.astro.build/en/guides/middleware/)
- [@astrojs/cloudflare](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- [Astro: Sitemap integration](https://docs.astro.build/en/guides/integrations-guide/sitemap/)

### Cloudflare

- [Workers: Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers: Cache configuration](https://developers.cloudflare.com/workers/cache/configuration/)
- [Workers: Purge and invalidate the cache](https://developers.cloudflare.com/workers/cache/purge/)
- [Workers: Cache tags](https://developers.cloudflare.com/workers/examples/cache-tags/)
- [Workers: Static Assets routing](https://developers.cloudflare.com/workers/static-assets/routing/)
- [R2: S3 API](https://developers.cloudflare.com/r2/api/s3/)
- [Markdown for Agents](https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/)（本方案不启用，仅作对照）

### 数据库

- [Neon: Serverless driver](https://neon.com/docs/serverless/serverless-driver)
- [Drizzle: Connect Neon](https://orm.drizzle.team/docs/connect-neon)
- [Drizzle: PostgreSQL](https://orm.drizzle.team/docs/get-started/neon-new)

### 本仓库

- [architecture.md](architecture.md) — 现有分层、数据流、路由
- [data-model.md](../data/data-model.md) — manifest / datapack 字段与口径
- [deployment.md](../engineering/deployment.md) — 现有构建、R2 发布、定时任务
- [ssg-research.md](../archive/ssg-research.md) — 旧 SSG 调研；本文替代其结论
- `starter-astro-react` 的 `docs/engineering/astro-experiments.md` — 模板已落地的 Astro 实验记录（本地路径 `D:\git\starter-astro-react\docs\engineering\astro-experiments.md`）

