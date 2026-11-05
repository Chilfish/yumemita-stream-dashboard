# 性能优化审计：客户端、读路径与数据管线

> **状态**：P0 大部分已落地（2026-11-05），按视图拆岛屿暂缓
> **实测记录**：见 [engineering/performance.md](../engineering/performance.md)「客户端与单场页（2026-11-05 收尾）」
> **范围**：Astro SSR 页面、岛屿资源、交互热点、Neon 读路径、ingest / publish 管线、部署产物
> **基线**：读路径与页面体积沿用 [engineering/performance.md](../engineering/performance.md) 与 [db-optimization.md](./db-optimization.md) 的实测；落地项的 before / after 见 performance.md。本文保留调研阶段的「预计」估算，未复测的数字仍按估算看待。

## 1. 结论

上一轮把冷渲染的 SQL 与 HTTP 往返压到 1–2 次，继续优化 DB 往返的边际收益已经很小。现在的成本集中在四处：

1. **页面把完整 `rows` / `pack` 序列化进岛屿 props**，HTML 与客户端水合都随场次线性增长。
2. **每个页面只有一个巨型岛屿**，且静态引入全部视图；打开成员首页也会下载趋势图、Markdown 渲染器与对比视图的代码。
3. **对比页为了 `density.perMinute` 取回整份 pack**，`.md` 也为一个字段取整段 detail jsonb。
4. **ingest / publish 每天全量读约 159 MB pack，并按场逐条写库**；数据量继续增长时这是最先爆掉的一环。

客户端交互侧另有三个低成本热点：场次搜索无防抖、图表 hover 每次重建整棵 SVG、`DatasetViewContext` 的 value 未 memo（打开 ⌘K 会让整页重算）。

## 2. 实测与产物基线

生产构建 `dist/` 的本机产物（2026-11-05）：

| 项 | 数值 |
| --- | ---: |
| `dist/` 总体积 | 117.8 MB |
| `public/` 总体积 | 99.6 MB（`public/data/` 占绝大部分，已 gitignore） |
| 客户端 JS | 30 个 chunk，合计 1.52 MB |
| 客户端 CSS | 1 个文件，369.2 KB（gzip 82.3 KB） |
| `shell-theme.*.js`（两个入口共享） | 348.2 KB（gzip 114.4 KB） |
| `dataset-page.*.js` | 290.3 KB（gzip 87.6 KB） |
| `client.*.js`（React 运行时） | 204.2 KB（gzip 64.1 KB） |

页面级 HTML 中位数沿用现有实测：`/gallery` 1.65 MB、`/nonoka/compare` 1.22 MB、`/nonoka/streams` 1.16 MB、单场页 696 KB。这些体积里最大的一块都是岛屿 props，而不是正文。

## 3. 前端资源与岛屿

### 3.1 单岛屿 + 全量静态引入

- 每个页面只挂一个 `client:idle` 岛屿（成员页 `DatasetPage`，组页 `GroupPage`），侧栏、页头、命令面板、正文、图表都在同一个 React root 里。
- `src/components/app/dataset-page.tsx` 顶部静态引入 `CalendarPage / GalleryPage / HomePage / StreamsPage / TranscriptsPage / TrendsPage / CompareView / LockedStreamView / StreamDetailView`，运行时才按 `view` 分支渲染。
- `src/components/app/group-page.tsx` 同样静态引入 5 个组视图。

因此打开任意成员路由都会拿到全部视图代码：d3 图表、`react-markdown` + `remark-gfm`、对比视图、单场详情。产物里两个入口都指向同一个 348 KB 的共享 chunk。

### 3.2 props 与 HTML 重复

- `getDatasetPageData()` 固定 `limit: 2000`，把该成员全部场次作为 `rows` 传给岛屿（`src/db/queries/view-data.ts`）。首屏只渲染 100 行，但 500 行全部进 HTML。
- 单场页也走 `getDatasetPageData()`，为了 `rows.find(videoId)` 拉回整成员列表，再把 `stream`（`rows` 中的同一项）和整份 `pack` 一起传进岛屿。
- 对比页把最多 3 份完整 `StreamDatapack` 作为 `comparePacks` 序列化进 HTML；视图实际只读 `pack.chat.density.perMinute`。
- Astro 的 props 序列化不做对象引用去重，`dataset` 与 `datasets` 中的同项、`stream` 与 `rows` 中的同项都会写两遍。

### 3.3 仅在交互时需要的代码

