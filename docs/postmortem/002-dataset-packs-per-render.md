---
编号: 002
主题: 每次渲染 dataset 页面都全量拉取明细，Neon 网络出流量异常增长
日期: 2026-11-05
严重级别: SEV-3
分类: 架构
状态: Mitigated
根因归类: 设计建模
---

# 002 — 每次渲染 dataset 页面都全量拉取明细，Neon 网络出流量异常增长

## 摘要

`getDatasetPageData()` 为了让公开页面按「排除会员限定」的口径展示汇总，在 `resolveTotals()` 里调用 `getDatasetPacks()`，把该 dataset 全部场次的 `stream_details`、comments、paid_events、stream_words、stream_authors 整份读进 Worker 再聚合。每次冷渲染约 3.5–10.5 MB。上线 4 天 Neon Network transfer 到 4.5 GB，正好对应约 500 次冷渲染。修复方式是把「公开场次汇总」在 `db:ingest` 时算好存进 `dataset_insights.public_totals`，页面只读一行 JSON。

## 影响

- Neon 网络出流量：2026-11-01 至 2026-11-05 约 4.5 GB，开发期自用流量占主要部分。
- 单次冷渲染的数据库出流量按 dataset 实测：arale 9.2 MB、miyako 10.3 MB、nonoka 3.5 MB、ritsu 10.5 MB、yuno 9.6 MB；页面汇总 JSON 本身只有 15–22 KB。
- 全部 1,904 个单场 URL 各自冷启动一次约 19 GB；4.5 GB 说明只被消费了约 1/4。
- 修复后单页数据库出流量约 0.2–0.4 MB（列表行 + 15–22 KB 汇总 JSON）。
- 顺带暴露数据陈旧问题：`dataset_insights.totals` 在 miyako / ritsu 里仍混着会员限定场的指标（分别多 49,588 / 34,341 条弹幕），说明上次 insights 重算早于 availability 更新；重新 ingest 后修正。

## 时间线

| 日期 / commit | 事件 |
| --- | --- |
| 2026-11-04 | Astro SSR 上线，`resolveTotals` 选择「从 pack 重算」以排除会员限定 |
| 2026-11-05 | 发现 Neon Network transfer 4 天 4.5 GB、History 100.56 MB |
| 2026-11-05 | 用 `pg_column_size` 逐 dataset 量化明细体积，确认瓶颈在 `getDatasetPacks` 的查询粒度 |
| 2026-11-05 | 增加 `public_totals`，页面改读预聚合；回填 5 个 dataset，与改造前基线逐字段对比 |

## 根因分析（blameless）

1. 页面当时的注释认为 `dataset_insights.totals` 含会员限定指标，实际 `aggregateDataset` 已按公开场次聚合；由于没有校验预聚合是否可信，页面选择在请求期从数据库重算。
2. 为了不改数据模型，选择了「查询时重算」；重算函数复用了单场 pack 的还原逻辑，而 pack 是为单场详情设计的完整结构，不是为汇总设计的窄投影。
3. `getDatasetPacks` 用 `select()` 全列读取，`loadChildren` 又把每场的全部评论、SC、词、作者都取回；聚合实际只需要 Top 列表、计数与币种汇总。
4. insights 重算只在 pack 内容变化时触发；availability 在库内更新后不会触发，导致 miyako / ritsu 的 `totals` 陈旧（混入会员限定指标），进一步加深了「不能直接信任预聚合」的判断。
5. 这条路径同时被 7 类路由复用（含每条单场页），缓存键按 URL 区分，冷启动成本被放大。
6. 缺少「一次页面渲染从数据库读了多少字节」的观测，账单成为唯一的反馈渠道。

## 触发条件

任何一次未命中 Workers Cache 的 dataset 页面渲染，包括：`astro dev` 的每次刷新、`prefetchAll` 悬停预取、smoke test、爬虫首次访问单场页。

## 检测

Neon 账单页的 Network transfer 突然到 4.5 GB 才被发现。检测盲区：没有按路由记录数据库出流量，也没有针对「页面汇总查询」的体积断言。

## 处置

- `dataset_insights` 新增 `public_totals`（jsonb），`db:ingest` 同时写入全量与公开口径。
- `db:ingest` 用现有的 `aggregateDataset()`（派生指标本来就只累加公开场次）生成 `public_totals`，与旧页面口径逐字段一致。
- `resolveTotals()` 改为一行查询；`getDatasetPacks()` 只保留给 ingest 离线重算，页面不再调用。
- 回填后与改造前基线逐字段对比：3 个 dataset 0 diff；miyako / ritsu 只差在重新 ingest 的 4 场（重复弹幕修正）。
- 本地开发改为本机 Postgres（`bun run dev:db` + `dev:db:proxy`），不再让开发流量计入 Neon。
- `sitemap.xml` 改读只含 `videoId` / `startedAt` / `availability` 的窄查询。
- `verify-db` 增加 `public_totals` 与重算结果的对比，防止预聚合漂移。

## 做得对的地方

- pack 可由本地文件重建，问题可复现、可对账。
- `group.ts` 已经示范了「SQL 聚合、只返回小结果」的写法，本次修复沿用同一模式。
- 修复前先量化了每个 dataset 的明细体积，避免凭感觉优化。

## 行动项

### 缓解（针对已发生的具体缺口）

- [x] `dataset_insights.public_totals` 写入与读取（维护者）
- [x] `resolveTotals()` 改读预聚合，删除 `getDatasetPacks()`（维护者）
- [x] 回填 5 个 dataset 并对比旧口径（维护者）

### 预防（针对整类问题）

- [x] `verify-db` 校验 `public_totals`，故意改坏应报错
- [x] sitemap 使用窄查询，不再拉整行
- [x] 本地开发默认本机 Postgres，见 [local-database.md](../engineering/local-database.md)
- [ ] 给页面查询加「结果字节数」上界断言（P2）
- [ ] 把 Neon 网络出流量加入发布检查，异常增长时排查（P2）

## 教训

页面汇总不要复用单场详情的数据结构：为汇总单独设计窄查询或预聚合，并在写码前估算一次渲染从数据库读多少字节。

## Changed Files

```text
src/db/schema.ts
src/db/connection.ts
src/db/client.ts
src/db/queries/insights.ts
src/db/queries/dataset-totals.ts
src/db/queries/packs.ts
src/db/queries/streams.ts
src/db/queries/view-data.ts
src/pages/sitemap.xml.ts
astro.config.mjs
package.json
scripts/ingest-db.ts
scripts/verify-db.ts
scripts/db-migrate.ts
scripts/dev-db.ts
scripts/dev-db-proxy.ts
scripts/lib/env.ts
drizzle/0003_peaceful_zaran.sql
drizzle/meta/_journal.json
.env.example
docs/data/data-model.md
docs/engineering/development.md
docs/engineering/local-database.md
docs/engineering/README.md
docs/README.md
docs/planning/backlog.md
docs/postmortem/README.md
docs/postmortem/002-dataset-packs-per-render.md
docs/development-log/2026-11-05.md
AGENTS.md
README.md
```

## 关联报告

- [001](./001-yt-dlp-chat-duplicate.md)：同一天发现的另一处「数据口径与实现不一致」
