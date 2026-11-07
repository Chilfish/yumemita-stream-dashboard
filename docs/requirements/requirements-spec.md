# 需求规格说明（PRD）

> 本文件是项目需求真相源。变更时同步更新 [README.md](../README.md) 索引，并在文末「变更记录」追加一行。
> 当前实现是 Astro 7 + Cloudflare Workers SSR + PostgreSQL + R2，部署在 `ymmt.chilfish.top`；未实现的能力标 `📋` 或 `🚧`。

## 产品定位

记录夢限大みゅーたいぷ 五位成员已结束的直播，提供三类内容：

| 层 | 内容 | 回答的问题 |
| --- | --- | --- |
| 读数 | 指标、趋势、对比、词频 | 这场、这个人表现如何？ |
| 回看 | 封面、逐字稿、峰值与留言 | 这场发生了什么？ |
| 归属 | 相册、组首页、成员色 | 这是谁的站？ |

目标用户是想按成员、场次和趋势回看直播数据的观众，以及需要稳定结构化数据做分析的维护者。站点是非官方项目，内容版权归各权利人，见 [NOTICE.md](../../NOTICE.md)。

## 范围

**做：**

- 组首页：近 7 天 / 本月脉冲、全组最新一场、最近更新、成员入口
- 成员页：规模指标、最近一场、本月变化、更新日历、内容构成
- 日历：全组与成员月历 / 议程，展示未来场次与状态；手工日程与每日自动同步
- 场次页：搜索、内容类型筛选、排序、CSV 导出、URL 状态
- 单场页：概览、时间轴、弹幕与词、付费、评论、逐字稿
- 趋势页：月度趋势与明细、内容类型对比、典型节奏曲线、全期高频词与发言者
- 相册：成员相册、全组相册、按 JST 自然月分组
- 对比：同一成员内最多 4 场；组级「全员对比」按月份 + 内容类型横向比较
- 逐字稿：手写 Markdown，发布后在单场页与索引页渲染
- 数据链路：本地 pack → PostgreSQL（`db:ingest`）；封面 / 表情 / archive / 逐字稿正文 → R2；每日增量抓取与发布
- SEO：真实路径、每页请求期输出 title / description / canonical / OG、sitemap、robots
- 主题、快捷键、移动端底部标签栏
- 运行形态：Astro 7 + Cloudflare Workers + PostgreSQL + R2，数据页请求期 SSR，`.md` 路由供 Agent 读取

**不做：**

- 实时看板 / 直播中数据（日历只显示预定与状态标记，不展示直播中指标；归档侧可用 `fetch:live-chat` 采集等待室与直播中弹幕，页面仍只读已入库场次）
- 用户系统、评论发布、收藏
- 逐字稿在线编辑器 / CMS（独立项目）
- 内容正文的翻译或字幕编辑（归档 pipeline 职责）
- 全站排行榜、跨站聚合
- 第一版把 691 万条原始弹幕全部入库

## 功能需求