- `CommandPalette` 在 `DatasetShell` 中无条件挂载，连带 `@base-ui/autocomplete`、`scroll-area`、`dialog` 进入首屏包；它只在 ⌘K 时打开。
- `ThemeProvider` 是每页 `client:load` 岛屿，但 `Layout.astro` 的内联脚本已经在首帧前从 `localStorage` 解析并加好主题 class；岛屿水合后又用 zustand 重算一次。
- `react-markdown` 只服务逐字稿与单场描述，却挂在 dataset 岛屿入口上。

### 3.4 逐字稿构建期兜底

`src/hooks/use-transcript.ts` 的 `import.meta.glob('/content/transcripts/**/*.md', { query: '?raw' })` 没有 `import.meta.env.DEV` 守卫：

- 生产构建为每篇逐字稿生成独立 client chunk（当前 12 篇），全部随 Worker 静态资源发布。
- chunk 路径可由 `videoId` 推导，会员限定场次的逐字稿原文存在被直接枚举获取的风险，与 `/api/transcripts` 的访问控制不一致。这是本次审计发现的安全问题，不只是体积问题。

### 3.5 静态资源

- `public/data/` 约 99.6 MB（nonoka thumbs 单项 40.4 MB），构建时整份拷贝到 `dist/client/data/`。目录已 gitignore，CI 构建通常不带；但本地 `bun run cf:deploy` 会把这 100 MB 一并上传。线上资源已走 `PUBLIC_R2_BASE`，这些文件只在缺少该变量时作为本地兜底。
- 头像单 `src`，没有 `srcset` / `width` / `height`；头像已压到 128 px，收益有限。
- 封面、表情的 `srcset` / `sizes` / `lazy` / `async` 已经正确，不需要再改。
- `@daypicker/react` 只被未被引用的 `ui/calendar.tsx` 使用；`@fontsource-variable/geist-mono` 与 `inter` 没有被任何样式引入。两者都可以删。

## 4. 前端交互热点

| 热点 | 位置 | 原因 |
| --- | --- | --- |
| 场次搜索每次按键全量 filter + sort | `streams-toolbar.tsx` → `streams-page.tsx` → `streams-view.tsx` | 无防抖；排序比较器每次调用 `Date.parse`，2000 行时是数万次解析；同时重渲 100 行表格 |
| 图表 hover 重建整棵 SVG | `chat-density.tsx`、`stream-timeline.tsx`、`multi-line-chart.tsx` + `chart-canvas.tsx` | hover state 在图表组件内，几何计算与图元生成都在 render 里；pointermove 无 rAF 节流，handler 里还读 `getBoundingClientRect()` |
| ⌘K / 主题切换牵动整页重算 | `dataset-page.tsx` 的 `DatasetViewContext.Provider value={{...}}` | value 每次渲染新建，Provider 下所有视图与图表一起重渲 |
| 对比页勾选列表渲染全部场次 | `compare-view.tsx` | 291–2000 个 `Label + Checkbox`，每次勾选都整列 reconcile |
| 评论 / SC 明细全量 DOM | `stream-comments-panel.tsx`、`stream-paid-panel.tsx` | 没有窗口化；项目已有 `content-visibility` 范式但未用到这里 |
| 逐字稿切换重新解析 Markdown | `transcript-view.tsx` | 子视图切换会卸载，切回来重新 `react-markdown` 解析 |
| 图表首次渲染弹入 | `chart-canvas.tsx` | 宽度测量前不渲染、不占位，水合后才出现，造成布局位移 |
| 移动端与桌面列表同时渲染 | `streams-view.tsx`、`home-recent-streams.tsx` | 一份用 `md:hidden` 隐藏，桌面端白构建 100 张卡片 |
| 跨路由缓存全部丢失 | `use-transcript.ts`、`lib/media.ts`、compare 的 `packs` state | ClientRouter 整页 swap 后模块级 Map 清空，重复访问重新 fetch + 解析 |

## 5. 后端读路径

### 5.1 超取

