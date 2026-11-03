# 需求规格说明（PRD）

> 本文件是项目需求真相源。变更时同步更新 [README.md](../README.md) 索引，并在文末「变更记录」追加一行。
> 当前实现是 React Router 8 + Vite 8 静态站；Astro + PostgreSQL 迁移是规划中的目标形态，相关条目标 `📋`。

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
- 场次页：搜索、内容类型筛选、排序、CSV 导出、URL 状态
- 单场页：概览、时间轴、弹幕与词、付费、评论、逐字稿
- 趋势页：月度趋势与明细、内容类型对比、典型节奏曲线、全期高频词与发言者
- 相册：成员相册、全组相册、按 JST 自然月分组
- 对比：同一成员内最多 4 场；跨成员对比为规划项
- 逐字稿：手写 Markdown，发布后在单场页与索引页渲染
- 数据链路：本地 pack → manifest / insights / 组级文件 → R2；每日增量抓取与发布
- SEO：真实路径、每页 title / description / canonical / OG、构建期静态 head、sitemap、robots
- 主题、快捷键、移动端底部标签栏
- 迁移目标：Astro 7 + Cloudflare Workers + PostgreSQL + R2，单场页请求期 SSR，`.md` 路由供 Agent 读取

**不做：**

- 实时抓取 / 直播中数据
- 用户系统、评论发布、收藏
- 逐字稿在线编辑器 / CMS（独立项目）
- 内容正文的翻译或字幕编辑（归档 pipeline 职责）
- 全站排行榜、跨站聚合
- 第一版把 691 万条原始弹幕全部入库

## 功能需求

| FR ID | 优先级 | 描述 | 验收标准 | 状态 | 来源 |
| --- | --- | --- | --- | --- | --- |
| `FR-HOME-001` | P0 | 组首页回答「最近谁播了」 | `AC-HOME-001`：`/` 展示近 7 天 / 本月脉冲、最新一场、最近更新与成员入口；单个成员加载失败不阻塞其余成员（手工） | ✅ | README / product-direction |
| `FR-MEMBER-001` | P0 | 成员首页提供近况与规模 | `AC-MEMBER-001`：`/:datasetId` 展示规模指标、最近一场、本月变化、更新日历；数据缺失时显示「—」或空状态（手工） | ✅ | README |
| `FR-STREAM-001` | P0 | 场次列表可搜索、筛选、排序、导出 | `AC-STREAM-001`：`q` / `type` / `sort` / `dir` / `vstats` 写入 URL；刷新与前进后退保持状态；可导出 CSV（手工） | ✅ | README / architecture |
| `FR-STREAM-002` | P0 | 单场页提供分段详情 | `AC-STREAM-002`：概览、时间轴、弹幕与词、付费、评论可切换；`?view=` 可分享；有稿时出现逐字稿分段（手工） | ✅ | README / ui-refactor |
| `FR-TREND-001` | P1 | 趋势页提供月度与类型分析 | `AC-TREND-001`：`/:datasetId/trends` 展示月度趋势、月度明细、内容类型对比、典型节奏曲线、全期榜单（手工） | ✅ | README / roadmap |
| `FR-GALLERY-001` | P1 | 成员相册按 JST 自然月分组 | `AC-GALLERY-001`：`/:datasetId/gallery` 按月份分组，图片懒加载，`?order=` 可分享；390 / 320px 无横向滚动（手工） | ✅ | product-direction |
| `FR-GALLERY-002` | P1 | 全组相册支持跨成员筛选 | `AC-GALLERY-002`：`/gallery` 展示全部成员封面，`?member=` / `?type=` 写进 URL（手工） | ✅ | product-direction |
| `FR-COMPARE-001` | P1 | 同一成员内最多 4 场对比 | `AC-COMPARE-001`：`?ids=a,b,c` 可分享；逐分钟曲线叠加；指标横表；超过 4 场有明确限制（手工） | ✅ | README |
| `FR-COMPARE-002` | P2 | 跨成员对比 | `AC-COMPARE-002`：同一时间段 / 内容类型的横向对比可分享；样本不足时标注（手工） | 📋 | roadmap |
| `FR-TRANSCRIPT-001` | P1 | 逐字稿发布与渲染 | `AC-TRANSCRIPT-001`：有稿场次出现「逐字稿」分段；索引页按月份列出；行首时间码跳 YouTube；无稿不显示空标签（手工） | ✅ | product-direction |
| `FR-DATA-001` | P0 | 由 pack 派生 manifest / insights | `AC-DATA-001`：`bun run publish:data` 重建 manifest + insights 并上传；manifest 不手改；`video.id` 与文件名不一致时中止（手工） | ✅ | data-model |
| `FR-DATA-002` | P0 | 索引与数据发布到 R2 | `AC-DATA-002`：上传顺序为 thumbs → pack → manifest / insights → index；`validate:data --remote` 逐条可达（手工） | ✅ | deployment |
| `FR-DATA-003` | P0 | 每日增量抓取与发布 | `AC-DATA-003`：`daily-update.ts` 先做频道差集；安静日不恢复、不发布；失败开 issue（手工 / Actions 日志） | ✅ | deployment |
| `FR-DATA-004` | P1 | 数据更新后刷新缓存与 SEO 产物 | `AC-DATA-004`：`POST /api/internal/cache/purge` 按 tag 失效；sitemap 请求期生成；线上缓存实测待做 | 🚧 | astro-ssr-migration |
| `FR-SEO-001` | P0 | 每页输出 metadata 与 sitemap | `AC-SEO-001`：请求期输出 title / canonical / OG；`sitemap.xml`、`llms.txt`、`robots.txt` 可访问 | ✅ | architecture |
| `FR-SEO-002` | P1 | 新场次的静态分享卡片及时更新 | `AC-SEO-002`：新场次发布后，静态 head 与 sitemap 在可接受时间内更新；当前要等下一次构建 | 📋 | ssg-research |
| `FR-A11Y-001` | P1 | 键盘与可访问性 | `AC-A11Y-001`：焦点可见；图标按钮有可访问名称；图表有 `aria-label`；首页 / 场次 / 单场 / 对比 axe 0 violations（手工） | ✅ | roadmap |
| `FR-THEME-001` | P0 | 深浅色主题且首屏无闪烁 | `AC-THEME-001`：切换后刷新，`<html>` 类在首屏即为正确值；图表与界面同时适配（手工） | ✅ | README |
| `FR-KEY-001` | P1 | 快捷键 | `AC-KEY-001`：`j` / `k` 翻场、`1`–`5` 切页、`/` 聚焦搜索、`⌘K` 搜索、`⌘B` 收起侧栏；输入框内不触发（手工） | ✅ | README |
| `FR-MOBILE-001` | P1 | 移动端可用 | `AC-MOBILE-001`：390 / 320px 无横向溢出；底部标签栏可用；表格自身滚动（手工） | ✅ | README |
| `FR-AGENT-001` | P2 | 单场 Markdown 视图 | `AC-AGENT-001`：`/{datasetId}/stream/{videoId}.md` 返回 `text/markdown`；frontmatter 含标题 / 日期 / 成员；包含概览、部分指标与逐字稿；未知 id 返回 404 | ✅ | astro-ssr-migration |
| `FR-ARCH-001` | P1 | Astro + PostgreSQL + Workers 迁移 | `AC-ARCH-001`：全部页面 SSR + 数据库读取；全量 1,897 场已入库、`db:verify` 0 problems；`.md`、sitemap、purge 已实现；线上部署与缓存实测待做 | 🚧 | astro-ssr-migration |
| `FR-OPS-001` | P1 | 定时任务与失败通知 | `AC-OPS-001`：`.github/workflows/data.yml` 按 cron 运行；失败开 issue；手动 `workflow_dispatch` 可附加 `--force` | ✅ | deployment |
| `FR-BUILD-001` | P0 | 验证门禁 | `AC-BUILD-001`：`bun run check`、`bun run build`、`bun run db:verify`、`bun run test:smoke` 可运行 | ✅ | CONTRIBUTING |

