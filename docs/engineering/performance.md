# 性能记录

这份文档记录当前的性能设计、实测数字与回归方式。改数据加载、路由或图片管线时同步更新。

## 原则

1. **只查必要的数据**：页面只查当前视图需要的列与行，不为了一个数字扫整张表。
2. **聚合在 SQL / ingest 里做**：`dataset_insights` 预聚合；请求期不重算全量场次。
3. **首屏有上限**：列表 100 行、相册 60 张，其余由「显示更多」在已水合的岛屿里追加。
4. **缓存分层**：Workers Cache → 浏览器 HTTP 缓存 → 图片长缓存。
5. **先量再改**：没有数字的“优化”不进文档。

## Astro SSR（2026-11-04）

当前形态是 Astro SSR + Neon PostgreSQL + Cloudflare Workers。下面的数字来自**生产构建**，用 `wrangler dev` 跑 `dist/server/entry.mjs`，不是 `astro preview`（后者是开发模式：CSS 内联、cache no-op，数字会显著偏差）。

### 复现

```bash
bun run build
bunx wrangler dev --config dist/server/wrangler.json --port 8787 --ip 127.0.0.1
bun run perf:smoke -- --url http://127.0.0.1:8787
```

`perf:smoke` 每个 URL 请求 5 次，输出响应体中位数、耗时中位数、`cache-tag` 与 `content-type`。

### 实测（全量数据，本机 → ap-southeast-1 Neon）

| 路由 | HTML 中位数 | 耗时中位数 | cache tag |
| --- | ---: | ---: | --- |
| `/` | 98.6 KB | 410 ms | `group` |
| `/gallery` | 1.65 MB | 402 ms | `group,gallery` |
| `/compare` | 365 KB | 1.20 s | `datasets,group,compare` |
| `/nonoka` | 894 KB | 181 ms | `datasets,dataset-nonoka` |
| `/nonoka/streams` | 1.16 MB | 178 ms | `datasets,dataset-nonoka` |
| `/nonoka/trends` | 828 KB | 165 ms | `datasets,dataset-nonoka` |
| `/nonoka/gallery` | 695 KB | 178 ms | `datasets,dataset-nonoka` |
| `/nonoka/transcripts` | 618 KB | 164 ms | `transcripts,dataset-nonoka` |
| `/nonoka/compare` | 1.22 MB | 475 ms | `dataset-nonoka,compare` |
| `/nonoka/stream/<id>` | 696 KB | 402 ms | `streams,stream-<id>,dataset-nonoka` |
| `.../<id>.md` | 14.0 KB | 359 ms | `streams,stream-<id>,dataset-nonoka` |
| `/sitemap.xml` | 192 KB（约 1,930 条 URL） | 301 ms | `sitemap` |
| `/llms.txt` | 5.3 KB | 257 ms | `llms` |

- 响应头带 `cloudflare-cdn-cache-control` 与 `Cache-Tag`；middleware 同步一份 `Cache-Control`，让 `<link rel=prefetch>` 的预取能被浏览器复用。
- 耗时是**本机跨区**访问 Neon 的数字（每轮并行查询 ≈ 1 个 RTT）。同区 Worker + Neon 会低一个量级；线上以 `Cf-Cache-Status` 与 `x-response-time` 为准。
- `bun run db:query`（列表 + insights，全量场次）：p50 122.5 ms / p95 247.6 ms。
- 首次请求冷，后续命中 Workers Cache 后只付边缘响应；本地 `wrangler dev` 不复现 Cache HIT，需线上观察。

### 数据库读路径（2026-11-05）

本地库：1,901 场、5 个成员、`stream_words` 10.3 万行、`stream_authors` 6.1 万行、库大小 59 MB。
`bun run db:bench` 经本机 Neon HTTP 代理（与 workerd 相同的 `neon-http` 驱动）统计冷渲染的 SQL 条数、`/sql` 请求数与 p50/p95。

| 场景 | 改造前 SQL / HTTP | 改造后 SQL / HTTP | 改造后 p50 / p95 |
| --- | ---: | ---: | ---: |
| 成员首页 `dataset-home` | 3 / 3 | 3 / 1 | 6.8 / 27.6 ms |
| 成员逐字稿 `dataset-transcripts` | 4 / 4 | 4 / 2 | 6.0 / 7.7 ms |
| 单场页 `stream-page` | 10 / 10 | 10 / 2 | 6.5 / 8.8 ms |
| 单场 `.md` | 9 / 9 | 9 / 2 | 3.9 / 4.8 ms |
| `/api/packs` | 7 / 7 | 7 / 1 | 3.3 / 4.7 ms |
| 对比页（3 场） | 21 / 21 | 9 / 2 | 9.6 / 12.1 ms |
| 组首页 | 5 / 5 | 5 / 1 | 8.9 / 10.2 ms |
| 组相册 | 2 / 2 | 2 / 1 | 10.3 / 12.7 ms |
| 组对比 | 2 / 2 | 2 / 1 | 8.5 / 10.5 ms |
| 组日历 | 3 / 3 | 3 / 1 | 3.3 / 4.2 ms |
| `sitemap.xml` | 6 / 6 | 2 / 1 | 3.6 / 5.1 ms |
| `llms.txt` | 6 / 6 | 2 / 1 | 6.3 / 26.3 ms |

