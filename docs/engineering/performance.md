# 性能记录

这份文档记录当前的性能设计、实测数字与回归方式。改数据加载、路由或图片管线时同步更新。

## 原则

1. **只传必要的数据**：首屏、组首页、相册各自加载自己的最小数据，不为了一个数字拉整份 manifest。
2. **能预计算的在发布时算**：全期汇总、封面 key、组级文件都在 `publish:data` / `sync:data` 生成。
3. **依赖“现在”的窗口在客户端算**：近 7 天、本月随日期变化，不能冻结在发布产物里。
4. **缓存分层**：内存去重 → sessionStorage → HTTP / 对象存储，不同层解决不同问题。
5. **先量再改**：入口 chunk、数据文件、字体、LCP 都有实测数字；没有数字的“优化”不进文档。

## Astro SSR（2026-11-03）

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

### 长列表首屏上限（2026-11-03）

成员最多 506 场、全组 1,897 场。此前 SSR 把所有行/封面都写进 HTML，页面体积随场次线性膨胀。现在：

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

- **CSS 外链**：`build.inlineStylesheets: 'never'`。之前 384 KB 字体/Tailwind CSS 内联在每个 HTML，生产构建下 HTML 体积约减半（如 `/nonoka` 从约 793 KB 到 409 KB）。
- **去掉重复 props**：`manifest` 不再作为岛屿 props，由 `rows` 在壳层组装；单场 / 对比的 pack 去掉全量 `authors` / `wordCounts`（视图只用 Top 列表）。
- **查询**：成员页的 datasets / streams / insights 三个查询并行；`listStreams` 用 `count(*) over()` 一次取总数。
- **缓存意图**：每个数据页显式 `Astro.cache.set`，tag 覆盖 `dataset-<id>` / `stream-<videoId>`；sitemap / llms / `.md` 同样带 tag。
- **岛屿水合**：页面岛屿改为 `client:idle`，先完成 HTML 替换，交互在水合后接管。

### 仍待优化