## 非功能需求

- **时间**：一律 JST（UTC+9）；`startedAt` 取开播时刻，不是公开时刻。
- **数据源**：当前是 R2 上的 JSON；迁移目标是 PostgreSQL 查询 + R2 对象。两者不能混写为「已经成立」。
- **无后端**（当前）：静态托管即可运行；迁移后 Worker 只读数据库，不提供用户写入接口。
- **性能**：首屏只加载当前页面必需的数据；成员页不下载全部 datapack；单场按需拉取。
- **可访问性**：焦点可见；非文本图表提供 `role` / `aria-label`；200% 缩放不溢出。
- **样式**：颜色来自设计 Token；浅色 / 深色同时成立；不硬编码颜色。
- **隐私**：不公开 cookie、邮箱、付款信息；会员限定内容上线前确认范围。
- **SEO**：canonical 为绝对地址且不带 query；表格筛选、相册筛选归一到基路径；对比页与未知路径 `noindex`。
- **迁移期**：旧 URL 必须保持可访问；`.md` 路由不进 sitemap，用 `X-Robots-Tag: noindex`。

## 需求溯源

| 需求 | 实现位置 | 说明 |
| --- | --- | --- |
| `FR-HOME-001` / `FR-MEMBER-001` | `src/pages/`、`src/components/dashboard/group-*`、`member-home-view.tsx` | 组级与成员级页面 |
| `FR-STREAM-001` | `src/components/dashboard/streams-view.tsx`、`src/lib/table-params.ts` | 表格与 URL 状态 |
| `FR-STREAM-002` | `src/components/dashboard/stream-detail-view.tsx` 等 | 单场分段 |
| `FR-TREND-001` | `src/components/dashboard/trends-view.tsx`、`src/lib/aggregate.ts` | 聚合与图表 |
| `FR-GALLERY-*` | `src/components/dashboard/gallery-view.tsx`、`group-gallery-page.tsx` | 相册 |
| `FR-COMPARE-001` | `src/components/dashboard/compare-view.tsx`、`multi-line-chart.tsx` | 对比 |
| `FR-TRANSCRIPT-001` | `content/transcripts/`、`src/components/dashboard/transcript-view.tsx`、`transcripts-view.tsx`、`src/db/queries/transcripts.ts`、`src/pages/[datasetId]/transcripts.astro`、`scripts/publish-transcripts.ts` | 逐字稿 |
| `FR-DATA-*` | `scripts/publish-data.ts`、`scripts/daily-update.ts`、`scripts/lib/` | 数据链路 |
| `FR-SEO-*` | `src/lib/seo.ts`、`src/components/shared/SEO.astro`、`src/pages/sitemap.xml.ts` | SEO |
| `FR-AGENT-001` / `FR-ARCH-001` | `src/pages/[datasetId]/stream/[videoId].md.ts`、`src/lib/agent-markdown.ts`、`src/db/queries/` | Agent 视图与数据库查询 |

## 变更记录

| 日期 | 变更 | 版本 |
| --- | --- | --- |
| 2026-11-03 | 建立需求规格，登记首页、成员、场次、单场、趋势、相册、对比、逐字稿、数据、SEO、迁移等 FR | v1.0 |
