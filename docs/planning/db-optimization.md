# 数据库优化：请求次数、往返与传输量

> **状态**：已完成（2026-11-05）
> **范围**：Neon PostgreSQL 读路径、索引、缓存失效与本地压测
> **不涉及**：ingest 写入性能、全量弹幕入库（见 B6）

## 1. 背景

Neon 按 compute 时间与网络传输计费，Cloudflare Workers 按请求与 CPU 计费。当前站点的读路径有两个放大器：

- 每个页面在冷缓存时同步查库，一次渲染可能发出 3–21 条 SQL。
- Neon HTTP 驱动下，**每条 SQL 默认是一次 HTTP 请求**；并行只能压缩等待时间，不能减少请求数。

本地库现有 1,901 场、5 个成员，`stream_words` 10.3 万行、`stream_authors` 6.1 万行、库大小 59 MB。后续成员与场次会继续增长，查询粒度不能随数据量线性放大。

## 2. 现状

### 2.1 每条路由的查询量

按当前代码静态统计（冷缓存、一次渲染）：

| 路由 | SQL 条数 | 主要来源 |
| --- | ---: | --- |
| `/` | 5 | `getDatasets` + `getGroupSummary` 的 4 条 |
| `/gallery` | 2 | `getDatasets` + 全表 `select *` |
| `/compare` | 2 | `getDatasets` + 8 列全表 |
| `/calendar` | 3 | `getDatasets` + 场次 + 日程 |
| `/[datasetId]` 及成员页 | 3 | `getDatasets` + `listStreams` + `public_totals` |
| `/[datasetId]/transcripts` | 4 | 上者 + 逐字稿索引 |
| `/[datasetId]/compare` | 3 + 6N | 上者 + 每场 pack 6 条（3 场 = 21） |
| `/[datasetId]/stream/[videoId]` | 10 | 上者 + 逐字稿 + pack 6 条 |
| `.../[videoId].md` | 9 | stream + dataset + pack 6 条 + 逐字稿 |
| `/api/packs/:dataset/:video` | 7 | stream + pack 6 条 |
| `/sitemap.xml` | 6 | datasets + 每成员 1 条 |
| `/llms.txt` | 6 | datasets + 每成员 1 条 |

`pack` 的 6 条是：`streams`、`stream_details`、`paid_events`、`comments`、`stream_words`、`stream_authors`。

### 2.2 往返轮次

独立查询可以并行，但当前多处仍是串行：

- `getDatasetPageData()`：先 `Promise.all` datasets + listStreams，再 `await` publicTotals，共 2 轮。
- `getGroupPageData()`：先 datasets，再 summary / gallery，共 2 轮。
- `getCalendarData()`：先 datasets（页面已传 members 时跳过），再场次 + 日程，共 2 轮。
- `getComparePacks()`：每场 pack 先查 `streams` 再查 5 张子表，N 场并行仍需 2 轮、6N 条。

`docs/engineering/performance.md` 写「成员页三个查询并行」，与实现不一致。

### 2.3 传输量

- `getGroupGallery()`、`getGroupSummary()` 的 `latestStreams` / `recentStreams` 用 `select()` 取全列，但映射只用到 12 个字段；`/gallery` 的 HTML 已达到 1.65 MB。
- `llms.txt` 用 `listStreams()` 取整行，实际只需要 `videoId` / `title` / `date` / `availability`。
- `stream_details.raw_detail` 从未写入（ingest 不写），每次 `select()` 仍会带上这个 jsonb 列。
- `buildChat()` 只展示前 40 个高频词、前 20 位发言者，但 `loadChildren()` 把该场全部 `stream_words` / `stream_authors` 拉回再 slice。
- `listStreams()` 的 `count(*) over()` 每次都会扫完匹配行；页面调用方并不使用 `total`（只有 `db-query-smoke.ts` 用）。

### 2.4 缓存与失效