| FR ID | 优先级 | 描述 | 验收标准 | 状态 | 来源 |
| --- | --- | --- | --- | --- | --- |
| `FR-HOME-001` | P0 | 组首页回答「最近谁播了」 | `AC-HOME-001`：`/` 展示近 7 天 / 本月脉冲、最新一场、最近更新与成员入口；单个成员加载失败不阻塞其余成员（手工） | ✅ | README / product-direction |
| `FR-HOME-002` | P2 | 组首页展示成员出勤、成员对比与近 20 场趋势 | `AC-HOME-002`：`/` 展示近 100 天出勤日历（JST，按周分列、周一在上、每 4 周日期标签，颜色深浅 = 当天场次；窄屏按成员换行）、可切换场次 / 时长 / 弹幕 / SC / 平均同接的成员榜；最近更新可展开到 20 条并显示每分钟弹幕趋势；空值显示「—」；复用已加载的 group summary，不新增请求（单测 + 手工） | ✅ | 2026-11-04 讨论 |
| `FR-MEMBER-001` | P0 | 成员首页提供近况与规模 | `AC-MEMBER-001`：`/:datasetId` 展示规模指标、最近一场、本月变化、更新日历；数据缺失时显示「—」或空状态（手工） | ✅ | README |
| `FR-CAL-001` | P2 | 提供全组与成员日历页 | `AC-CAL-001`：`/calendar` 与 `/{datasetId}/calendar` 可访问；`?month=` / `?day=` / `?members=` / `?view=` 可分享并保持状态（手工） | ✅ | 2026-11-04 需求 |
| `FR-CAL-002` | P2 | 展示未来场次与派生状态 | `AC-CAL-002`：未来场次来自 `scheduled_streams`；状态按 `now` 派生为预定 / 直播中 / 已结束 / 已取消 / 待补录；同 `video_id` 命中 `streams` 时显示已结束；不往 `streams` 写占位行（单测 + 手工） | ✅ | 2026-11-04 需求 |
| `FR-CAL-003` | P2 | 手工维护日程 | `AC-CAL-003`：`/admin/schedule` 与 `/api/admin/schedule` 可新增 / 编辑 / 取消 / 删除手工日程；标题可省略；重复提交同一自然键幂等；非法输入返回 400 与字段名（接口 + 手工） | ✅ | 2026-11-04 需求；2026-11-07 改为管理端 |
| `FR-CAL-010` | P2 | 管理端鉴权 | `AC-CAL-010`：未认证时页面 401 + Basic 挑战、接口 401 JSON；页面登录后 Cookie 维持；Agent 可直接带 Basic 头；写操作带 `Origin` 时校验同源（接口） | ✅ | 2026-11-07 需求 |
| `FR-CAL-011` | P2 | 今日直播计划 | `AC-CAL-011`：组首页与日历页显示今天 + 明天（JST）的日程 / 场次，跨天朝活归到「明天」；状态每 60 秒重算；空态说明没有排播；标题可空时显示「待定」（手工） | ✅ | 2026-11-07 需求 |
| `FR-CAL-013` | P2 | 日程分享卡片 | `AC-CAL-013`：时间线右上角分享按钮用 React + Tailwind 渲染独立卡片，并由 modern-screenshot 导出 PNG；使用官方背景、成员头像与内容类型图标；可下载、复制（手工） | ✅ | 2026-11-07 需求 |
| `FR-CAL-012` | P2 | 手工日程与真实场次关联 | `AC-CAL-012`：读取时按成员 + JST 日期 + 时段匹配 `streams`；跨午夜晚场归一；同日同时段取最近；命中后隐藏手工行并链到单场页；无匹配保持待补录（单测） | ✅ | 2026-11-07 需求 |
| `FR-CAL-004` | P2 | 每日任务自动同步未来场 | `AC-CAL-004`：`daily-update` 把 `is_upcoming` 场次 upsert 为 `source='youtube'`；重跑幂等；同步后 purge `schedule` tag（脚本 + 手工） | 🚧 已接入，未在真实频道验证 | 2026-11-04 需求 |
| `FR-CAL-005` | P2 | 月历与议程视图 | `AC-CAL-005`：桌面月网格列出当天全部场次，格子随内容长高；移动默认议程；今天、选中日、非本月日期区分明确；390 / 320px 无横向溢出（手工） | ✅ | 2026-11-04 需求 |
| `FR-CAL-006` | P2 | 会员限定日程展示 | `AC-CAL-006`：会限场次显示标题、时间、成员与锁标记；不显示派生指标；锁标记有可访问名称（手工） | ✅ | 2026-11-04 需求 |
| `FR-CAL-007` | P3 | 日历与现有页面联动 | `AC-CAL-007`：组首页显示本周剩余场次并可跳转；成员首页与场次页有「接下来」入口；搜索面板可找到日历页（手工） | 🚧 侧栏与搜索面板已接 | 2026-11-04 需求 |
| `FR-CAL-008` | P2 | 日历缓存与失效 | `AC-CAL-008`：两个日历路由 `maxAge: 60, swr: 300`；tag 含 `schedule`；日程同步与每日任务完成后 purge（手工 + 线上） | ✅ | 2026-11-04 需求 |
| `FR-CAL-009` | P3 | 日历 ICS 订阅 | `AC-CAL-009`：`/calendar.ics` 与 `/{datasetId}/calendar.ics` 返回 `text/calendar`；只含未来 90 天且未取消的事件；会限事件标题前缀 `[会限]`（手工） | 📋 | 2026-11-04 需求 |
| `FR-STREAM-001` | P0 | 场次列表可搜索、筛选、排序、导出 | `AC-STREAM-001`：`q` / `type` / `sort` / `dir` / `vstats` 写入 URL；刷新与前进后退保持状态；可导出 CSV（手工） | ✅ | README / architecture |
| `FR-STREAM-002` | P0 | 单场页提供分段详情 | `AC-STREAM-002`：概览、时间轴、弹幕与词、付费、评论可切换；`?view=` 可分享；有稿时出现逐字稿分段（手工） | ✅ | README / ui-refactor |
| `FR-TREND-001` | P1 | 趋势页提供月度与类型分析 | `AC-TREND-001`：`/:datasetId/trends` 展示月度趋势、月度明细、内容类型对比、典型节奏曲线、全期榜单（手工） | ✅ | README / roadmap |
| `FR-GALLERY-001` | P1 | 成员相册按 JST 自然月分组 | `AC-GALLERY-001`：`/:datasetId/gallery` 按月份分组，图片懒加载，`?order=` 可分享；390 / 320px 无横向滚动（手工） | ✅ | product-direction |
| `FR-GALLERY-002` | P1 | 全组相册支持跨成员筛选 | `AC-GALLERY-002`：`/gallery` 展示全部成员封面，`?member=` / `?type=` 写进 URL（手工） | ✅ | product-direction |
| `FR-COMPARE-001` | P1 | 同一成员内最多 4 场对比 | `AC-COMPARE-001`：`?ids=a,b,c` 可分享；逐分钟曲线叠加；指标横表；超过 4 场有明确限制（手工） | ✅ | README |
| `FR-COMPARE-002` | P2 | 跨成员对比 | `AC-COMPARE-002`：组级 `/compare` 按同一月份区间与内容类型横向对比；`?members=` / `?type=` / `?months=` 可分享；样本不足时标注（手工） | ✅ | roadmap |
| `FR-TRANSCRIPT-001` | P1 | 逐字稿发布与渲染 | `AC-TRANSCRIPT-001`：有稿场次出现「逐字稿」分段；索引页按月份列出；行首时间码跳 YouTube；无稿不显示空标签（手工） | ✅ | product-direction |
| `FR-TRANSCRIPT-002` | P2 | 逐字稿索引的检索、分面与长列表 | `AC-TRANSCRIPT-002`：搜索匹配标题 / 摘要 / 标签 / 日期 / `videoId`；标签多选同时命中；`q` / `tags` / `sort` / `dense` 写入 URL；标签、排序与密度收进单一筛选入口；月份分组可折叠；移动端筛选面板可用；320px 无横向溢出（手工 + 单测） | ✅ | transcript-index |
| `FR-DATA-001` | P0 | 由 pack 派生 streams / insights | `AC-DATA-001`：`bun run db:ingest` 重建 `streams` + `dataset_insights`；`db:verify` 0 problems；不手改数据库（手工 / 脚本） | ✅ | data-model |
| `FR-DATA-002` | P0 | 资产发布到 R2 | `AC-DATA-002`：`publish:assets` 上传顺序为 thumbs → emoji → archive；逐字稿单独发布；对象可达（手工） | ✅ | deployment |
| `FR-DATA-003` | P0 | 每日增量抓取与入库 | `AC-DATA-003`：`daily-update.ts` 与 `streams` 做差集；安静日不抓取、不 ingest；失败开 issue（手工 / Actions 日志） | ✅ | deployment |
| `FR-DATA-004` | P1 | 数据更新后刷新缓存与 SEO 产物 | `AC-DATA-004`：ingest 后调 `POST /api/internal/cache/purge` 按 tag 失效；sitemap 请求期生成；线上 MISS → HIT 与 purge 后回源已实测 | ✅ | astro-ssr-migration |
| `FR-SEO-001` | P0 | 每页输出 metadata 与 sitemap | `AC-SEO-001`：请求期输出 title / canonical / OG；`sitemap.xml`、`llms.txt`、`robots.txt` 可访问 | ✅ | architecture |
| `FR-SEO-002` | P1 | 新场次的分享卡片及时更新 | `AC-SEO-002`：新场次 ingest 后，HTML head 与 sitemap 在请求期立即使用新数据，不需要构建 | ✅ | architecture |
| `FR-A11Y-001` | P1 | 键盘与可访问性 | `AC-A11Y-001`：焦点可见；图标按钮有可访问名称；图表有 `aria-label`；首页 / 场次 / 单场 / 对比 axe 0 violations（手工） | ✅ | roadmap |
| `FR-THEME-001` | P0 | 深浅色主题且首屏无闪烁 | `AC-THEME-001`：切换后刷新，`<html>` 类在首屏即为正确值；图表与界面同时适配（手工） | ✅ | README |
| `FR-KEY-001` | P1 | 快捷键 | `AC-KEY-001`：`j` / `k` 翻场、`1`–`5` 切页、`/` 聚焦搜索、`⌘K` 搜索、`⌘B` 收起侧栏；输入框内不触发（手工） | ✅ | README |
| `FR-MOBILE-001` | P1 | 移动端可用 | `AC-MOBILE-001`：390 / 320px 无横向溢出；底部标签栏可用；表格自身滚动（手工） | ✅ | README |
| `FR-AGENT-001` | P2 | 单场 Markdown 视图 | `AC-AGENT-001`：`/{datasetId}/stream/{videoId}.md` 返回 `text/markdown`；frontmatter 含标题 / 日期 / 成员；包含概览、部分指标与逐字稿；未知 id 返回 404 | ✅ | astro-ssr-migration |
| `FR-ARCH-001` | P1 | Astro + PostgreSQL + Workers 迁移 | `AC-ARCH-001`：全部页面 SSR + 数据库读取；全量场次已入库、`db:verify` 0 problems；`.md`、sitemap、purge 已实现；已部署在 `ymmt.chilfish.top` | ✅ | astro-ssr-migration |
| `FR-OPS-001` | P1 | 定时任务与失败通知 | `AC-OPS-001`：`.github/workflows/data.yml` 按 cron 运行；失败开 issue；手动 `workflow_dispatch` 可附加 `--force` | ✅ | deployment |
| `FR-BUILD-001` | P0 | 验证门禁 | `AC-BUILD-001`：`bun run check`、`bun run build`、`bun run db:verify`、`bun run test:smoke` 可运行 | ✅ | CONTRIBUTING |