- 改造前为 10 轮、改造后为 20 轮；本机没有跨区 RTT，毫秒数只用于同机对比，**请求数**才是线上费用的主信号。
- 对比页的 SQL 从 21 条降到 9 条：`getStreamPacks()` 用 `inArray` 一次取回多场，SQL 条数不再随场次数增长。
- 组相册 p50 从 33.2 ms 降到 10.3 ms，来自窄列查询（只取 14 个字段，不再 `select *`）。

复现：

```bash
bun run dev:db
bun run db:bench -- --rounds 20 --label after
bun run db:query
```

### 客户端与单场页（2026-11-05 收尾）

这一轮的目标不是继续压 SQL 往返，而是削减首屏字节与客户端代码。实测：

| 项 | 改造前 | 改造后 | 说明 |
| --- | ---: | ---: | --- |
| 客户端 JS | 30 chunk / 1.52 MB | 20 chunk / 0.98 MB | 逐字稿 glob 只在 DEV 打包；命令面板改为按需加载 |
| 逐字稿 client chunk | 12 个 | 0 | 生产构建不再包含 `content/transcripts/**` 原文 |
| 单场页 HTML（生产 preview） | 696 KB | 281 KB | 不再为 1 行 summary 拉回整成员 34 列 |
| 成员对比页 HTML（生产 preview） | 1.22 MB | 1.15 MB | 只传逐分钟密度，不再传整份 pack |
| 对比页 3 场查询 | 9 SQL / 2 HTTP | 4 SQL / 2 HTTP | `compare-3-density` |
| 单场页查询 | 10 SQL / 2 HTTP | 12 SQL / 2 HTTP | 多 2 条窄查询，传输量显著下降 |

- 单场页第一轮取「成员 + 标题级导航索引 + 当前场次 + 公开汇总」，第二轮把「逐字稿元数据 + pack + 最多 2 行邻场摘要」放进同一个 batch；往返仍是 2 次。SQL 从 10 增到 12，但不再传输整成员摘要，线上按传输计费时更划算。
- `/api/densities/:dataset?ids=...` 只返回 `perMinute` 数组；对比页切换场次时按需补拉，会员限定场沿用同一套公开范围判断。
- 成员列表查询改为显式 34 列，去掉了 `content_hash`、`source_schema`、`ingest_batch_id` 等写路径字段。
- 交互侧：场次搜索 200 ms 防抖；`DatasetViewContext` 的 value 做了 memo；图表 hover 合并到 rAF 且索引未变时不重渲；图表测量前预留高度。

复现：

```bash
bun run build
bun run preview -- --port 4322
bun run db:bench -- --rounds 10 --label after-client-perf-3
```

生产 preview 的页面体积：

```text
/nonoka/stream/<videoId>   281.4 KB
/nonoka/compare            1152.8 KB
/nonoka                    896.3 KB
/nonoka/streams            1177.0 KB
```

浏览器实测（agent-browser，生产 preview）：

- 场次页输入「歌」：URL 立即不变，约 200 ms 后变为 `?q=%E6%AD%8C`，表格从 100 行降到 21 行。
- `Control+K`：命令面板按需加载后打开，成员与场次条目正常；console 无报错。
- 单场 `?view=timeline`：指针移动后读数出现（示例 `第 126 分 · 6 条 · SC 0 笔`）。
- 对比页从 2 场加到 3 场：发出 `/api/densities/nonoka?ids=...`，200，曲线从 2 条变 3 条。

### 长列表首屏上限

成员最多约 500 场、全组约 1,900 场（以数据库为准）。此前 SSR 把所有行 / 封面都写进 HTML，页面体积随场次线性膨胀。现在：

| 路由 | 上限前 | 上限后 | 变化 |
| --- | ---: | ---: | ---: |
| `/gallery` | 4,995,990 B | 1,729,031 B | -65% |
| `/nonoka/streams` | 2,245,374 B | 1,211,104 B | -46% |
| `/nonoka/gallery` | 1,050,355 B | 712,086 B | -32% |

- `StreamsView` 首屏只渲染 100 行，`GalleryView` 只渲染 60 张封面，其余用「显示更多」由已水合的岛屿就地追加，不再重新请求 SSR。
- 筛选 / 排序变化时回到首批，避免旧上限让结果看起来是空的；CSV 导出仍然基于完整筛选结果。
- 剩余体积主要是岛屿 props（完整 `rows` / `streams`）与正文；再往下需要按路由裁剪 props 或改成 `/api/streams` 分页。

### 交互实测（生产构建，agent-browser）