- 数据页 `maxAge` 为 60 或 300 秒，但数据只在 ingest 时变，且 `daily-update.ts` 已按 tag purge。TTL 偏短会放大冷渲染。
- `prefetchAll: true` + `hover`：侧栏 5 位成员 × 8 个分区，扫一遍导航会触发多次 SSR。
- `/[datasetId]`、`/[datasetId]/stream/[videoId]` 的 404 不缓存，随机路径每次都查库。
- `compare.astro` 等页面把查询异常 `.catch(() => null)` 成 404，掩盖数据库故障。
- `/api/packs/:dataset/:video` 没有设置 cache tag，ingest 后不会随 purge 失效。
- `wrangler.jsonc` 的 `cross_version_cache: false`，每次部署都从冷缓存开始。

### 2.5 潜在正确性问题

- `computeDatasetPublicTotals()` 与 `getDatasetPageData()` 写死 `limit: 2000`；超过 2,000 场时会静默截断，且 `datasets.stream_count` 仍是全量。
- `getDatasetPublicTotals()` 在缺少 `public_totals` 时回退 `totals`，会员限定场指标会被多算，只打一条 warn。
- `.md` 的 `HEAD` 直接执行 `GET`，爬虫的 HEAD 也会完整查库并读 R2。
- `getStreamNeighbors()` 一次拉全 dataset 的 videoId 再 `findIndex`，当前未被调用；`getStreamDetail()`、`getDatasetInsights()` 也无人引用。

## 3. 目标与验收

### 目标

1. 冷渲染的 SQL 条数与 HTTP 往返数不随成员/场次增长而线性上升。
2. 单场、对比、`.md` 的往返轮次收敛到 2 轮以内；成员页、首页收敛到 1 轮。
3. 列表/相册/LLMS 只取视图实际使用的列；Top 列表在 SQL 里限制行数。
4. 数据更新仍以 tag purge 为唯一失效手段，不靠短 TTL 兜底。
5. 本地可重复测量，数字进入 `docs/engineering/performance.md`。

### 验收标准

| 编号 | 验收项 | 判据 |
| --- | --- | --- |
| AC-DB-1 | 成员页 | SQL ≤ 3，往返 ≤ 1 |
| AC-DB-2 | 单场页 | SQL ≤ 10，往返 ≤ 2 |
| AC-DB-3 | 对比页（3 场） | SQL ≤ 12，往返 ≤ 2 |
| AC-DB-4 | `.md` | SQL ≤ 6，往返 ≤ 2 |
| AC-DB-5 | 首页 | SQL ≤ 5，往返 ≤ 1 |
| AC-DB-6 | 404 路径 | 未命中时 ≤ 1 条查询，并可短缓存 |
| AC-DB-7 | 回归 | `bun run check`、`bun run db:query`、`bun run db:verify` 通过 |
| AC-DB-8 | 压测 | `bun run db:bench` 输出 before/after，p50/p95 与请求数可复现 |

## 4. 方案

### P0：缓存与请求边界（不改查询语义）

- 数据页 TTL 提到 3600 秒、SWR 86400 秒；日历页保持 60 秒（`now` 参与直播状态）。
- `routeRules` 与页面内 `Astro.cache.set` 同步修改，避免两处不一致。
- `prefetchAll` 改为 `false`，给侧栏、成员标签栏与「上一场/下一场」加 `data-astro-prefetch`。
- 动态路由先做一次廉价的 dataset 存在性检查；404 写短 TTL 负缓存。
- 查询失败返回 500，不再 `.catch(() => null)` 成 404。
- `/api/packs` 补 `context.cache.set({ tags: [stream-<id>, dataset-<id>] })`。
- 评估 `cross_version_cache: true`；开启后部署完需主动 purge 一次。

### P1：查询层（主要收益）

- 新增 `runBatch(db, queries)`：Neon HTTP 用 `db.batch()`（一条 HTTP 请求内执行多条语句），本地 `pg` 直连或运行时无 `batch` 时回退 `Promise.all`。
- 合并独立查询：
  - `getDatasetPageData`：datasets + listStreams + publicTotals → 1 轮。
  - `getGroupPageData`：datasets 与 summary/gallery → 1 轮。
  - `getCalendarData`：datasets + 场次 + 日程 → 1 轮。
  - `getStreamPack`：streams + 5 张子表 → 1 批。
  - `.md`：stream + dataset + pack + transcript → 1 批。
  - `sitemap` / `llms`：datasets + 每成员查询 → 1 批。