## 非功能需求

- **时间**：一律 JST（UTC+9）；`startedAt` 取开播时刻，不是公开时刻。
- **数据源**：页面只读 PostgreSQL；R2 只放不可变对象（封面 / 表情 / archive / 逐字稿正文），不参与查询。
- **运行时**：Cloudflare Workers 在请求期 SSR；只读数据库与对象存储，不提供用户写入接口。
- **性能**：首屏只加载当前页面必需的数据；成员页不下载全部 datapack；单场按需拉取。
- **可访问性**：焦点可见；非文本图表提供 `role` / `aria-label`；200% 缩放不溢出。
- **样式**：颜色来自设计 Token；浅色 / 深色同时成立；不硬编码颜色。
- **隐私**：不公开 cookie、邮箱、付款信息；会员限定内容上线前确认范围。
- **SEO**：canonical 为绝对地址且不带 query；表格筛选、相册筛选归一到基路径；对比页与未知路径 `noindex`。
- **兼容**：旧地址 `/:id/overview`、`/:id/table`、`/:id/stream` 保持 302；`.md` 路由不进 sitemap，用 `X-Robots-Tag: noindex`。

## 需求溯源

| 需求 | 实现位置 | 说明 |
| --- | --- | --- |
| `FR-HOME-001` / `FR-MEMBER-001` | `src/pages/`、`src/components/dashboard/group-*`、`member-home-view.tsx` | 组级与成员级页面 |
| `FR-CAL-001`–`FR-CAL-012` | `src/pages/calendar.astro`、`src/pages/[datasetId]/calendar.astro`、`src/pages/admin/schedule.astro`、`src/pages/api/admin/schedule.ts`、`src/db/queries/calendar.ts`、`src/lib/calendar.ts`、`src/components/dashboard/calendar-view.tsx`、`src/components/dashboard/day-timeline.tsx`、`scripts/lib/schedule-sync.ts` | 读取、月历 / 议程、自动同步、管理端写入、读取时关联与今天+明天时间线已落地；ICS 暂缓。方案见 [live-calendar.md](../planning/live-calendar.md)，接口见 [schedule-admin.md](../engineering/schedule-admin.md) |
| `FR-STREAM-001` | `src/components/dashboard/streams-view.tsx`、`src/lib/table-params.ts` | 表格与 URL 状态 |
| `FR-STREAM-002` | `src/components/dashboard/stream-detail-view.tsx` 等 | 单场分段 |
| `FR-TREND-001` | `src/components/dashboard/trends-view.tsx`、`src/lib/aggregate.ts` | 聚合与图表 |
| `FR-GALLERY-*` | `src/components/dashboard/gallery-view.tsx`、`group-gallery-page.tsx` | 相册 |
| `FR-COMPARE-001` | `src/components/dashboard/compare-view.tsx`、`multi-line-chart.tsx` | 同成员场次对比 |
| `FR-COMPARE-002` | `src/pages/compare.astro`、`src/components/pages/group-compare-page.tsx`、`src/lib/compare.ts`、`src/db/queries/group-compare.ts` | 组级全员对比 |
| `FR-TRANSCRIPT-001` | `content/transcripts/`、`src/components/dashboard/transcript-view.tsx`、`transcripts-view.tsx`、`src/db/queries/transcripts.ts`、`src/pages/[datasetId]/transcripts.astro`、`scripts/publish-transcripts.ts` | 逐字稿 |
| `FR-DATA-*` | `scripts/publish-data.ts`、`scripts/daily-update.ts`、`scripts/lib/` | 数据链路 |
| `FR-SEO-*` | `src/lib/seo.ts`、`src/components/shared/SEO.astro`、`src/pages/sitemap.xml.ts` | SEO |
| `FR-AGENT-001` / `FR-ARCH-001` | `src/pages/[datasetId]/stream/[videoId].md.ts`、`src/lib/agent-markdown.ts`、`src/db/queries/` | Agent 视图与数据库查询 |

## 变更记录

| 日期 | 变更 | 版本 |
| --- | --- | --- |
| 2026-11-03 | 建立需求规格，登记首页、成员、场次、单场、趋势、相册、对比、逐字稿、数据、SEO、迁移等 FR | v1.0 |
| 2026-11-04 | `FR-COMPARE-002` 组级全员对比上线；`FR-DATA-004` 线上实测通过；同步当前运行形态与数据链路表述 | v1.1 |
| 2026-11-04 | 登记直播日历需求 `FR-CAL-001`–`FR-CAL-009`，方案见 [live-calendar.md](../planning/live-calendar.md)；明确「不做实时看板」仅指直播中指标 | v1.2 |
| 2026-11-04 | 直播日历读取路径、月历 / 议程、自动同步与缓存落地；`FR-CAL-003` 手工维护按用户要求暂缓，`FR-CAL-009` ICS 未做 | v1.3 |
| 2026-11-07 | 新增管理端 `FR-CAL-010`、今日计划 `FR-CAL-011`、读取时关联 `FR-CAL-012`；`FR-CAL-003` 改为 `/admin/schedule` 与 `/api/admin/schedule` | v1.4 |