- **壳层流式输出**：目前整个页面（侧栏 + 页头 + 内容）是一个岛屿，Astro 必须等它 SSR 完才开始输出。把壳层拆成 Astro 布局 + `transition:persist` 的独立岛屿，内容区用 `server:defer` / 流式渲染，首字节可以更早到达。参考 [Astro streaming recipe](https://docs.astro.build/en/recipes/streaming-improve-page-performance/)。
- **岛屿 props 体积**：列表首屏已限 100 / 60 行，但完整 `rows` 仍作为 props 序列化进 HTML；下一步按路由裁剪字段，或改成 `/api/streams` 分页。
- **客户端数据缓存**：路由切换只依赖 Workers Cache；可以在 `sessionStorage` 缓存最近一次 `DatasetPageData`，返回时先渲染旧数据再校验。
- **Worker 同区**：生产必须让 Worker 与 Neon 区域接近，否则每个请求固定多一个 RTT。

## 旧实现（迁移前记录）

下面几节是 React Router + Vite 静态站的首屏数据流、缓存与实测，保留作对照。

## 首屏数据流

### 组首页 `/`

```text
index.json（约 1.8 KB）
  └─ group-summary.json（约 17 KB raw / 3.6 KB gzip）
       members：5 位成员的全期汇总
       days：最近 40 天有场次的按日桶（当前 93 项）
       latest：每位成员最新一场
       recent：全组最近 20 场
```

不再请求 5 份完整 manifest（约 2.7 MB raw / 293 KB gzip）。`days` 只保留最近 40 天：近 7 天与本月窗口最多覆盖 31 天，客户端用当前日期在这些桶上求和即可，不需要逐场明细。

### 全组相册 `/gallery`

`group-gallery.json`（约 829 KB raw / 149 KB gzip）包含全部 1,891 行精简场次，只在相册路由加载。组首页不碰这个文件。

### 成员页 `/:datasetId`

`index.json` 与 manifest / insights 并行出发。路由里已经有 `datasetId`，`DatasetIndexGate` 用 `useMatches()` 提前调用 `prefetchDataset()`，不必等索引回来再发请求。

### 回退链

```text
远端 group-*.json
  └─ 构建快照 public/data/group-*.json
       └─ 5 份 manifest（兼容还没重新发布的对象存储）
```

远端文件缺失时不会白屏；旧部署的 manifest 仍然能渲染同样的组首页与相册。

## 缓存分层

| 层 | 对象 | 行为 |
| --- | --- | --- |
| 模块内存 | manifest / insights / group 文件 | 5 分钟 TTL + in-flight 去重；一个消费者取消不取消共享请求 |
| sessionStorage | `index.json`、`group-summary.json` | 10 分钟 TTL，带索引版本校验；先渲染缓存，再后台校验 |
| HTTP | `assets/*` | `Cache-Control: immutable`，文件名带 hash |
| HTTP | 数据 JSON | manifest / insights / datapack 用 `?v=<index.generatedAt>` 换 URL；索引本身带时间戳重新取 |
| 图片 | 封面 / 头像 | 由浏览器按 `srcset` / `sizes` 选择，长缓存 |

sessionStorage 只放小文件：索引（约 1.8 KB）和组首页摘要（约 17 KB）。相册的 829 KB 不进 sessionStorage，交给版本化 URL 的 HTTP 缓存，避免占配额和额外解析。

## 图片

- **头像**：900×900 JPG → 128×128 JPEG（quality 82），5 张合计 631.6 KB → 29.8 KB（-95%）。界面上只显示 20–24 px，128 px 足够覆盖高 DPI。
- **封面**：原图 1280×720 JPEG；`fetch:thumbs` 用 `Bun.Image` 生成 480 / 960 / 1280w WebP（quality 78）。列表与相册用 `srcset` 只下 480w，首屏主图用 `sizes` + `fetchPriority="high"` 下 960w/1280w。
- 容器固定 `aspect-video`，图片解码前就预留高度，CLS 接近 0。

## 代码拆分

- 路由全部 `React.lazy()`；单场页、图表、逐字稿各自成 chunk。
- `CommandPalette` 首次按 ⌘K 才动态加载，入口 chunk 从 404.8 KB 降到 364.0 KB（gzip 128.4 → 117.1 KB）。
- `react-markdown` + `remark-gfm` 只进逐字稿 chunk；D3 按图表模块 tree-shake。
- 相册的月份分组用 `content-visibility: auto`，长列表不一次性布局。

## 字体

- Noto Sans 与 Noto Sans SC 都是 variable 字体，按 `unicode-range` 拆成大量子集；浏览器只下载页面实际用到的子集。
- `font-display: swap`，首帧先用系统字体。
- 没有 preload 字体：本地实测 LCP 元素是首屏封面图，提前拉 100 KB 字体会和图片抢带宽。

## 实测

本地 `vite preview` + 远端数据，`agent-browser vitals`：

| 页面 | FCP | LCP | CLS |
| --- | ---: | ---: | ---: |
| 成员首页 `/:datasetId` | 144 ms | 996 ms（960w 封面） | 0.0003 |
| 组首页 `/` | 112 ms | 2048 ms（960w 封面） | 0.0001 |

组首页请求：`index.json` + `group-summary.json`，没有 manifest。相册请求：`index.json` + `group-gallery.json`。

数据文件对比：

| 文件 | raw | gzip |
| --- | ---: | ---: |
| 5 份完整 manifest | 2745 KB | 293 KB |
| `group-summary.json` | 17 KB | 3.6 KB |
| `group-gallery.json` | 829 KB | 149 KB |

## 回归方式

```bash
bun run check            # typecheck + test + lint
bun run build            # sync:data + tsc + vite + SEO 预渲染
bun run validate:data    # index / manifest / insights / group-* 结构与场次数
bun run verify:seo       # 预渲染页面、sitemap、robots
```

浏览器侧：

```bash
bunx vite preview --port 4173 --strictPort
agent-browser vitals http://localhost:4173/arale --json
agent-browser network requests
```

重点看：

- `/` 是否只请求 `index.json` + `group-summary.json`；
- `/gallery` 才请求 `group-gallery.json`；
- 阻断 `group-summary.json` 后刷新，sessionStorage 缓存是否仍能渲染；
- 清空 sessionStorage 再阻断新文件，是否回退到 manifest；
- LCP 仍然是封面图，而不是字体或大块布局。

## 后续可做

- 单成员 manifest 仍有未使用字段（如 `sessionDir`、`snapshotComments`、`maxConcurrentAt`、`rank`、`generatedAt`）。先审计 `src/lib/aggregate.ts` 与视图的字段使用，再决定是否裁剪 schema。
- 如果以后统一改成 axios，可以评估 `axios-cache-interceptor`；当前 fetch 层已经覆盖它的去重、TTL、storage 与 SWR 语义，单独为缓存引入 axios 不划算。
- 对象存储侧开启 Brotli、HTTP/2/3 与长缓存头，收益取决于托管配置。