- 新增 `getStreamPacks(db, datasetId, videoIds)`：用 `inArray` 一次取回多场，供对比页与 `/api` 复用。
- 窄列：相册 / 首页成员流 / LLMS 用显式列；pack 不取 `raw_detail`。
- `stream_words` 取前 40、`stream_authors` 取前 20（按 count/messages 排序）。
- `listStreams` 增加 `withTotal` 选项，页面默认关闭窗口计数。
- 删除未使用的 `getStreamNeighbors`、`getStreamDetail`、`getDatasetInsights`，或改为 SQL 窗口实现后再保留。

### P2：预聚合与索引

- `datasets` 的场次数与 `generatedAt` 改为 ingest 时预计算，读路径不再 `left join streams + group by`。
- 首页 `getGroupSummary` 的 4 次全表扫描合并为 ingest 时写入的 `group_insights` 一行。
- 索引：
  - `scheduled_streams (dataset_id, scheduled_at)`：成员日历按成员过滤。
  - `transcripts (dataset_id, date desc, title)`：逐字稿索引排序。
  - 视压测结果决定是否为 `listStreamRefs` 建覆盖索引。
- 为读查询设置 statement timeout，避免慢查询持续计费。

### P3：数据量增长的兜底

- `listStreams` 的 2,000 上限改为显式分页或游标，禁止静默截断。
- 单场 pack 的 `events` / `ownerChats` 评估按需字段开关（`.md` 与详情页可能只需要部分）。
- 若单表超过 10 万场，再评估按 dataset 分区或把明细移到 R2。

## 5. 本地压测

### 方法

- 用 `bun run dev:db` 准备本地库，`ensureDevServices()` 拉起 Postgres 与 Neon HTTP 代理。
- `bun run db:bench` 通过 `createDb(url, NEON_HTTP_ENDPOINT)` 走与 workerd 相同的 HTTP 驱动，统计：
  - 每个场景的 wall time p50/p95；
  - 代理记录的 SQL 条数；
  - 代理记录的 `/sql` 请求数（往返次数）。
- 同一场景分别测量 `batch` 与 `Promise.all`，确认 batch 只减少往返、不改变结果。
- 结果写入 `docs/engineering/performance.md`，命令与参数一并记录。

### 与线上的差异

- 本机 Postgres 无网络 RTT，Neon 跨区会放大每条请求的固定成本；因此**请求数**比本机毫秒数更能代表线上费用。
- 本地代理逐条串行执行 batch 内的语句，SQL 执行时间与线上接近，但无法复现 Neon 的冷启动与自动扩缩。
- Worker 的 CPU 限制比本机 Bun 更严；压测只覆盖数据库路径，页面级指标仍用 `bun run perf:smoke`。

## 6. 风险

| 风险 | 处理 |
| --- | --- |
| `db.batch` 在 neon-http 是事务语义 | 只用于只读查询；写入仍走 `createWriteDb` |
| 本地 `pg` 无 `batch` | `runBatch` 运行时检测，回退 `Promise.all` |
| 长 TTL 导致旧数据 | ingest 成功后才 purge；部署后补一次 purge |
| prefetch 减少影响导航手感 | 只保留侧栏/标签栏/上下场等高频链接 |
| 索引增加写入成本 | 只加读路径实际使用的组合索引，ingest 每日一次 |

## 7. 执行记录

2026-11-05 完成 P0 与 P1，P2 只做索引，P3 保留。

### 已落地

