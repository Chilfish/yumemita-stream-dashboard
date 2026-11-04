# 性能记录

这份文档记录当前的性能设计、实测数字与回归方式。改数据加载、路由或图片管线时同步更新。

## 原则

1. **只查必要的数据**：页面只查当前视图需要的列与行，不为了一个数字扫整张表。
2. **聚合在 SQL / ingest 里做**：`dataset_insights` 预聚合；请求期不重算 1,897 场。
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

### 实测（全量 1,897 场，本机 → ap-southeast-1 Neon）

| 路由 | HTML 中位数 | 耗时中位数 | cache tag |
| --- | ---: | ---: | --- |
| `/` | 98.6 KB | 410 ms | `group` |
| `/gallery` | 1.65 MB | 402 ms | `group,gallery` |
| `/nonoka` | 894 KB | 181 ms | `datasets,dataset-nonoka` |
| `/nonoka/streams` | 1.16 MB | 178 ms | `datasets,dataset-nonoka` |
| `/nonoka/trends` | 828 KB | 165 ms | `datasets,dataset-nonoka` |
| `/nonoka/gallery` | 695 KB | 178 ms | `datasets,dataset-nonoka` |
| `/nonoka/transcripts` | 618 KB | 164 ms | `transcripts,dataset-nonoka` |
| `/nonoka/compare` | 1.22 MB | 475 ms | `dataset-nonoka,compare` |
| `/nonoka/stream/<id>` | 696 KB | 402 ms | `streams,stream-<id>,dataset-nonoka` |
| `.../<id>.md` | 14.0 KB | 359 ms | `streams,stream-<id>,dataset-nonoka` |
| `/sitemap.xml` | 192 KB（1,929 条 URL） | 301 ms | `sitemap` |
| `/llms.txt` | 5.3 KB | 257 ms | `llms` |

- 响应头带 `cloudflare-cdn-cache-control` 与 `Cache-Tag`；middleware 同步一份 `Cache-Control`，让 `<link rel=prefetch>` 的预取能被浏览器复用。
- 耗时是**本机跨区**访问 Neon 的数字（每轮并行查询 ≈ 1 个 RTT）。同区 Worker + Neon 会低一个量级；线上以 `Cf-Cache-Status` 与 `x-response-time` 为准。
- `bun run db:query`（列表 + insights，全量 1,897 场）：p50 122.5 ms / p95 247.6 ms。
- 首次请求冷，后续命中 Workers Cache 后只付边缘响应；本地 `wrangler dev` 不复现 Cache HIT，需线上观察。

### 长列表首屏上限

成员最多 506 场、全组 1,897 场。此前 SSR 把所有行 / 封面都写进 HTML，页面体积随场次线性膨胀。现在：

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
- **查询**：成员页的 datasets / streams / insights 三个查询并行；`listStreams` 用 `count(*) over()` 一次取总数。
- **缓存意图**：每个数据页显式 `Astro.cache.set`，tag 覆盖 `dataset-<id>` / `stream-<videoId>`；sitemap / llms / `.md` 同样带 tag。
- **岛屿水合**：页面岛屿改为 `client:idle`，先完成 HTML 替换，交互在水合后接管。

### 仍待优化

- **壳层流式输出**：目前整个页面（侧栏 + 页头 + 内容）是一个岛屿，Astro 必须等它 SSR 完才开始输出。把壳层拆成 Astro 布局 + `transition:persist` 的独立岛屿，内容区用 `server:defer` / 流式渲染，首字节可以更早到达。参考 [Astro streaming recipe](https://docs.astro.build/en/recipes/streaming-improve-page-performance/)。
- **岛屿 props 体积**：列表首屏已限 100 / 60 行，但完整 `rows` 仍作为 props 序列化进 HTML；下一步按路由裁剪字段，或改成 `/api/streams` 分页。
- **Worker 同区**：生产必须让 Worker 与 Neon 区域接近，否则每个请求固定多一个 RTT。
- **线上实测**：`Cf-Cache-Status`、purge 生效、Worker CPU 与 wall time 仍待部署后记录。

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
