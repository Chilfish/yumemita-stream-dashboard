# 代码地图

> 任务意图 → 关键文件。这里只放入口，实现细节以源码为准。
> 路径会随重构变化；发现过期时直接改本表，不要在 `AGENTS.md` 复制。
> 分层、目录与扩展点见 [architecture.md](../planning/architecture.md)。

| 任务意图 | 关键文件 | 操作 |
| --- | --- | --- |
| 新增 / 修改页面 | `src/pages/*.astro`、`src/layouts/`、`src/lib/routes.ts` | 文件路由 + 布局 + 导航 |
| 新增视图组件 | `src/components/dashboard/` | 接收 `StreamRow[]` / `DatasetTotals` |
| 新增图表 | `src/components/charts/` | D3 算数学，React 渲染 SVG |
| 新增 coss 组件 | `src/components/ui/` | 用 shadcn CLI + `@coss` registry，不手写业务 |
| 数据加载 | `src/db/queries/*`、`src/types/db.ts` | 页面先查库，再传给岛屿 |
| 数据库 / ingest | `src/db/schema.ts`、`scripts/ingest-db.ts`、`scripts/verify-db.ts` | `bun run db:ingest` / `db:verify` |
| 数据库读路径 / 压测 | `src/db/batch.ts`、`src/db/queries/*`、`scripts/bench-db.ts` | 先跑 `bun run db:bench`；方案见 [db-optimization.md](../archive/db-optimization.md) |
| 聚合 / 纯函数 | `src/lib/aggregate.ts`、`format.ts`、`classify.ts` | 配对应 `.test.ts` |
| URL 状态 | `src/lib/table-params.ts`、`src/lib/routes.ts`、`src/lib/router-compat.ts` | 可分享、可刷新 |
| SEO | `src/lib/seo.ts`、`src/components/shared/SEO.astro`、`src/pages/sitemap.xml.ts` | 请求期输出 head / sitemap |
| Agent 视图 | `src/lib/agent-markdown.ts`、`src/pages/[datasetId]/stream/[videoId].md.ts` | `text/markdown` + 逐字稿 |
| 数据发布 | `scripts/publish-data.ts`、`scripts/publish-transcripts.ts` | `--assets-only`：thumbs / emoji / archive；逐字稿单独发 |
| 增量更新 | `scripts/daily-update.ts`、`.github/workflows/data.yml` | 频道差集，安静日不发布 |
| 抓取 / 补数据 | `scripts/fetch-streams.ts`、`fetch-danmaku.ts`、`fetch-live-chat.ts`、`fetch-thumbnails.ts`、`fetch-emoji.ts`、`enrich-chat.ts` | 只写本地，不改前端 |
| 逐字稿 | `content/transcripts/`、`scripts/publish-transcripts.ts` | 手写 Markdown，发布到 R2 |
| 逐字稿索引 / 长列表 | `src/lib/transcript-params.ts`、`src/components/dashboard/transcript/transcripts-view.tsx`、`src/components/dashboard/transcript/transcripts-toolbar.tsx`、`docs/archive/transcript-index.md` | 搜索、标签分面、月份折叠；筛选写 URL |
| 数据字段 / 口径 | `docs/data/data-model.md`、`src/types/` | 改字段同步文档与类型 |
| 会员限定公开范围 | `src/lib/visibility.ts`、`src/lib/member-access.ts`、`src/db/queries/shared.ts` | 元数据（封面 / 标题 / 时间）公开；派生指标清零，单场复用详情模板 |
| 未来日程 / 管理端 | `src/pages/admin/schedule.astro`、`src/pages/api/admin/schedule.ts`、`src/lib/schedule.ts`、`src/lib/admin-auth.ts`、`.agents/skills/schedule-maintenance/SKILL.md` | 手工日程、类型与鉴权；接口见 [schedule-admin.md](./schedule-admin.md) |
| 日程分享卡片 | `src/components/dashboard/calendar/share-card.tsx`、`share-button.tsx`、`public/share/bg_member_list.webp` | React + Tailwind 渲染，modern-screenshot 导出 PNG；官方背景 + 成员头像 + 类型图标 |
| 日程与真实场次关联 / 今日计划 | `src/lib/calendar.ts`、`src/db/queries/calendar.ts`、`src/components/dashboard/calendar/day-timeline.tsx` | 读取时按日期 + 时段匹配，不写回 `video_id`；今天 + 明天时间线 |
| 部署 / 缓存 | [deployment.md](./deployment.md)、`wrangler.jsonc`、`scripts/r2-cors.json`、`astro.config.mjs` | Cloudflare Workers + R2 |
| 发布检查 | [release-checklist.md](./release-checklist.md) | 按清单勾选 |
| 信息密度 / 页面取舍 | [information-density.md](../ui-design/information-density.md) | 一屏一个问题；删除重复表述、口径脚注与自证式导航 |
