# AGENTS.md

本文件是 AI Agent 的协作指南。人类贡献者请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。
完整文档索引见 [docs/README.md](./docs/README.md)，文档与界面文案规范见 [docs/writing-style.md](./docs/writing-style.md)。

## 当前事实与目标形态

**当前是 Astro SSR + Neon 查询形态（2026-11-04）。** 所有页面已迁到 `src/pages/*.astro`，旧 React Router 页面与依赖已删除；全量场次已入库并通过对账。每日任务已改为「数据库差集 → 抓取 → ingest → 资产 → purge」，客户端媒体统一走 `PUBLIC_R2_BASE`，逐字稿正文走同源 `/api/transcripts/...`。已合并到 `main` 并部署到 `https://ymmt-cf.chilfish.top`，canonical / sitemap 已按原域名 `https://ymmt.chilfish.top` 输出；剩余 DNS 切换与回滚演练。

| 项 | 当前 | 目标 |
| --- | --- | --- |
| 框架 | Astro 7 + `@astrojs/cloudflare` | 同左 |
| 数据 | PostgreSQL（全量场次）+ R2 对象 | 同左 |
| 路由 | `src/pages/` 文件路由 + 请求期 SSR | 同左 |
| 单场页 | 请求期 SSR（DB 还原 pack） | 同左 |
| Agent 视图 | `/{datasetId}/stream/{videoId}.md` 已实现 | 同左 |
| 部署 | 已合并到 `main`，部署在 `ymmt-cf.chilfish.top`；DNS 待切回原域名 | Cloudflare Workers |

已完成：Astro 脚手架、DB schema / ingest / 对账 / 查询层、全量 ingest（`db:verify` 0 problems）、全部页面与岛屿、sitemap / llms.txt / robots、`.md` 端点、逐字稿 API、内部 purge 端点、每日 ingest + purge、部署工作流、R2 迁桶与 CORS、线上部署、`astro check` / `test` / `build` / `preview` / `test:smoke`。剩余：DNS 切回原域名后的复核、回滚演练。详见 [docs/planning/astro-ssr-migration.md](./docs/planning/astro-ssr-migration.md)。

## 意图 → 文件映射（当前实现）

| 任务意图 | 关键文件 | 操作 |
| --- | --- | --- |
| 新增 / 修改页面 | `src/pages/*.astro`、`src/layouts/`、`src/lib/routes.ts` | 文件路由 + 布局 + 导航 |
| 新增视图组件 | `src/components/dashboard/` | 接收 `StreamRow[]` / `DatasetTotals` |
| 新增图表 | `src/components/charts/` | D3 算数学，React 渲染 SVG |
| 新增 coss 组件 | `src/components/ui/` | 用 shadcn CLI + `@coss` registry，不手写业务 |
| 数据加载 | `src/db/queries/*`、`src/types/db.ts` | 页面先查库，再传给岛屿 |
| 数据库 / ingest | `src/db/schema.ts`、`scripts/ingest-db.ts`、`scripts/verify-db.ts` | `bun run db:ingest` / `db:verify` |
| 聚合 / 纯函数 | `src/lib/aggregate.ts`、`format.ts`、`classify.ts` | 配对应 `.test.ts` |
| URL 状态 | `src/lib/table-params.ts`、`src/lib/routes.ts`、`src/lib/router-compat.tsx` | 可分享、可刷新 |
| SEO | `src/lib/seo.ts`、`src/components/shared/SEO.astro`、`src/pages/sitemap.xml.ts` | 请求期输出 head / sitemap |
| Agent 视图 | `src/lib/agent-markdown.ts`、`src/pages/[datasetId]/stream/[videoId].md.ts` | `text/markdown` + 逐字稿 |
| 数据发布 | `scripts/publish-data.ts`、`scripts/publish-transcripts.ts` | `--assets-only`：thumbs / emoji / archive；逐字稿单独发 |
| 每日增量 | `scripts/daily-update.ts`、`.github/workflows/data.yml` | 频道差集，安静日不发布 |
| 抓取 / 补数据 | `scripts/fetch-streams.ts`、`fetch-danmaku.ts`、`fetch-live-chat.ts`、`fetch-thumbnails.ts`、`fetch-emoji.ts`、`enrich-chat.ts` | 只写本地，不改前端 |
| 逐字稿 | `content/transcripts/`、`scripts/publish-transcripts.ts` | 手写 Markdown，发布到 R2 |
| 数据字段 / 口径 | `docs/data/data-model.md`、`src/types/` | 改字段同步文档与类型 |
| 部署 / 缓存 | `docs/engineering/deployment.md`、`wrangler.jsonc`、`scripts/r2-cors.json`、`astro.config.mjs` | Cloudflare Workers + R2 |
| 发布检查 | `docs/engineering/release-checklist.md` | 按清单勾选 |
| 迁移执行 | `docs/planning/astro-ssr-migration.md` | 分阶段，先 PoC 再切换 |

