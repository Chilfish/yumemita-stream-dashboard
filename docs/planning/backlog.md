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
- [x] 内容类型 × 指标：趋势页对比弹唱 / 活动 / 杂谈 / 游戏的场次、时长、弹幕/分、SC/小时。
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