| 项 | 改动 | 文件 |
| --- | --- | --- |
| batch | `runBatch()` 用 Neon HTTP `db.batch`；本地 `pg` 回退 `Promise.all` | `src/db/batch.ts` |
| 成员页 | datasets + streams + publicTotals = 1 次 HTTP | `src/db/queries/view-data.ts` |
| 首页 / 相册 | datasets + summary / gallery = 1 次 HTTP | `src/db/queries/view-data.ts`、`group.ts` |
| 日历 | datasets + 场次 + 日程 = 1 次 HTTP | `src/db/queries/calendar.ts` |
| 单场 / `.md` | 第一轮元数据 1 次、pack 6 条 1 次；共 2 次 HTTP | `src/db/queries/packs.ts`、`view-data.ts`、页面 |
| 对比 | `getStreamPacks()` 用 `inArray` 批量取；3 场 21 → 9 条 SQL、2 次 HTTP | `src/db/queries/packs.ts` |
| `/api/packs` | 场次 + pack 放进同一 batch，补 cache tag | `src/pages/api/packs/...` |
| sitemap / llms | 全部成员一次取回；6 → 2 条 SQL、1 次 HTTP | `src/pages/sitemap.xml.ts`、`llms.txt.ts` |
| 窄列 | 组相册 / 首页成员流只取 14 列；LLMS 只取标题级字段；pack 不取 `raw_detail` | `group.ts`、`streams.ts`、`packs.ts` |
| Top 限制 | 单场 `stream_words` 前 40、`stream_authors` 前 20 在 SQL 里限制 | `packs.ts` |
| 总数 | `listStreams` 增加 `withTotal`，页面不再做窗口计数 | `streams.ts`、`types/db.ts` |
| 截断 | ingest 汇总按 2,000 分页取全量；页面仍保留上限并记录为后续项 | `dataset-totals.ts` |
| 缓存 | 数据页 3600 / 86400 秒；日历保持 60 / 300；404 负缓存 60 秒 | 页面、`astro.config.mjs` |
| 预取 | `prefetchAll: false`，只给侧栏 / 标签栏加 `data-astro-prefetch` | `astro.config.mjs`、导航组件 |
| 错误态 | 查询失败返回 500，不再伪装成 404 | 成员页、单场页 |
| 索引 | `scheduled_streams(dataset_id, scheduled_at)`、`transcripts(dataset_id, date desc)` | `drizzle/0004_big_satana.sql` |
| 排序稳定 | Top 词 / 作者加次级键（`word` / `authorId`），batch 与单场结果一致 | `packs.ts` |
| 派生数据 | 新增 `scripts/refresh-public-totals.ts`，重算 `dataset_insights.public_totals` | `scripts/refresh-public-totals.ts` |
| 清理 | 删除未使用的 `getStreamNeighbors()`、`getStreamDetail()` | `streams.ts`、`db-query-smoke.ts` |

### 实测

见 [engineering/performance.md](../engineering/performance.md)「数据库读路径」。冷渲染 HTTP 往返：

- 成员页 / 组首页 / 组相册 / 组对比 / 组日历 / `sitemap` / `llms`：1 次。
- 单场页 / `.md` / 对比页 / 逐字稿页：2 次。
- `/api/packs`：1 次。

Top 列表排序稳定化后，`public_totals` 需要随派生口径刷新；本地执行 `bun scripts/refresh-public-totals.ts` 后，`bun run db:verify` 为 1,901 场 / 0 problems。

### 上线步骤

- [x] 目标库执行 `bun run db:migrate` 应用 `drizzle/0004_big_satana.sql`；部署工作流不含迁移步骤。2026-11-05 已对 Neon `neondb` 执行。
- [x] 目标库执行 `bun scripts/refresh-public-totals.ts` 刷新派生汇总（Top 列表排序已稳定化）。2026-11-05 结果：arale 507、miyako 323、nonoka 289、ritsu 342、yuno 443。
- [x] 部署后确认 tag。线上响应头只暴露 `Cf-Cache-Status` / `x-response-time`，`Cache-Tag` 不对外；用构建产物验证：
      `bunx wrangler dev --config dist/server/wrangler.json` 后 `/nonoka` 返回
      `cache-tag: datasets,dataset-nonoka,astro-path:/nonoka`，单场返回
      `streams,stream-jZbWoJ7n54Q,dataset-nonoka,astro-path:...`，`/api/packs` 同样带 `stream-<videoId>`。
      线上首次请求 `MISS`、再次 `HIT`，说明 Workers Cache 生效；首次部署从冷缓存开始。
- 部署路径：GitHub `Deploy` workflow 因仓库缺少 `CLOUDFLARE_API_TOKEN` secret 在「Check configuration」失败；本次用本地 `bun run cf:deploy` 发布（version `86f395ec`）。补上 secret 后可继续走 workflow。
- [ ] 2026-11-06 新增 `drizzle/0005_magical_diamondback.sql`（`streams.paid_share_pct`）。目标库需先 `bun run db:migrate`，再跑 `bun scripts/refresh-public-totals.ts`；之后新 ingest 会自然写入精确付费占比。