## 文档索引

| 场景 | 先读 |
| --- | --- |
| 任何任务开始前 | [docs/README.md](./docs/README.md) |
| 新增功能 / 判断边界 | [docs/requirements/requirements-spec.md](./docs/requirements/requirements-spec.md) |
| 架构级变更 | [docs/planning/architecture.md](./docs/planning/architecture.md) |
| 规划下一阶段 | [docs/planning/backlog.md](./docs/planning/backlog.md) |
| 写代码 | [docs/engineering/code-style.md](./docs/engineering/code-style.md) |
| Commit / PR | [docs/engineering/git-workflow.md](./docs/engineering/git-workflow.md) |
| 发布 | [docs/engineering/release-checklist.md](./docs/engineering/release-checklist.md) |
| 改 UI | [docs/ui-design/README.md](./docs/ui-design/README.md) + [GENERAL.md](./docs/ui-design/GENERAL.md) |
| 写文档 / 文案 | [docs/writing-style.md](./docs/writing-style.md) |
| 写码前防复现 | [docs/postmortem/README.md](./docs/postmortem/README.md) |
| 迁移 | [docs/planning/astro-ssr-migration.md](./docs/planning/astro-ssr-migration.md) + [docs/engineering/astro-experiments.md](./docs/engineering/astro-experiments.md) |

## 🔴 强制规范

1. **文档先行**：每个任务第一步更新 `docs/planning/backlog.md` 或对应方案文档；实现过程中同步记录 `docs/development-log/YYYY-MM-DD.md`，不要事后补记。
2. **验证先行**：功能先写可验证的验收标准（FR / AC），再实现。
3. **验证必须携带信号**：手工验证要写清操作路径与预期结果；自动化测试必须能失败，故意改坏被测行为时应变红。
4. **写码前读事后分析**：对照 [docs/postmortem/README.md](./docs/postmortem/README.md) 的「基线雷区」自查；新 Bug 模式回写 postmortem。
5. **Commit 纪律**：先定 Conventional Commit message 再写代码；超过 10 个文件或 200 行主动拆分。
6. **文档即事实**：路径、命令、路由、字段名与代码一致；改代码时同步更新文档和 `docs/README.md` 索引，不留死链。
7. **文案遵循规范**：文档与界面文案按 [docs/writing-style.md](./docs/writing-style.md) 执行。
8. **迁移期双份事实禁止**：当前实现与 Astro / PostgreSQL 目标形态分开写；未实现的能力标 `📋`。

## 核心约定（写代码前必读）

### 🧭 当前运行模型

- Astro 7 `output: 'server'` + `@astrojs/cloudflare`；页面在 `src/pages/`，稳定页显式 `prerender = true`。
- `src/layouts/Layout.astro` 负责 SEO、主题内联脚本、ClientRouter 与全局岛屿。
- 旧 React Router 页面与 `src/legacy/` 已删除；不要在 `src/` 里重新引入 `react-router`。
- 单场 / 对比的 pack 按需查 `/api/packs`（数据库还原）；列表页只消费查询层返回的 rows / insights。

### 📊 数据流

```text
data/<id>/*.datapack.json
  → db:ingest 事务 upsert → PostgreSQL（streams / details / insights / transcripts）
  → publish:assets / publish:transcripts → R2（封面 / 表情 / archive / 逐字稿正文）
  → 请求期 SSR 查库 → StreamSummary[] / DTO
  → 单场 / 对比按需读 /api/packs（数据库还原）
```

- 页面只读数据库；R2 只放不可变对象。
- R2 桶是 `yumemita-data`，对象直接放在桶根（`archive/`、`<datasetId>/thumbs/`、`emojis/`、`<datasetId>/transcripts/`），不再有公共前缀。
- 数据更新后按 Cache-Tag purge，不触发前端构建。
- `vstats` / `comments` / `avgConcurrent` 可能为 `null`；图表跳过或显示「—」。
- 单场页只查该场数据；对比页最多 4 场。
- 不要为单个数字查整张表或完整 pack。

### 🚨 三态覆盖

所有数据获取路径必须覆盖：

```text
loading → Skeleton / 加载提示
empty   → Empty + 说明 + 下一步
error   → 消息 + 可执行动作（重试 / 检查配置 / 查看日志）
```

### 🎨 设计系统铁律

```text
✅ bg-background, text-muted-foreground, border-input
❌ #ffffff, rgb(0,0,0), bg-[#xxx]          （禁止硬编码颜色）
✅ 浅色 / 深色同时兼容（.dark 类，变量自动切换）
❌ 用 dark: 前缀覆盖颜色
```

- 组件优先：复用 `src/components/ui/` 现有 coss 组件。
- 类名合并用 `cn()`。
- 图标按钮有可访问名称；图表 SVG 有 `aria-label` / `<title>`。

### 🧭 导航与 URL

