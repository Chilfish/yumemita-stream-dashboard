# 任务清单（Backlog）

> 未决任务与阶段计划索引。已完成的路线图条目保留在下方作为历史；未完成项按优先级排列。
> 方向与验收标准见 [product-direction.md](product-direction.md)。

## 候选（未排期）

| 编号 | 任务 | 优先级 | 前置条件 | 来源 | 状态 |
| --- | --- | --- | --- | --- | --- |
| B1 | Astro + PostgreSQL + Workers SSR 迁移（`FR-ARCH-001`） | P1 | 方案评审通过；Neon / R2 / Workers 账号 | 迁移 | ✅ 已合并到 `main`，部署在 `ymmt.chilfish.top`；R2 为 `yumemita-data` |
| B2 | 单场 `.md` Agent 路由（`FR-AGENT-001`） | P2 | B1 的数据库查询层 | 迁移 | ✅ 已实现 |
| B3 | 数据更新后的缓存失效与静态 SEO 刷新（`FR-DATA-004`） | P1 | 缓存 purge 端点 | 已知缺口 | ✅ purge 端点与每日自动 purge 已实现；线上 401 / 200 与失效后回源已实测 |
| B4 | 跨成员对比（`FR-COMPARE-002`） | P2 | 统一场次/时间段口径 | roadmap | ✅ 已实现：组级 `/compare`，按最新数据月份 × 内容类型对比；`?members=&type=&months=` 可分享 |
| B5 | 观众重叠页面（`authors.json` 已有数据） | P2 | 确认重叠算法与最小样本 | roadmap | 📋 |
| B6 | 全量弹幕入库与检索 | P2 | B1；`chat_events` 分区方案 | 迁移 | 📋 |
| B7 | 评论增长快照 / 多次抓取对比 | P3 | 抓取侧支持重复快照 | roadmap | 📋 |
| B8 | IndexNow / sitemap 主动通知 | P3 | B3 | SEO | 📋 |
| B9 | 200% 缩放复核（320px 已通过） | P3 | 无 | roadmap | 📋 |
| B10 | 逐字稿索引与「这场有没有稿」改由数据库查询 + SSR（`FR-TRANSCRIPT-001`） | P2 | `transcripts` 元数据 ingest | 迁移 | ✅ 已实现 |
| B11 | 开播前 / 直播中弹幕采集（InnerTube live chat，补齐 yt-dlp 只能拿回放的空档） | P2 | 无 | 2026-11-04 需求 | 🚧 实时采集、已结束场次自动回放（`fetch:live-chat` / `fetch:danmaku --video`）与合并已实现；每日任务尚未自动接入实时采集 |
| B12 | 弹幕与事件可视化组件（POC `/dev/live-chat`） | P2 | B6 或 R2 `danmaku_*.jsonl` 读取方案 | 2026-11-04 需求 | 🚧 POC 完成；数据源、组件化与正式入口待做 |
| B13 | 组首页成员活跃：近 100 天出勤、成员榜指标切换、近 20 场趋势 | P2 | 无（复用 group summary） | 2026-11-04 讨论 | ✅ 已实现（`FR-HOME-002`）；复用 group summary，无新增查询 |
| B14 | 直播日历：未来场次、手工日程与月历视图（`FR-CAL-001`–`FR-CAL-012`） | P2 | 无（新表 `scheduled_streams`） | 2026-11-04 需求 | ✅ 读取、月历 / 议程、自动同步、缓存、管理端写入、读取时关联与今天+明天时间线已实现；ICS 暂缓。方案见 [live-calendar.md](live-calendar.md)，接口见 [schedule-admin.md](../engineering/schedule-admin.md) |
| B15 | yt-dlp 字幕的直播段 + 回放段重复：`normalizeLiveChat` 按 `rendererId` 去重 | P1 | 无 | 2026-11-05 反馈 | ✅ `normalizeLiveChat` 去重 + `duplicates` 计数 + 单测；`fmjJNbzcr3g` 已重新生成（32,343 → 22,058）；见 [postmortem 001](../postmortem/001-yt-dlp-chat-duplicate.md) |
| B16 | 页面汇总改为读 `dataset_insights.public_totals`，不再每次渲染拉整库明细 | P0 | `db:ingest` 重算 insights | 2026-11-05 Neon 账单 | ✅ 单页数据库出流量 3.5–10.5 MB → 约 0.2–0.4 MB；见 [postmortem 002](../postmortem/002-dataset-packs-per-render.md) |
| B17 | 本地开发数据库：Scoop Postgres + Neon HTTP 代理 + 初始化脚本 | P1 | 无 | 2026-11-05 成本控制 | ✅ `bun run dev` 一条命令拉起 Postgres / 库 / 代理；Astro 退出后服务继续后台运行。`dev:db` / `dev:db:proxy` / `dev:seed` 保留；见 [local-database.md](../engineering/local-database.md) |
| B18 | 数据库读路径优化：合并查询、窄列、缓存 TTL 与本地压测 | P0 | 本地库 | 2026-11-05 成本控制 | ✅ 冷渲染 HTTP 往返压到 ≤2（多数 1 次）；`bun run db:bench` 可复测；见 [db-optimization.md](db-optimization.md) |
| B19 | 全栈性能审计：岛屿拆分、props 收敛、对比页窄查询、交互热点与 ingest / publish 批量化 | P1 | 无 | 2026-11-05 巡检 | 🚧 P0 大部分落地：逐字稿 DEV 守卫（会员稿不再进 client chunk）、列表窄列、对比页密度 API、单场页取数收敛、搜索防抖、context memo、图表 hover 节流。客户端 JS 1.52 → 0.98 MB，单场页 HTML 696 → 281 KB，对比页 3 场 9 → 4 SQL。剩余：props 收敛、壳层重构；见 [performance-audit.md](performance-audit.md) 与 [performance.md](../engineering/performance.md) |
| B20 | 脚本层重复读写：成员状态批量查询、逐字稿按 hash 跳过、公开汇总窄 SQL、日程批量 upsert、对账 batch、逐字稿发布稳定 mtime | P1 | 无 | 2026-11-06 实测日志 | ✅ `daily-update` 状态 2N → 2 SQL；`syncTranscripts` 未变跳过；`computeDatasetPublicTotals` 改窄 SQL（词/作者 `sum + group by`，不再还原 pack）；新增 `streams.paid_share_pct`；日程与对账各 1 次 batch；逐字稿不再每天全量重传。任一 pack 变化仍会全量重算该成员 insights，见 [db-optimization.md](db-optimization.md) §8 |
| B21 | 全本地开发开关：`LOCAL=1` 同时切数据库、对象存储与媒体地址 | P1 | 安装 PostgreSQL、[SILO](https://silo.pgsty.com/zh/download/#server-windows) | 2026-11-06 成本控制 | ✅ 脚本与 dev 共用 `LOCAL=1`；数据库走本机 Postgres + `/sql` 代理，对象存储走 SILO，`PUBLIC_R2_BASE` 指向本地桶，发布进度按 `local/` 隔离，purge 跳过；见 [local-database.md](../engineering/local-database.md) |
| B22 | `~/yt-cookies.txt` 长期复用后失效：yt-dlp 撞 bot 检查，`--cookies-from-browser` 却正常 | P1 | 无 | 2026-11-07 yt-dlp 反馈 | ✅ 每次运行从浏览器重新导出，导出失败才退回旧缓存；移除 `--refresh-cookies`；`--no-cookies` 不再回退浏览器 cookie。见 [开发日志](../development-log/2026-11-07.md) 与 [postmortem 003](../postmortem/003-stale-yt-cookies-cache.md) |
| B23 | 本地最新数据一键同步线上 | P1 | `.dev.vars` 线上目标 | 2026-11-06 同步需求 | ✅ `bun run sync:remote` 只读 `.dev.vars` 的 `DATABASE_URL_ONLINE` / `R2_*`、强制 `LOCAL=0`；默认只新增（查线上 videoId，窗口最近 7 天开播），`--update-existing` 才刷新旧场次；`daily-update` 把 new/force ID 直接传给 ingest / publish；见 [adding-data.md](../data/adding-data.md) |
| B24 | 脚本启动时先打印目标环境（本地 / 线上、数据库、存储桶） | P3 | 无 | 2026-11-06 使用反馈 | ✅ `describeEnvironment()` 统一输出，`loadEnvFiles()` 与 publish / fetch / verify 入口共用；不用等跑完才看到地址。见 [scripts/README.md](../../scripts/README.md)「运行环境提示」 |
| B25 | 日程管理端：宽容时间输入、编辑页组件拆分、移动端列表、直播链接只保留单输入 | P3 | 无 | 2026-11-07 反馈 | ✅ `TimeInput` + `src/lib/time.ts`；`schedule-editor` 拆成容器 / 表单 / 列表 / 表单状态；`md` 以下改堆叠列表；直播链接去掉 `videoId` 输入，`url` 只作外链。见 [time-input.md](../ui-design/time-input.md) 与 [GENERAL.md](../ui-design/GENERAL.md) §7 |

## 审查承接区

> 来自 `docs/reviews/` 的问题按 Z（安全/授权）/ R（资源）/ E（工程）/ U（UI）编号登记，承接时新建阶段方案。

| # | 问题 | 优先级 | 状态 |
| --- | --- | --- | --- |
| （暂无） | | | |

## 近期（下一步）

> 以下为旧路线图，保留历史与已完成项；新任务以「候选（未排期）」为准。

1. [x] **封面图**：`fetch:thumbs` 镜像 `video.thumbnail`，发布到对象存储，单场页、首页与相册展示；缺图走成员色兜底。
2. [x] **相册页（成员）**：`/:datasetId/gallery`，按 JST 自然月分组、懒加载、`?order=` 可分享。
3. [x] **逐字稿**：`content/transcripts/` 手动维护，`publish:transcripts` 发布后运行时渲染；时间戳跳 YouTube。
4. [x] **全组相册**：`/gallery` 跨成员封面墙，`?member=` / `?type=` 筛选写进 URL。
5. [x] **组首页**：`/` 首屏回答「最近谁播了」，含近 7 天 / 本月脉冲、全组焦点场、最近更新与成员入口。
6. [x] **跨成员对比**：组级 `/compare` 按月份区间 + 内容类型横向对比，筛选写进 URL。
7. [x] **精确词频 / 发言者**：datapack v2 追加全量 `wordCounts` / `authors`，发布时精确聚合并标注口径；v1 场次逐场回退。已支持 `full` / `partial` 覆盖率。

## 数据

- [x] 五位成员的全频道历史场次：合计 **1897 场**（2023-11-18 – 2026-10-29），已全部投影到数据库并通过 `db:verify`，见 [data-progress.md](../data/data-progress.md)。
- [x] 补齐其他成员（`data/<id>/` + `data-sources.json`，不需要改组件）：nonoka 288、arale 506、ritsu 340、miyako 322、yuno 441。
- [x] 内容标签：`src/lib/classify.ts` 标题规则，首页「内容构成」已使用。
- [x] 精确词频 / 发言者：v2 pack 已带全量字段；已重建的场次 `insights` 为精确值，未重建的按 `partial` 标注覆盖率。
- [ ] 同接时间序列：VSTATS 只给平均/最大；若以后有采样源，可加曲线。
- [ ] 评论增长快照：同一场多次抓取，观察评论随时间的变化。
- [x] 与其他成员的横向对比：同一时间段、同一内容类型的同接/弹幕/付费（组级 `/compare`）。

## 分析

- [x] 趋势页：场次频率、弹幕/分、SC 的月度趋势与明细表；典型节奏曲线、全期高频词/发言者已从首页移入趋势页。
- [x] 内容类型 × 指标：趋势页对比歌枠 / 活动 / 杂谈 / 游戏的场次、时长、弹幕/分、SC/小时。
- [ ] SC 留言主题：简单关键词/共现，不引入重型 NLP。
- [ ] 观众重叠：`authors.json`（作者 → 场次索引）已由发布生成，尚缺重叠计算与页面。
- [ ] 峰值解释：把峰值分钟与人工标注的事件（抽卡、公布、读 SC）对齐。

## 体验

- [x] URL 状态：`/:datasetId/stream/:videoId?view=`，单场、子视图与对比选择可分享、可前进后退。
- [x] 侧边栏导航（可折叠）+ 移动端底部标签栏与成员 Sheet。
- [x] 数据表筛选写 URL：`q` / `type` / `sort` / `dir` / `vstats` 随路由保存。
- [x] 复制深链：单场与对比页的「复制链接」按钮。
- [x] 图表导出 PNG/SVG：ChartCard 右上角导出当前 SVG，PNG 为 2× 画布。
- [x] 更新日历：按 JST 自然日查看场次 / 弹幕 / SC 热度，支持指标切换。
- [x] 趋势页：月度趋势、月度明细、内容类型对比、典型节奏曲线、社群榜单。
- [x] 趋势页表格：按月/按类型可排序、指标环比列、全期合计行、占比色条、窄屏面板内滚动并吸附首列。
- [x] 首页层级：规模指标条 → 最近一场 + 本月 → 最近场次 → 更新日历；修复页面横向溢出（`min-w-0` + 图表行内尺寸隔离）。
- [x] 键盘快捷键：`j` / `k` 翻场、`1`–`5` 切页、`/` 搜索、`⌘K` 全局搜索、`⌘B` 侧栏。
- [x] 移动端优化：390 / 320px 无横向溢出，表格自身横向滚动，首列吸附。
- [x] 封面图：镜像 `video.thumbnail` 到对象存储，单场页 / 首页 / 相册展示，含成员色兜底。
- [x] 相册页（成员）：`/:datasetId/gallery`，按 JST 自然月分组、懒加载、`?order=` 可分享。
- [x] 逐字稿：`content/transcripts/` 手动维护，发布后运行时渲染，支持时间戳跳转与目录。
- [x] 全组相册与组首页：跨成员封面墙、全组脉搏。
- [x] 跨成员对比：组级 `/compare`，同一时间段 / 内容类型的横向对比。
- [ ] 推文联动：先用手动 pin 验证价值，外部服务只做增强。
- [ ] 空数据 / 部分数据的更明确提示（已有基础版）。

## 工程

- [x] 用 valibot 做运行时 schema 校验：`scripts/validate-schema.ts` 校验 index / manifest / insights / datapack。
- [x] 数据 schema 版本迁移：v1 / v2 并存，按场次混合；`insights.totals.aggregation` 标注口径与覆盖率。
- [x] 按路由 `React.lazy()` 拆包，降低首屏 JS。
- [x] 路由错误边界：根路由与 `:datasetId` 的 `errorElement`。
- [x] agent-browser 冒烟测试：首页、单场深链刷新、无效 id、对比深链、趋势深链、前进后退。
- [x] 可访问性审计：首页 / 场次 / 单场 / 对比（桌面 + 移动）axe 0 violations。
- [x] 定时增量更新：`.github/workflows/data.yml` 每天 14:17 JST 先做数据库差集，只抓有变化的成员；安静日不恢复、不发布。`--force` 重抓最近 24 小时，`bun scripts/daily-update.ts` 本地手动同款。
- [x] 数据更新后缓存失效：`ingest` 完成后调用 Worker 的 purge 端点，不再触发前端构建；方案见 [astro-ssr-migration.md](astro-ssr-migration.md)。
- [x] Astro + PostgreSQL + Workers SSR 迁移：单场页请求期 SSR，`.md` 路由供 Agent 读取；全量场次已入库并部署在 `ymmt.chilfish.top`，方案见 [astro-ssr-migration.md](astro-ssr-migration.md)。
- [x] `ObjectStore` 支持二进制上传与 `Content-Type`；缓存头交给桶侧规则（Bun S3 写接口不支持自定义 Cache-Control）。
- [x] `fetch:thumbs` / `publish:transcripts` 脚本：增量、可续跑、单条失败不阻塞。
- [x] 逐字稿脚本：`transcript:new` / `transcript:import` 从模板或已有 Markdown 生成。
- [ ] 200% 缩放复核（320px 已通过）。
- [x] 会员限定场次元数据公开：列表、相册、场次 / 日期统计保留会限场；弹幕、SC、同接、评论等派生指标清零 / 置空，聚合、图表与 CSV 剔除。成员首页与组首页大图只选公开场次；组级 `/compare` 只聚合公开场次；单场未解锁时复用详情页模板展示元数据与说明；`.md` 与 `/api/*` 仍按访问参数放行。
- [x] 成员页「说明」统一为组级 `/about`：`/<datasetId>/about` 302 跳转，组侧栏与 sitemap 同步。

## 非目标

- 不做实时看板 / 直播中展示；归档侧可用 `fetch:live-chat` 采集等待室与直播中弹幕，页面仍只读已入库场次。
- 不做用户系统、评论、收藏。
- 不做内容正文的翻译或字幕编辑（那是归档 pipeline 的职责）。
- 不做逐字稿编辑器 / CMS（独立项目，见 [product-direction.md](product-direction.md) §6.5）。

## 质量门槛

每个任务交付前必须通过（见 [engineering/git-workflow.md](../engineering/git-workflow.md)）：

```bash
bun run check
bun run build
bun run validate:data   # 改 pack / 数据时
bun run db:verify       # 改 ingest / 数据时
bun run db:query        # 改查询层时
bun run test:smoke      # 改路由时，先启动 preview
```

- 涉及页面的改动必须手工走查并记录路径与结果。
- 未执行的检查标注「未验证」，不能把构建通过当作功能已验证。
- 不接受已知红灯作为基线；先修或移除再合并。