| 项 | 位置 | 说明 |
| --- | --- | --- |
| 列表 `select *` | `src/db/queries/streams.ts` 的 `buildStreamListQuery` | `getTableColumns(streams)` 带 `id` / `content_hash` / `source_schema` / `ingest_batch_id` / `updated_at`，映射只用到约 25 列 |
| 单场页拉整成员 | `src/pages/[datasetId]/stream/[videoId].astro` | 为 1 行 summary 查回最多 2000 行；这是 sitemap 的主力 URL 形态 |
| 对比页整份 pack | `src/db/queries/packs.ts` 的 `getStreamPacks` | 6 条子表 × N 场，只为 `density.perMinute`；`comments` / `paid_events` 无 limit |
| `.md` 整段 detail | `DETAIL_COLUMNS` | `renderStreamMarkdown` 只用 `density` / `coveragePct`，却取 `events` / `ownerChats` / `emojis` 等最大 jsonb |
| `llms.txt` 全表标题 | `buildAllStreamHeadsQuery` | 取回全部场次标题，最终每成员只用 20 条、输出 5 条 |
| `datasets` 每请求聚合 | `src/db/queries/datasets.ts` | `left join streams + count(*) + group by` 算 5 个数字，而 `dataset_insights.totals` 已有 |
| 逐字稿索引多 2 列 | `src/db/queries/transcripts.ts` | `r2Key` / `contentHash` 不参与渲染 |
| 死列 / 死查询 | `stream_details.raw_detail`、`getDatasetInsights` | `raw_detail` 从未写入；`getDatasetInsights` 只被冒烟脚本引用 |

### 5.2 缓存

- `/api/transcripts` 的 404 与 `.md` 的 404 都是 `no-store`，随机路径每次都打库。
- 会员锁定版 `.md` 只设 `Cache-Control`，没有 `context.cache.set()`，Workers Cache 不生效；HEAD 也直接查一次库。
- `routeRules` 与页面 `Astro.cache.set` 的 tag 已经分叉（并集才正确），`compare` tag 没有任何 purge 方，属于死 tag。
- `cross_version_cache: false` 让每次部署从冷缓存开始；provider 已自动打 `astro-version` tag，开启后可按版本 purge。
- 页面把 `Astro.url.search` 原样传给岛屿，`?q=` / `?sort=` / `?ids=` 每个组合都是一次独立 SSR 和独立缓存条目；`?ids=` 由用户组合，基数无上界。

### 5.3 Worker 运行时

- 整个页面是一个岛屿，Astro 必须等 React SSR 完成才开始输出，TTFB 被整页渲染拖住。
- `.md` 先 `await getStreamPack()` 再 `await readTranscriptBody()`，DB 与 R2 本可并行。
- `/api/transcripts` 的 stream 与 transcript meta 是两轮串行查询。
- 没有 statement timeout，慢查询会持续吃 Neon compute。

## 6. 写入与发布管线

| 问题 | 位置 | 影响 |
| --- | --- | --- |
| 每个 pack 一个事务、约 15 条语句 | `scripts/ingest-db.ts` | 1900 场约 2.8 万次 WebSocket 往返 |
| 子表 delete + insert 全量重写 | `scripts/ingest-db.ts` | dead tuple 与 autovacuum 压力；一场变化也整体重写 |
| ingest 后全量重读 pack 算 insights | `scripts/ingest-db.ts` | 每天再读约 159 MB |
| 再从库里全量读明细算 `public_totals` | `scripts/ingest-db.ts` → `dataset-totals.ts` | 每天读 10 MB 级明细 |
| publish 每天全量读 + stringify 所有 pack | `scripts/publish-data.ts` | 读 159 MB、再生成约 159 MB 字符串；`--assets-only` 仍重算 manifest / author index |
| daily-update 串行调 5 个成员 × 多个脚本 | `scripts/daily-update.ts` | 每个成员重复加载 env、连库、读同一份 pack 目录 |

## 7. 正确性风险（与性能改动绑定）

1. **逐字稿 chunk 暴露**：见 §3.4，优先修。
2. **2000 场静默截断**：`listStreams` 与 `getDatasetPageData` 的上限是 2000，而 `dataset.count` / `public_totals` 是全量；超过后列表、趋势、CSV 与 `?ids=` 校验会不一致。
3. **对比页 `?ids=` 依赖截断后的 `rows`**：超过上限的场次会被判无效并静默回退。
4. **`public_totals` 缺失时回退 `totals`**：会员限定场指标会被多算，只打一条 warn。
5. **`groupComments` 的 `!item.byUploader || true`**：`topLevel` 恒等于 `items.length`，是残留逻辑。
6. **`db.batch` 是事务语义**：只能用于只读；写入不要塞进 `runBatch`。
7. **`?key=` 与缓存键**：任何「忽略 query」的 CDN 规则都必须先剔除会员参数，否则会越权缓存。

## 8. 优先级

### P0：高收益、低到中成本