```text
✅ <a href="/nonoka">                   （站内导航，ClientRouter 接管）
✅ navigate("/nonoka")                  （@/lib/router-compat）
❌ window.location.href = "/nonoka"     （会整页刷新）
```

- 表格筛选、单场分段、对比 ids 写进 URL，默认值不写。
- 新增路由：`src/pages/` 下新建 `.astro` + `src/lib/routes.ts` + `app-sidebar.tsx` 的 `NAV_ITEMS`。
- 旧地址 `/:id/overview`、`/:id/table` 自动重定向。

### 🧪 测试与验证

```bash
bun run check          # astro check + test + lint
bun run build          # astro build（Worker + 预渲染 404/500）
bun run db:query       # 查询层冒烟（需要 DATABASE_URL）
bun run test:smoke     # 路由冒烟（先启动 preview）
bun run validate:data  # 旧数据链路
```

- 纯逻辑放 `src/lib/` 并配 `.test.ts`。
- 路由冒烟：`bun run test:smoke`（先启动 dev / preview）。
- 不把「构建通过」当作功能已验证；未执行的检查标注「未验证」。

### 🚀 发布与数据

- 数据更新：`db:ingest` + `publish:assets` + `purge:cache` 后刷新即可，不需要重新构建前端。
- 分享卡片 head 由 SSR 请求期输出，新场次 ingest 后即可用。
- R2 凭据只在发布 / 抓取环境注入，不进入客户端 bundle。
- 会员限定内容上线前确认公开范围。

## 迁移执行时的追加约定

正式执行 [astro-ssr-migration.md](./docs/planning/astro-ssr-migration.md) 时，以下规则生效：

- 每页显式 `export const prerender`；数据页 `false`，稳定页 `true`。
- `.astro` frontmatter 不读 `window` / `localStorage`；岛屿 props 可序列化。
- `client:only` 不用于首屏正文或 SEO 内容。
- 导航用 `<a href>` + ClientRouter；脚本内用 `navigate()`。
- 服务端密钥只从 `astro:env/server` 读；R2 凭据只在脚本 / 构建期使用。
- 数据页缓存用 `Astro.cache.set` / `routeRules`；ingest 后走内部 purge 端点。
- `.md` 路由返回 `text/markdown`；不进 sitemap；`X-Robots-Tag: noindex`。
- ingest 用 `postgres` / WebSocket Pool 做事务，不用 `neon-http`。
- 全量弹幕暂不入库；先聚合，`chat_events` 分区后再上。

## 常见反模式（禁止）

| 反模式 | 正确做法 | 来源 |
| --- | --- | --- |
| 在视图里重复聚合 | 放 `src/lib/aggregate.ts`，补测试 | 分层 |
| 为单个数字查整份 pack / 全表聚合 | 用查询层聚合 / `dataset_insights` | 性能 |
| 把 `null` 画成 0 | 跳过或显示「—」 | 数据口径 |
| 手写按钮 / 弹层 / 下拉 | 复用 `src/components/ui/` | UI 规范 |
| 硬编码颜色 | CSS 变量 / Token | UI 规范 |
| 用 `dark:` 覆盖颜色 | 变量已在 `.dark` 切换 | UI 规范 |
| 无 loading / empty / error 状态 | 三态覆盖 | 三态约定 |
| 对不可信 Markdown 用 `set:html` | `react-markdown` 默认安全模式 | 安全 |
| 在客户端模块读 R2 凭据 | 只在服务端 / 脚本读取 | 安全 |
| 手改 manifest / insights | 由 `db:ingest` 派生到数据库 | 数据 |
| 把计划写成现状 | 未完成放 backlog / 阶段方案 | 写作规范 |
| 死链、旧路径 | 合并前全局搜索并打开检查 | 文档 |
| 带着已知失败合并 | 先修或移除 | 验证 |

## 开发工作流

1. **理解现状**：读 [docs/README.md](./docs/README.md) 的对应文档 → 读相关源码。
2. **先更新文档**：在 [docs/planning/backlog.md](./docs/planning/backlog.md) 登记任务；复杂功能先写验收标准；实现过程中记录开发日志。
3. **参考基线雷区**：读 [docs/postmortem/README.md](./docs/postmortem/README.md)。
4. **修改代码**：遵循 [docs/engineering/code-style.md](./docs/engineering/code-style.md) 与 [docs/ui-design/](./docs/ui-design/)。
5. **验证**：

   ```bash
   bun run check
   bun run build
   bun run db:verify       # 改 ingest / 数据时
   bun run db:query        # 改查询层时
   bun run test:smoke      # 改路由时，先启动 preview
   ```

   手工冒烟路径见 [docs/engineering/release-checklist.md](./docs/engineering/release-checklist.md)。
6. **Commit**：Conventional Commits，先定 message 再写代码。
7. **复盘**：新 Bug 模式写 postmortem；审查问题登记 backlog。
