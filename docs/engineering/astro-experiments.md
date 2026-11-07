# Astro 迁移实验与可复用模式

> 本文件记录模板 `starter-astro-react` 已验证过的 Astro 模式，以及本项目迁移时的落点。
> 这些模式已在本仓库落地；当前实现是 Astro 7 SSR + Cloudflare Workers + PostgreSQL。迁移决策见 [astro-ssr-migration.md](../planning/astro-ssr-migration.md)。
> 模板的原始实验记录：`starter-astro-react` 仓库的 `docs/engineering/astro-experiments.md`（本地路径 `D:\git\starter-astro-react\docs\engineering\astro-experiments.md`）。

## 一、可复用模式

| 模式 | 模板落点 | 本项目迁移落点 | 注意事项 |
| --- | --- | --- | --- |
| `output: 'server'` + 显式 `prerender` | `astro.config.mjs`、各页面 | 数据页 `prerender = false`；`/about`、404 预渲染 | 每页显式声明，漏写会变成按需渲染 |
| React 岛屿 | `Home.tsx`、`TableChart.tsx` | 图表、表格工具条、命令面板、对比选择 | 首屏正文不用 `client:only`；props 可序列化 |
| Server Island | `Stats.astro` + `server:defer` | 组首页统计 / 最近场次可拆成独立请求 | 必须提供 `slot="fallback"` |
| Actions + 缓存失效 | `src/actions/index.ts` | 内部 purge 端点或数据刷新动作 | Action 未鉴权前不要暴露敏感写入 |
| Cloudflare route caching | `cacheCloudflare()` + `routeRules` + `Astro.cache.set()` | 数据页、`.md`、sitemap 的 `maxAge` / `swr` / `tags` | Astro 7 仍标注 experimental；升级后复验 |
| 构建期 R2 读取 | Content Layer 自定义 loader | 逐字稿正文 / 归档读取（可选） | 构建期需要 R2 凭据；缺省回退本地 |
| 请求期 R2 读取 | Live Collection + R2 live loader | `.md` 端点读取逐字稿正文 | 优先用 R2 binding，避免运行时 S3 凭据 |
| `getStaticPaths()` | `[slug].astro` | 仅用于真正静态的页面；数据页不要用 | 数据页用 SSR，否则新场次要重建 |
| 中间件 | `src/middleware.ts` | request id、安全头、内部 purge 鉴权 | `_headers` 只作用于静态资源 |
| Workers 自定义入口 | `src/worker.ts` + `wrangler.jsonc` | `handle()` + 可选定时任务 | 抓取 / ingest 不适合放 Worker Cron |
| Fonts API | `astro.config.mjs` + `Layout.astro` | 复用模板字体配置 | 中文缺字走系统回退；需要时补 CJK subset |
| ClientRouter | `Layout.astro` | 站内导航、持久化主题与进度条 | 岛屿状态用 `transition:persist` 保留 |
| `astro:assets` | 文章封面 | 封面已由 R2 提供 WebP 变体，用 `<img srcset>` | 远端 R2 图片不必再走图片服务 |

## 二、迁移时要验证的行为

| 检查 | 预期 |
| --- | --- |
| `astro dev` / `astro preview` | 使用 Cloudflare workerd，本地与线上行为接近 |
| `prerenderEnvironment` | 只有构建期读 R2 / 文件系统时才需要 `'node'` |
| `Astro.cache.enabled` | dev 下为 `false`，缓存调用是 no-op；要验证需 build + preview |
| `Cf-Cache-Status` | 第二次请求 HIT / REVALIDATED；purge 后 MISS |
| `Vary` | `.md` 是独立 URL，不设 `Vary: Accept`；缓存变体不会爆炸 |
| `client:only` | 不用于首屏正文、SEO 内容或 `.md` 数据来源 |
| 岛屿 props | 只传普通对象；`Date`、函数、类实例不传 |
| 构建期模块缓存 | 不进入按需渲染路径，避免跨请求脏数据 |
| Worker CPU | 数据页 SSR 记录 CPU 与 wall time；Free 计划 10 ms 可能不够 |

## 三、模板已验证但本项目暂不采用

- **Cloudflare Markdown for Agents**：边缘 HTML → Markdown，不含逐字稿，且依赖 Pro/Business 计划。本项目用 `.md` 路由直接生成。
- **Astro Actions 作为公开写接口**：本项目没有用户写入需求；内部 purge 端点用 token 鉴权即可。
- **`client:only` 渲染 D3 表格**：现有图表是 D3 数学 + React DOM，服务端安全，不需要跳过 SSR。
- **Content Layer 作为主数据源**：本项目数据在 PostgreSQL；只有逐字稿 / 归档适合对象存储。

## 四、参考

- [Astro: Route caching](https://docs.astro.build/en/guides/caching/)
- [Astro: On-demand rendering](https://docs.astro.build/en/guides/on-demand-rendering/)
- [Astro: Endpoints](https://docs.astro.build/en/guides/endpoints/)
- [Astro: Middleware](https://docs.astro.build/en/guides/middleware/)
- [@astrojs/cloudflare](https://docs.astro.build/en/guides/integrations-guide/cloudflare/)
- [astro-ssr-migration.md](../planning/astro-ssr-migration.md)