| # | 优化 | 证据 | 预期收益 | 成本 |
| --- | --- | --- | --- | --- |
| P0-1 | 按 `view` 拆分岛屿或改 `React.lazy`，每个路由只加载自己的视图 | `dataset-page.tsx`、`group-page.tsx` | 成员首页 / 场次 / 相册 / 日历 / 对比不再下载 Markdown 解析器与全部图表；共享 chunk 可按视图切开 | 中低 |
| P0-2 | 逐字稿 glob 加 `import.meta.env.DEV` 守卫 | `use-transcript.ts` | 去掉 12+ 个无用 chunk，并堵住会员逐字稿原文枚举 | 极低 |
| P0-3 | 列表查询改显式列，去掉 `content_hash` 等 5 列 | `streams.ts` | 每次冷渲染少约 100–150 KB Neon 传输（2000 行估算） | 极低 |
| P0-4 | 对比页只取 / 只传 `density.perMinute` | `packs.ts`、`compare-view.tsx` | 从 6N 条 SQL + 数百 KB props 降到 1 条查询 + 几十 KB；对比页 HTML 1.22 MB 的主要来源 | 低 |
| P0-5 | 搜索防抖 150–250 ms，输入先走本地 state | `streams-toolbar.tsx`、`streams-page.tsx` | 每键的 O(N log N) 与 100 行重渲降到每 200 ms 一次 | 低 |
| P0-6 | `DatasetViewContext` value 用 `useMemo` | `dataset-page.tsx` | ⌘K / 主题切换不再重算整页与所有图表 | 1 行 |
| P0-7 | 图表 hover rAF 节流 + 缓存 rect + `maxValue` memo | `chat-density.tsx`、`stream-timeline.tsx`、`multi-line-chart.tsx` | pointermove 从每秒数十次整树重建降到每帧一次、只改少量节点 | 低 |
| P0-8 | 单场页改为 1 行 summary + 邻场，不再拉整成员 rows | `stream/[videoId].astro`、`view-data.ts` | 单场页是 SEO 主力，DB 传输降一个数量级 | 中 |

### P1：中收益、中成本

| # | 优化 | 说明 |
| --- | --- | --- |
| P1-1 | `rows` 按路由裁剪字段，或首屏只传 100 行 + 极简索引，其余走 `/api/streams` 分页 | 成员页 HTML 894 KB → 预计 150–250 KB 量级；同时缓解水合 |
| P1-2 | `.md` 只取 `density` / `coveragePct`，pack 查询与 R2 读并行 | 传输与 1 个 RTT |
| P1-3 | pack 子表加 limit，`groupPaid` 单次遍历分组 | 单场 / `.md` 行数与 CPU |
| P1-4 | `llms.txt` 用窗口函数取每成员前 20 | 1901 行 → ≤100 行 |
| P1-5 | `datasets` 统计改读预聚合，ingest 时写 `stream_count` / `generated_at` | 每路由少一次全表聚合，随场次增长不再线性放大 |
| P1-6 | ingest 批量化：多 pack 一个事务、多行 insert、`ON CONFLICT DO UPDATE` 取代 delete + insert | 往返 2.8 万 → 1–2 千；减少 dead tuple |
| P1-7 | ingest 汇总增量：只重算变化场次，或「上一份 + 差量」 | 去掉每天全量读 pack + 全量读库 |
| P1-8 | publish 增量：mtime + size 预筛，`--assets-only` 不再全量 readPacks / stringify | 日常发布从读写 159 MB 两遍降到只碰变化文件 |
| P1-9 | 补 `.md` 锁定版 / 404 / `/api/transcripts` 404 的 `cache.set` 与负缓存 | 随机路径与锁定版不再每次打库 |
| P1-10 | 索引调整：删 `streams_dataset_availability_idx`、`stream_authors_author_idx`、`stream_words_word_idx`，加 `streams(started_at desc)` | 减少 ingest 写放大，组级 `order by started_at` 走索引 |
| P1-11 | 给 Worker 读连接加 statement timeout | 防慢查询持续计费 |
| P1-12 | 稳定 `useKeyboardShortcuts` 监听器、`sortValue` 预计算日期数值、删隐藏端重复列表 | 低成本交互优化 |
| P1-13 | 评论 / SC / 对比勾选列表加 `content-visibility:auto`，或复用现有 `VirtualList` | 长列表绘制与 reconcile |
| P1-14 | 客户端持久缓存：逐字稿、pack、表情索引用 sessionStorage + SWR + 请求去重 | 重复访问几乎瞬时 |

### P2：结构性 / 清理