### 未做

- `datasets.stream_count` 与组首页 summary 仍未在 ingest 预聚合；当前 5 个成员、1,901 场，收益不足以覆盖 schema 与回流成本。
- 成员页仍一次取回全部场次（上限 2,000），超过后需要服务端分页或按路由裁剪 props。
- 未开启 `cross_version_cache`：每次部署仍冷缓存一次，避免旧 HTML 引用已下线的哈希资源。
- 全量弹幕（B6）未入库。

## 8. 脚本层增量（2026-11-06）

P0 / P1 只覆盖请求期读路径；每日任务与离线脚本仍有重复读写。本轮按实测日志补齐：

| 项 | 改动 | 文件 |
| --- | --- | --- |
| 成员状态 | 所有成员的 `streams` / `dataset_insights` 合并为 2 条 SQL，Neon 下 1 次 HTTP；不再每成员各查 2 条 | `scripts/daily-update.ts` |
| 逐字稿写入 | 先读 `transcripts.content_hash`，内容未变直接跳过；不再每次 upsert 全部稿件并刷新 `updated_at` | `scripts/ingest-db.ts` |
| insights 过期判断 | 场次数改成标量子查询，与 `totals` / `public_totals` 一次取回；每成员少 1 条查询 | `scripts/ingest-db.ts` |
| 公开汇总 | `computeDatasetPublicTotals()` 改为窄 SQL：`streams` 只取汇总列；词频 / 作者在 SQL 里 `sum + group by`；评论 / 贴纸按场聚合；`stream_details` 只取 badges / hashtags / emojiKinds / `density->'perMinute'`。不再还原 pack | `src/db/queries/dataset-totals.ts` |
| 付费占比 | 新增 `streams.paid_share_pct`，ingest 直接写入；单场 pack 与汇总复用精确值，旧行没有值时按每分钟序列近似 | `src/db/schema.ts`、`scripts/ingest-db.ts`、`src/db/queries/packs.ts`、`drizzle/0005_magical_diamondback.sql` |
| 日程同步 | 未来场从逐条 upsert 改成一次多行 upsert；缺时刻时仍用 `coalesce` 保留旧值 | `scripts/lib/schedule-sync.ts` |
| 对账 | 只取对账所需 5 列；4 条 group by 放进同一 `runBatch`，Neon 下 1 次 HTTP | `scripts/verify-db.ts` |
| 逐字稿发布 | 文件内容不变时复用上次 `contentUpdatedAt`，不再因 CI checkout 改 mtime 而全量重传；索引 `generatedAt` 取条目最新时间，内容不变时索引也不变 | `scripts/publish-transcripts.ts`、`scripts/lib/publish-state.ts` |

验证：

- `bun run check`：astro check 0 error、323 tests 通过、oxlint 0 warning。
- 用本地 pack 的全量 `aggregateDataset()` 与新 SQL 汇总逐字段比较：除 `topWords` 的低频词尾差外全部一致；`paidSharePct` 由新列恢复为精确值。
- 本地库执行 `bun run db:migrate`（`0005_magical_diamondback.sql`）并用 `bun scripts/refresh-public-totals.ts` 刷新；arale / miyako / nonoka / ritsu 的 `bun run db:verify` 均为 0 problems。线上库需在部署前应用同一迁移并刷新一次。

仍保留的成本：

- 任一 pack 变化仍会触发该成员的全量 insights 重算，但现在只读汇总列与 SQL 聚合结果，不再拉 3.5–10.5 MB 的完整明细；`totals` 仍从本地 pack 全量聚合一次。
- `topWords` 与本地全量聚合存在极小尾差：ingest 只把 `count >= 3` 且非停用词的词写入 `stream_words`，低频词跨场累计后的贡献无法从库里还原。
- `daily-update` 仍按成员分别 spawn `ingest-db` / `publish-data`；两份脚本各自 parse 一遍本地 pack 是进程隔离的代价，本轮不合并。