| 场景 | 结果 |
| --- | --- |
| 单场 `?view=` 分段切换 | 27 ms，`history.replaceState`，没有新的 navigation entry |
| 侧栏路由切换（未预热） | 约 1.5–2.1 s，主要花在 SSR + Neon 跨区等待 |
| hover 预取 | 发出 `<link rel=prefetch>`；本地 `wrangler dev` 的第二次 fetch 仍走网络 |
| 水合 | `astro-island[ssr]` 归零，无 console/page error |
| 390px 布局 | 无横向溢出 |

### 本轮改动

- **CSS 外链**：`build.inlineStylesheets: 'never'`。之前 384 KB 字体 / Tailwind CSS 内联在每个 HTML，生产构建下 HTML 体积约减半（如 `/nonoka` 从约 793 KB 到 409 KB）。
- **去掉重复 props**：`manifest` 不再作为岛屿 props，由 `rows` 在壳层组装；单场 / 对比的 pack 去掉全量 `authors` / `wordCounts`（视图只用 Top 列表）。
- **查询**：成员页的 datasets / streams / insights 三个查询通过 `db.batch` 放进一次 Neon HTTP 请求；`listStreams` 需要总数时才用 `count(*) over()`，页面传 `withTotal: false`。
- **缓存意图**：每个数据页显式 `Astro.cache.set`，tag 覆盖 `dataset-<id>` / `stream-<videoId>`；sitemap / llms / `.md` 同样带 tag。
- **岛屿水合**：页面岛屿改为 `client:idle`，先完成 HTML 替换，交互在水合后接管。

### 仍待优化

- **壳层流式输出**：目前整个页面（侧栏 + 页头 + 内容）是一个岛屿，Astro 必须等它 SSR 完才开始输出。把壳层拆成 Astro 布局 + `transition:persist` 的独立岛屿，内容区用 `server:defer` / 流式渲染，首字节可以更早到达。参考 [Astro streaming recipe](https://docs.astro.build/en/recipes/streaming-improve-page-performance/)。
- **按视图拆岛屿**：`DatasetPage` / `GroupPage` 仍静态引入全部视图。直接改 `React.lazy` 会让 SSR 输出 Suspense fallback，单场与成员页丢失正文；正确做法是把壳层移出 React 岛屿，再按视图挂独立岛屿，属于结构性改造，暂缓。
- **岛屿 props 体积**：列表首屏已限 100 / 60 行，但完整 `rows` 仍作为 props 序列化进成员列表页；下一步按路由裁剪字段，或改成 `/api/streams` 分页。对比页仍带着该成员全部 `rows`，密度已经单独取。
- **Worker 同区**：生产必须让 Worker 与 Neon 区域接近，否则每个请求固定多一个 RTT。
- **线上实测**：`Cf-Cache-Status`、purge 生效、Worker CPU 与 wall time 仍待部署后记录。
- **预聚合进 ingest**：`datasets.stream_count` 与组首页 summary 目前仍在请求期计算，场次继续增长后可像 `public_totals` 一样落库。
- **分页替代 2,000 上限**：`getDatasetPageData()` 仍一次取当前成员全部场次；超过上限需要服务端分页或按路由裁剪 props。

## 图片

- **头像**：900×900 JPG → 128×128 JPEG（quality 82），5 张合计 631.6 KB → 29.8 KB（-95%）。界面上只显示 20–24 px，128 px 足够覆盖高 DPI。
- **封面**：原图 1280×720 JPEG；`fetch:thumbs` 用 `Bun.Image` 生成 480 / 960 / 1280w WebP（quality 78）。列表与相册用 `srcset` 只下 480w，首屏主图用 `sizes` + `fetchPriority="high"` 下 960w / 1280w。
- 封面 / 表情由 `PUBLIC_R2_BASE` 直接提供，长缓存由 R2 自定义域名的 Cache Rule 控制；容器固定 `aspect-video`，图片解码前就预留高度，CLS 接近 0。
- 逐字稿正文不公开暴露，按需走 `/api/transcripts/:datasetId/:videoId`。

## 字体

- Noto Sans 与 Noto Sans SC 都是 variable 字体，按 `unicode-range` 拆成大量子集；浏览器只下载页面实际用到的子集。
- `font-display: swap`，首帧先用系统字体。
- 没有 preload 字体：本地实测 LCP 元素是首屏封面图，提前拉 100 KB 字体会和图片抢带宽。

## 回归方式

```bash
bun run check            # astro check + test + lint
bun run build            # astro build（Worker + 预渲染 404/500/about）
bun run db:query         # 查询层冒烟 + P50/P95
bun run db:bench         # 冷渲染 SQL / HTTP 往返与 p50/p95（本地库）
bun run db:verify        # 改 ingest / 数据时
bun run perf:smoke -- --url http://127.0.0.1:8787
bun run test:smoke       # 功能性路由冒烟
```

重点看：

- `/` 的查询数与 HTML 体积没有反弹；
- `/gallery` 仍只输出首批 60 张；
- `.md` 响应体 < 200 KB（有逐字稿时按实际）；
- 图片使用 480w 变体而不是全量原图；
- LCP 仍然是封面图，而不是字体或大块布局。