- 壳层拆成 Astro 布局 + `transition:persist`，正文用 `server:defer` 流式输出。
- 让 HTML 与 query 解耦（岛屿挂载后读 `location.search`），收敛缓存条目语义。
- `cross_version_cache: true` + 部署后按 `astro-version` tag purge。
- 把 `/compare` 的桶与首页 summary 落库，请求期不再全表扫 + 逐行 `classifyTitle`。
- `daily-update` 的 5 段 `runScript` 合并为一次进程内调用。
- 删死代码：`ui/calendar.tsx` + `@daypicker/react`、`geist-mono` / `inter` 字体依赖、未引用的约 28 个 `ui/*`、`stream_details.raw_detail` 死列、`compare` 死 tag。
- 清理 `public/data/` 的构建拷贝，或确认 CI 构建永远不包含它。
- 头像补 `width` / `height` / `decoding="async"`（可选 2 档 srcset）。

### 8.1 实施记录（2026-11-05）

| 项 | 状态 | 落地方式 |
| --- | --- | --- |
| P0-1 逐字稿 glob | ✅ | `import.meta.env.DEV` 守卫；生产 chunk 30 → 20，逐字稿 chunk 归零 |
| P0-2 列表窄列 | ✅ | `SUMMARY_COLUMNS` 显式 34 列，去掉 `content_hash` 等写路径字段 |
| P0-3 对比页密度 | ✅ | `getCompareDensities()` + `/api/densities/:dataset`；3 场 9 → 4 SQL |
| P0-4 按视图拆岛屿 | 📋 暂缓 | `React.lazy` 会让 SSR 输出 fallback，丢失单场 / 成员页正文；需先把壳层移出 React 岛屿 |
| P0-5 搜索防抖 | ✅ | 200 ms，本地 state 先接管输入 |
| P0-6 context memo | ✅ | `DatasetViewContext` 的 value 做 `useMemo` |
| P0-7 图表 hover | ✅ | 共享 `useThrottledHover()`；rAF 合并、索引去重、rect 缓存；`maxValue` memo |
| P0-8 单场页取数 | ✅ | 导航索引 + 当前场次 + 最多 2 行邻场；HTML 696 → 281 KB，往返仍为 2 |
| 命令面板按需加载 | ✅ | `React.lazy` + 打开时才挂载；不参与 SSR |
| 图表占位 | ✅ | 测量前用 `minHeight` 占住高度，减少水合后的布局位移 |
| 排序日期预解析 | ✅ | 每行只 `Date.parse` 一次，比较器读 Map |
| 布局重复渲染 / 列表虚拟化 / 客户端持久缓存 | 📋 | 仍按 P1 对待 |

单场页的取舍：SQL 从 10 增到 12（多了导航索引与邻场摘要两条窄查询），HTTP 往返保持 2 次。Neon 同时按 compute 与传输计费，而原先每次冷渲染要传回整成员 34 列摘要，因此按字节看仍是净收益；后续如果 SQL 条数本身成为瓶颈，再把导航索引下沉为预聚合或缓存。

## 9. 建议执行顺序

已完成的 P0 见 §8.1。剩余按以下顺序：

1. **props 收敛**：成员列表页仍把完整 `rows` 序列化进 HTML；按路由裁剪字段，或改成 `/api/streams` 分页。
2. **壳层重构**：把侧栏 / 页头移出 React 岛屿，才能安全地按视图拆包并做流式输出。
3. **管线批量化**：P1-6 / P1-7 / P1-8（ingest + publish 批量化、增量）。先保证读侧稳定，再动写入。
4. **结构性项**：query 解耦、跨版本缓存，等前三步的数字出来后再评估。

每一步都要按 [engineering/performance.md](../engineering/performance.md) 的方式记录 before / after：

```bash
bun run check
bun run build
bun run db:bench -- --rounds 20 --label after
bun run perf:smoke -- --url http://127.0.0.1:8787
bun run test:smoke
```

前端改动额外用生产构建 + `wrangler dev` 记录 HTML 体积、chunk 体积、LCP / INP 与长任务；只在 `astro preview` 下测的数字不算。

## 10. 未做 / 未验证

- 没有跑 Lighthouse / Performance 面板，交互热点是按代码路径与渲染频率推断的，实施前应先录一次长任务基线。
- 「预计」体积是按行数 × 字段估算，不是实测。
- 没有验证 Cloudflare 静态资源上传是否按内容哈希增量；`public/data/` 的 100 MB 只在本地部署路径上确认存在。
- 没有审计第三方脚本、R2 CORS 与缓存规则的实际命中率。
