# SSG 与每日增量更新

调研日期：2026-11-02（JST）。对象：`main` 分支的 React Router 8 + Vite 8 站点。

## 结论

- SSG 可行。首选 React Router 8 framework mode 的 `ssr: false` + `prerender`。`@react-router/dev@8.5.1` 的 peer 已支持 Vite 8 与 TypeScript 7。
- 全量 SSG 的成本不在构建时间。本地完整 build 20.1 秒；Vercel 控制台显示 Build 20 秒、Post-Build 18 秒、Billable Duration 1 分钟、CPU 2 分钟（2 vCPU）。
- 成本在数据层。构建期只有 `index` / `manifest` / `insights`，没有 datapack。要渲染完整单场页，需要改数据获取、SEO 与 hydration。
- 每日增量更新先做「数据增量 + 有变化才触发完整重建」。数据侧保持现有的按成员、按场次增量；前端侧不先做增量静态生成。
- 如果希望数据页与代码部署解耦，SPA + 部分 SSG 更合适：Vercel 只发 shell 与 assets，R2 发单场页与 sitemap，用 rewrite 同源反代。代价是稳定入口、代理缓存与模板版本管理。
- 只有构建时间明显增长，或 Vercel 2048 routes 限制成为问题时，再做 `generate-seo --changed` 与 prebuilt 部署。

## 现状

### 页面与构建

2026-11-02 实测：

| 项 | 数值 |
| --- | --- |
| 预渲染 HTML | 1937 个 |
| sitemap URL | 1932 条 |
| 单场页 | 1900 个 |
| `compare` 页 | 5 个，`noindex`，不进 sitemap |
| `dist/` | 27.2 MB |
| `dist/` 内 HTML | 16.2 MB |
| 本地完整 build | 20.1 秒 |
| 其中 Vite build | 2.82 秒 |
| 其中 `generate-seo` | 1.9 秒 |
| Vercel Build | 20 秒 |
| Vercel Post-Build | 18 秒 |
| Vercel Billable Duration | 1 分钟 |
| Vercel CPU | 2 分钟（2 vCPU） |

本地 build 包含 `sync:data`、图标生成、`tsc -b`、`vite build` 与 `generate-seo`，数字来自 Windows 本机的一次完整运行。Vercel 数字来自 2026-11-02 的构建记录。

### 数据规模

| 项 | 数值 |
| --- | --- |
| 成员 | 5 个 |
| manifest | 每人约 0.74 MB，合计约 2.5 MB |
| insights | 每人约 30 KB |
| datapack | 1900 场，合计约 159 MB，平均约 80 KB/场 |
| `public/data/` | 3.7 MB，只含 index / manifest / insights / 逐字稿索引 |

### 数据链路

```text
data/<id>/*.datapack.json
  → scripts/publish-data.ts 派生 manifest + insights + 组级文件
  → 对象存储（R2）
  → 浏览器运行时读取

构建：
  scripts/sync-data.mjs 拉 index / manifest / insights 到 public/data/
  → vite build
  → scripts/generate-seo.ts 写每路由 HTML + sitemap.xml + robots.txt
  → dist/
```

`daily-update.ts` 已经做了数据侧增量：

- 先拉频道 `/streams`，和远端 manifest 求差集。
- 只恢复有变化的成员，只抓 `newIds` 与 `forceIds`。
- 没有新场次、也没有待补数据时不恢复、不发布。
- `localAhead` 时补发布，避免上次发布失败把改动卡在本地。
- 失败会开 issue，不会静默断更。

### 当前缺口

`.github/workflows/data.yml` 里没有部署步骤。数据每天更新到 R2，但 `dist/` 只在代码部署时重建。

2026-11-02 的线上 sitemap 是 1923 条；本地重新 build 后是 1932 条。差的 9 条是 10-30 之后新增、但还没进入静态页与 sitemap 的场次。

这个缺口与是否上 SSG 无关。即使继续用现在的 CSR，静态 head 与 sitemap 也需要一次构建才能刷新。

### 与 SSG 相关的现状

| 项 | 现状 |
| --- | --- |
| 路由 | `src/router.tsx` 的 `createBrowserRouter` |
| 数据 | `useDatasetIndex` / `useDataset` / `useStreamPacks`，全部运行时 fetch |
| SEO | `useSeo` 在 `useEffect` 里写 title / canonical / OG |
| 入口 | `createRoot` 替换 `#root`；`#root` 里预埋了一个静态 H1 |
| 图表 | `ChartCanvas` 在宽度为 0 时渲染空，服务端安全 |
| 构建期数据 | `index` / `manifest` / `insights`，没有 datapack |

## SSG 可行性

### 框架能力

React Router 8 的 framework mode 提供：

- `react-router.config.ts` 的 `appDirectory`、`buildDirectory`、`basename`、`prerender`、`prerender.concurrency`。
- `ssr: false` + `prerender` 输出每个路径的 HTML 与 `.data`，并生成 SPA fallback。
- prerender 使用路由的 `loader`，构建时执行；动态路径由 `prerender` 函数返回 URL 列表。
- `react-router.config.ts` 可以把 `appDirectory` 指到 `src`，不需要把代码搬进 `app/`。

### 数据范围

构建期能拿到 `manifest` 与 `insights`，拿不到 datapack。可行的静态内容范围：

- 单场页：标题、日期、时长、平均 / 峰值同接、弹幕、SC、播放 / 点赞快照、评论数、封面、前后场次链接。
- 成员页 / 栏目页：场次数、最近场次、月度聚合、Top 榜。
- 逐分钟曲线、逐字稿、评论明细仍由运行时 datapack 提供。

不建议把 datapack 打进构建产物：

- 当前 `dist/` 是 27 MB；把 159 MB datapack 放进去会超过 180 MB。
- 静态 HTML 里的数据会在下一次发布后过期。
- 单场页只需要摘要，曲线继续按需拉取。

### Hydration 审计

| 位置 | 现状 | SSG 影响 | 处理 |
| --- | --- | --- | --- |
| `src/main.tsx` | `createRoot` | 会丢弃服务端 HTML | 改成 `hydrateRoot` |
| `src/hooks/use-theme.ts` | 初始化读 localStorage / matchMedia | 服务端 light，客户端可能 dark，hydration mismatch | 在 `<head>` 内联脚本先定主题；初始 state 读全局标记 |
| `src/hooks/use-dataset-index.ts` | `useState` 初始化读 sessionStorage | 服务端 null，客户端有缓存，首屏树不同 | 缓存读取移到 `useEffect`，或由 loader 提供初始数据 |
| `src/components/ui/sidebar.tsx` | `SidebarMenuSkeleton` 用 `Math.random()` | 宽度不一致 | 固定宽度，或只在客户端渲染 |
| `src/hooks/use-seo.ts` | `useEffect` 写 head | 构建时不会执行 | 改成路由 `meta`，由 `buildSeo()` 生成 |
| `index.html` 的 `#root` | 预埋静态 H1 | React 首次渲染会替换，hydration 不一致 | 删掉预埋 H1，交给 React |
| `src/components/charts/chart-canvas.tsx` | 宽度为 0 时渲染空 | 无 | 保持 |
| `src/hooks/use-media-query.ts` | `getServerSnapshot` 返回 false | React 会先用水合快照再更新 | 保持 |

`copy-link-button`、`transcript-view`、`streams-view` 里的 `window` / `document` 都在事件或 effect 内，不参与首屏渲染。

### 输出与托管

framework mode 的静态产物在 `build/client`（可能还有构建期用的 `build/server`）。需要：

- `vercel.json` 的 `outputDirectory` 改成 `dist/client`。
- rewrite 指向 `__spa-fallback.html`，而不是根 `index.html`。
- `sitemap.xml` / `robots.txt` / 图标 / `data/` 快照写进 client 目录。
- 子路径部署要验证 `basename` 与 prerender 路径的拼接。
- Vercel 的 2048 routes 限制：当前 1937 个 HTML 已经接近上限。静态文件是否计入 routes 需要看部署详情；如果计入，余量只有约 110 个页面，需要改成部分预渲染或增量构建。

## 方案对比

| 方案 | 迁移范围 | 产物 | 判断 |
| --- | --- | --- | --- |
| React Router 8 framework mode | 路由表、数据 loader、SEO meta、hydration、输出目录 | HTML + `.data` + SPA fallback | 真正 SSG 的首选；官方能力齐全 |
| 自定义 `renderToString` + 数据注入 | 自己实现 static router、数据注入、hydration | 自管 HTML | 不引入 `@react-router/dev`，但 hydration / 序列化全部自己维护，风险高 |
| 静态内容注入 | 扩展 `generate-seo.ts`，继续 `createRoot` 替换 `#root` | 现有 HTML 里多一段正文 | 只解决 SEO 内容与内链，不是 SSG；风险最低 |
| Vike | 文件路由、`+data`、布局 | HTML + 客户端 bundle | 支持 partial prerender；需要从 RR 迁走，且仍是 0.x |
| Astro | 重写页面与布局，React 组件做 island | 静态 HTML + islands | 适合内容站，不适合交互仪表盘 |
| TanStack Start | 从 RR 迁到 TanStack Router | HTML + 数据文件 | 支持静态预渲染，但迁移距离比 RR 自带 prerender 更远 |
| Next.js static export | 整体重写路由与数据层 | HTML | 没有 ISR，收益不抵成本 |

### 方案说明

**React Router framework mode**

优点：

- 与现有 React Router 8 同源，路由、链接、错误边界、懒加载都有对应写法。
- `prerender` 支持并发、动态路径、SPA fallback。
- loader 在构建时执行，`clientLoader` 可以在运行时刷新数据。
- 路由 `meta` 可以直接复用 `buildSeo()`。

代价：

- `createBrowserRouter` 要改成 `routes.ts` + `root.tsx`。
- 数据 hooks 要拆成 loader / clientLoader。
- `useSeo` 的职责迁移到路由 `meta`。
- `createRoot` 改 `hydrateRoot`，处理主题、sessionStorage 与随机宽度。
- 输出目录、Vercel rewrite、`generate-seo` 的写入路径都要改。

**静态内容注入**

在现有 `generate-seo.ts` 里，把 manifest 派生的一段正文写进 `#root` 之外：

- 指标表、日期、时长、前后场次链接、成员页入口。
- 继续用 `createRoot` 替换 `#root`，不涉及 hydration。
- 构建时间几乎不变，不改变托管配置。

它不会让首屏变成服务端渲染，但能解决「单场页静态正文太薄」与「静态内链太弱」两个 SEO 问题。

**Vike**

Vike 提供「给现有 Vite 应用加 SSR/SSG」的路径，支持 partial prerender 与 `onBeforePrerenderStart()`。代价是把 RR 路由改写为文件路由，并接受另一套数据与 head 约定。适合以后想要 SSR、但不想用 React Router framework mode 的情况。

**不推荐**

- Astro：仪表盘的筛选、路由、图表状态都要用 island 重写，收益主要在内容站。
- TanStack Start：静态预渲染可用，但从 RR 8 迁到 TanStack 的距离大于直接用 RR 的 `prerender`。
- Next.js static export：需要重写路由与数据层，且没有 ISR。

## SPA + 部分 SSG（R2 托管单场页）

这个方案把页面分成两类：

- 组首页、成员页、栏目页：Vercel 上的静态 shell，客户端拉数据渲染。
- 单场页：CI 生成静态 HTML，上传 R2，Vercel 用 rewrite 同源反代。
- sitemap：CI 生成，上传 R2，`/sitemap.xml` rewrite 过去。

### 请求路径

```text
https://ymmt.chilfish.top/
  ├─ /                          → Vercel dist/index.html（shell）
  ├─ /nonoka                    → Vercel dist/nonoka/index.html（shell）
  ├─ /nonoka/streams            → Vercel shell
  ├─ /nonoka/stream/<id>        → rewrite → R2 pages/nonoka/stream/<id>/index.html
  ├─ /sitemap.xml               → rewrite → R2 sitemap.xml
  ├─ /assets/*                  → Vercel 不可变资源
  └─ 其他路径                    → Vercel SPA fallback
```

单场页不要 301 到 R2 域名。重定向会改变 URL，canonical、外链与搜索权重都会落到 R2 域名上。用 `rewrite` 反代，浏览器地址仍是主域名。

成员页与组首页的静态 head 不要写死每日数字。日更数据由客户端读取；静态 head 用通用描述，避免 shell 与 R2 单场页的数据日期不一致。

### 为什么适合这个项目

- 单场页内容只在新增或重抓时变化，适合不可变静态对象。
- 新场次发布后，CI 直接写 R2，不必等 Vercel 构建。
- 单场页不进入 Vercel 部署，2048 routes 限制只约束 shell 页面。
- R2 上不存在的单场直接 404，顺手解决现在的软 404。

### 关键问题：asset hash

当前 Vite 产物是 `assets/index-<hash>.js` 与 `assets/index-<hash>.css`。R2 上的旧 HTML 如果引用旧 hash，代码部署后新部署里不一定还有这些文件，页面会白屏。

两种处理：

1. **稳定入口（推荐）**：让 Vite 输出固定的 `/app.js` 与 `/app.css`，chunk 仍带 hash。
   - `app.js` / `app.css` 用 `Cache-Control: no-cache`，`assets/*` 保持 immutable。
   - R2 单场页模板固定引用 `/app.js` 与 `/app.css`，代码部署后旧页面自然加载新入口。
   - 入口放在 `assets/` 之外，避免被现有 `/assets/(.*)` 的 immutable 规则覆盖。
   - CSS 默认会按路由拆成多个文件。用 `build.cssCodeSplit: false` 合成单个 `app.css` 最省事，代价是首屏 CSS 略大；也可以只给主 CSS 固定名称，其余保持 hash。
2. **代码变更后全量重生成**：保留 hash 文件名，每次代码部署后对所有单场页跑一次 `--all`。实现简单，但要保证部署与重生成的顺序，旧页面在两者之间可能白屏。

如果不想改 Vite 入口名，也可以放一个固定 `/bootstrap.js`，读取 `/asset-manifest.json` 后再加载当前 hash 的入口与 CSS。多一层运行时查找，不如稳定入口直接。

### Vercel 配置

```json
{
  "trailingSlash": false,
  "rewrites": [
    {
      "source": "^/sitemap\\.xml$",
      "destination": "https://data.example.com/stream-dashboard/sitemap.xml"
    },
    {
      "source": "^/([^/]+)/stream/([^/]+)$",
      "destination": "https://data.example.com/stream-dashboard/pages/$1/stream/$2/index.html"
    },
    {
      "source": "/((?!assets/|data/|avatars/|.*\\.(?:png|jpg|jpeg|webp|svg|ico|xml|txt|webmanifest|json)$).*)",
      "destination": "/index.html"
    }
  ]
}
```

说明：

- 把更具体的规则放在 SPA fallback 前面。如果 Vercel 实际的匹配顺序不符合预期，改用 `routes` 的 `handle: filesystem` 明确分层。
- Vercel 先查文件系统。`dist/` 里不能再有 `<id>/stream/**/index.html` 与 `sitemap.xml`，否则文件会命中，rewrite 不生效。
- 正则捕获组用 `$1` / `$2`。实际写法以 Vercel 当前语法为准；如果正则不生效，可以改用 `/:datasetId/stream/:videoId`。
- 外链目标写公开的 R2 自定义域名，不写凭据。域名或前缀变化时同步改 `vercel.json`。

缓存与头部：

```json
{
  "headers": [
    {
      "source": "/:datasetId/stream/:videoId",
      "headers": [
        { "key": "CDN-Cache-Control", "value": "public, max-age=300" },
        { "key": "Cache-Control", "value": "public, max-age=300" }
      ]
    },
    {
      "source": "/sitemap.xml",
      "headers": [
        { "key": "CDN-Cache-Control", "value": "public, max-age=300" }
      ]
    },
    {
      "source": "/app.js",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }]
    },
    {
      "source": "/app.css",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" }]
    }
  ]
}
```

Vercel 对外部 rewrite 的缓存行为：

- 2026-04-06 之后创建的项目默认读取上游的 `Cache-Control` / `CDN-Cache-Control`。
- 更早的项目要么在控制台开启，要么加 `x-vercel-enable-rewrite-caching: 1`。
- 单场页 TTL 用 5 分钟，避免重抓后长时间看到旧指标。
- sitemap TTL 用 5 分钟，缓存最多延迟 5 分钟；搜索引擎何时抓取由各家的调度决定。
- R2 侧如果也能配缓存，保持一致；两边不一致时以 Vercel 的 `CDN-Cache-Control` 为准。

### CI 生成单场页

新增 `scripts/generate-stream-pages.ts`：

- 输入 `data/.update-report.json` 的 `newIds` / `forceIds`；`--all` 时处理全部单场。
- 读取 `data/<id>/manifest.json`（`publish:data` 已写回本地），不依赖 `public/data`。
- 用 `buildSeo()` 生成 head / canonical / OG / JSON-LD。
- 正文写 manifest 能提供的部分：日期、时长、平均 / 峰值同接、弹幕、SC、播放 / 点赞快照、评论数、封面、前后场次、成员入口、YouTube 原片链接。
- 输出到 `dist-stream/<id>/stream/<videoId>/index.html`，再上传到 R2
  `pages/<id>/stream/<videoId>/index.html`，`Content-Type: text/html; charset=utf-8`。
- 生成完整 sitemap，上传到 R2 `sitemap.xml`，`Content-Type: application/xml`。
- 用 `data/.stream-pages-state.json` 记录 HTML 摘要，未变化的不重传。
- 模板版本变化或代码改动时跑 `--all`；日常只跑变化的场次。
- `verify:seo` 要拆开：Vercel build 校验 shell / robots / canonical；R2 侧校验单场页与 sitemap 条数。

模板固定在 `scripts/templates/stream-page.html`，包含：

- `/app.css`、`/app.js`、主题预置脚本、favicon、manifest。
- `#root` 内放静态正文。当前 `createRoot` 会替换它；如果以后改成 `hydrateRoot`，静态正文必须与 React 首屏树一致。
- 静态正文里的链接用主域名路径，不用 R2 域名。

### sitemap

- 每天从全部本地 manifest 重新生成，1932 条 URL 左右，约 200 KB。
- `lastmod` 用 `stream.generatedAt`。
- 成员页与组页是 Vercel shell，日更不会重建；它们的 `lastmod` 用 shell 构建时间或直接省略，不要用 `manifest.generatedAt`，否则会告诉 Google 页面每天都变了。
- `robots.txt` 继续放在 Vercel，指向 `/sitemap.xml`。
- R2 上覆盖 `sitemap.xml`；Vercel 的 5 分钟缓存足够。
- 如果以后超过 50,000 条或 50 MB，再拆 sitemap index。

### 404 与直接访问

- R2 没有对象时返回 404，Vercel 反代后也是 404；不再出现「未知单场返回首页 200」。
- 如果 Vercel 缓存了 404，新页上传后可能有最多 5 分钟不可见；必要时缩短 TTL 或上传后 purge。
- 单场页删除或下架时，删除 R2 对象，并让 sitemap 排除该 URL。
- R2 公开域名可能被直接访问。canonical 指向主域名，另外尽量不要在主站外链接 R2 域名；需要时可以在 R2 前面加一层 Worker 或访问规则。

### 取舍

优点：

- 数据页与代码部署解耦。新场次发布后不需要 Vercel 构建。
- 单场页是普通静态对象，便于备份、迁移和批量重建。
- Vercel 只保留 shell 与 assets，部署体积和 route 数都更小。
- 软 404 与 sitemap 新鲜度一起解决。

代价：

- 多一层托管与反代，排障要同时看 CI、R2、Vercel。
- 稳定入口、模板版本、R2 上传状态都需要维护。
- 外部 rewrite 的缓存行为与项目创建时间有关，需要实测。
- 代码改动模板时要全量重生成，否则旧页面会停留在旧结构。
- R2 不可用时单场页直接 404，Vercel shell 仍可用。

适用判断：

- 如果每天一次 20 秒的 Vercel 构建可以接受，完整重建仍然更简单。
- 如果希望数据页不受代码部署影响、单场页长期不可变、或页面数继续增长，这个混合方案更合适。

### 落地顺序

1. 先做稳定入口：`/app.js`、`/app.css`，并验证旧 hash 资源不会再被单场页引用。
2. 给 `generate-seo.ts` 加 `--no-streams` / `--no-sitemap`，Vercel 构建只生成 shell 与 `robots.txt`。
3. 用 `--all` 生成一轮单场页到 R2，在 preview 环境配置 rewrite 验证。
4. 验证 canonical、404、缓存头、App 在 R2 页面上正常启动。
5. 切生产 rewrite，移除 `dist` 里的单场页与 `sitemap.xml`。
6. 数据任务增加单场页生成与 sitemap 上传；先手动触发，再接入每日流程。
7. 代码改动后跑一次 `--all`，或者把模板版本写进状态文件，版本变化时自动全量。

## 推荐路线

三条路线按成本从低到高排列：

| 路线 | 适合 | 代价 |
| --- | --- | --- |
| 完整重建 | 现在，先修新鲜度 | 简单；每天一次 20 秒构建 |
| R2 混合 | 数据页与代码部署解耦、页面继续增长 | 稳定入口、反代缓存、模板版本 |
| 全站 SSG | 想统一渲染与首屏 | 数据 loader、SEO meta、hydration 改造 |

下面的阶段先按「完整重建 + 全站 SSG」展开。如果选择 R2 混合，用上面的「SPA + 部分 SSG」1–7 步替代第一、二阶段。

### 第一阶段：修静态内容的新鲜度

先做与 SSG 无关的部分：

1. `daily-update` 输出 `update-report.json`。
2. 数据任务有变化时触发 Vercel 部署。
3. Vercel 完整重建，刷新 sitemap 与所有静态 head。

这一阶段不改变页面架构，解决当前线上 sitemap 与静态页落后于数据的问题。

### 第二阶段：补静态正文与内链

如果目标是搜索收录，优先扩展 `generate-seo.ts`：

- 单场页写入指标表、日期、时长、前后场次链接。
- 成员页写入最近场次与栏目入口。
- `noscript` 从几行摘要扩展为可读的静态正文。

这一阶段不引入 hydration，风险最低。

### 第三阶段：SSG PoC

选 3 条路由做 React Router framework mode 的 PoC：

- `/`：组首页。
- `/nonoka`：成员页。
- `/nonoka/stream/W0bKqP-Eyj4`：单场页。

验证：

- `react-router build` 的实际耗时。
- `build/client` 的体积与 `.data` 总量。
- hydration 是否还有 mismatch。
- Vercel 的 route 数量是否接近 2048。
- 子路径 `VITE_BASE=/dashboard/` 是否正常。

PoC 通过后再决定全量 SSG 还是「栏目页 + 最近场次」部分 SSG。

### 第四阶段：增量静态生成

只有出现以下情况才做：

- 完整 build 超过 5 分钟。
- 预渲染页面数接近或超过 Vercel 2048 routes。
- 每天需要部署多次。

做法：

- `generate-seo --changed <report>` 只重写变化的单场页、受影响的成员页与组页。
- 始终重写 sitemap。
- 复用上一次的 `dist/`，代码未变时跳过 `vite build`。
- 用 `vercel deploy --prebuilt --prod` 部署合并后的产物。
- 每周做一次完整重建，清理漂移。

现在不做这一步。Vercel 完整 build 20 秒，增量合并的复杂度换不到相应收益。

## 每日增量更新方案

### 目标

- 数据仍然按成员、按场次增量更新。
- 前端只在数据或代码发生变化时重建。
- 新场次在当天的静态页与 sitemap 里出现。
- 失败时保留上一次可用的站点，不发布半成品。

### 数据层

保持 `daily-update.ts` 现有的筛选与发布逻辑，只增加一份运行报告。

报告写到 `data/.update-report.json`。`data/` 由 Actions cache 跨运行保留，报告可以跟着缓存走。

```json
{
  "schema": "yumemita.update-report/v1",
  "startedAt": "2026-11-03T05:20:00+09:00",
  "finishedAt": "2026-11-03T05:34:00+09:00",
  "changed": true,
  "published": 3,
  "failures": 0,
  "structural": false,
  "datasets": {
    "nonoka": {
      "newIds": ["W0bKqP-Eyj4"],
      "forceIds": ["_P5EIkEjYhk"],
      "deferredIds": [],
      "published": true,
      "manifestGeneratedAt": "2026-11-03T05:32:00+09:00",
      "error": null
    }
  }
}
```

字段口径：

| 字段 | 含义 |
| --- | --- |
| `changed` | 本次是否有新场次、重抓、补发布或成功发布 |
| `published` | 成功发布的成员数 |
| `failures` | 成员级失败数 |
| `structural` | `data-sources.json` 增删成员、下架数据集等需要完整重建的变化 |
| `datasets[].newIds` | 本次新增的 videoId |
| `datasets[].forceIds` | 本次重抓的 videoId |
| `datasets[].deferredIds` | 未来场 / 直播中 / 同名摘要，本轮未处理 |
| `datasets[].manifestGeneratedAt` | 发布后的 manifest 时间，用于静态页 `lastmod` 与增量构建 |

实现要点：

- 在 `main()` 外层用 `try/finally`，无论成功或失败都写报告。
- 每处理完一个成员就更新报告，避免中途失败丢全部信息。
- `structural` 由 `data-sources.json` 的 id 集合与远端 `index.json` 比较得出；新增成员、删除成员或配置变更时为 true。
- 报告文件不进 git；`data/` 已经在 `.gitignore` 里。
- `publish:data` 不需要重复报告；`daily-update` 汇总即可。
- 手动 `publish:data` 后不会自动部署；需要时在 Vercel 控制台或本地触发一次部署。

### 前端层

下面的 `deploy` job 是完整重建路线。如果采用 R2 混合，用 `pages` job 替代：只生成 `newIds` / `forceIds` 的单场页与 sitemap，上传 R2，不触发 Vercel 构建；Vercel 只在代码变更或 `structural=true` 时部署。

在 `data.yml` 增加一个 `deploy` job：

```yaml
jobs:
  update:
    outputs:
      changed: ${{ steps.report.outputs.changed }}
      published: ${{ steps.report.outputs.published }}
      structural: ${{ steps.report.outputs.structural }}
    steps:
      # ...现有步骤...
      - name: Read update report
        id: report
        if: always()
        run: |
          report=data/.update-report.json
          if [ -f "$report" ]; then
            echo "changed=$(jq -r '.changed // false' "$report")" >> "$GITHUB_OUTPUT"
            echo "published=$(jq -r '.published // 0' "$report")" >> "$GITHUB_OUTPUT"
            echo "structural=$(jq -r '.structural // false' "$report")" >> "$GITHUB_OUTPUT"
          else
            echo "changed=false" >> "$GITHUB_OUTPUT"
            echo "published=0" >> "$GITHUB_OUTPUT"
            echo "structural=false" >> "$GITHUB_OUTPUT"
          fi

  deploy:
    needs: update
    if: |
      always() && !cancelled()
      && needs.update.outputs.changed == 'true'
      && needs.update.outputs.published != '0'
      && (github.event_name == 'schedule' || inputs.deploy != false)
    concurrency:
      group: frontend-deploy
      cancel-in-progress: false
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Trigger Vercel deploy
        env:
          VERCEL_DEPLOY_HOOK_URL: ${{ secrets.VERCEL_DEPLOY_HOOK_URL }}
        run: |
          if [ -z "$VERCEL_DEPLOY_HOOK_URL" ]; then
            echo "::error::Missing VERCEL_DEPLOY_HOOK_URL secret"
            exit 1
          fi
          curl --fail --silent --show-error --request POST "$VERCEL_DEPLOY_HOOK_URL" > /tmp/deploy.json
          cat /tmp/deploy.json
```

`workflow_dispatch` 增加一个布尔输入：

```yaml
inputs:
  deploy:
    description: 数据更新后触发前端部署
    type: boolean
    default: true
```

部署任务只调用 Vercel Deploy Hook。Vercel 自己执行 `bun run build`：

```text
Checkout
  → bun install
  → sync:data（从 R2 拉最新 index / manifest / insights）
  → vite build
  → generate-seo（1932+ 条 URL）
  → verify:seo
  → dist/
```

数据不需要提交到 git。每次部署都从 R2 读取最新快照。

### 触发规则

| 情况 | 是否部署 |
| --- | --- |
| 有新场次，发布成功 | 是 |
| 只有 `forceIds` 重抓，发布成功 | 是；静态指标与 `lastmod` 一起刷新 |
| `localAhead` 补发布成功 | 是 |
| 没有变化 | 否 |
| 所有成员都失败 | 否 |
| 部分成员失败，至少一个发布成功 | 是；失败成员由 issue 跟进 |
| `structural=true` | 是；必须完整重建 |
| `workflow_dispatch` 关闭 `deploy` | 否 |

### 为什么先做完整重建

- Vercel Build 20 秒，Post-Build 18 秒；每天一次的成本低于维护增量构建。
- 完整重建不会留下旧页面、重复页面或 sitemap 与 HTML 不一致的问题。
- 增量静态生成要处理缓存、合并、删除、route 数量与 prebuilt 部署，复杂度和收益不匹配。
- Vercel Hobby 每天 100 次部署、每小时 60 次 Deploy Hook，当前每天 1 次远低于限制。

### 什么时候改成增量静态生成

出现以下任一情况再考虑：

- 完整 build 超过 5 分钟。
- 预渲染页面数接近 Vercel 的 2048 routes。
- 每天需要部署多次，或需要按成员单独部署。

届时的最小方案：

1. 用 `update-report.json` 的 `newIds` / `forceIds` / `manifestGeneratedAt` 算出受影响的路径。
2. `generate-seo --changed` 只写这些路径；组首页、全组相册、sitemap 每次重写。
3. 从 Actions cache 恢复上一次的 `dist/`；代码未变时复用 `dist/assets`。
4. `vercel deploy --prebuilt --prod`。
5. 每周或每次代码变更做一次完整重建。

这条路线需要 `VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`，与现在的 Deploy Hook 是两套凭据。

### sitemap 与 `lastmod`

- 完整重建时，sitemap 从最新 manifest 生成，条数应等于 `2 + 6 × 成员数 + 单场数`。当前是 `2 + 30 + 1900 = 1932`。
- 单场页的 `lastmod` 建议改用 `stream.generatedAt`，它比开播日期更接近数据的实际更新时间。
- 如果无法保证 `lastmod` 准确，宁可不写。Google 只在 `lastmod` 持续准确时使用它。
- 成员页与组页在完整重建时用 `manifest.generatedAt`；如果是 R2 混合里的静态 shell，改用 shell 构建时间或省略。

### IndexNow

完整重建后，可以用 `update-report.json` 的 `newIds` / `forceIds` 通知 IndexNow：

- 在 `public/<key>.txt` 放 IndexNow key 文件。
- 新增 `scripts/indexnow.ts`，读取报告，向 `https://api.indexnow.org/indexnow` 批量提交变化的 URL。
- 单次不超过 10,000 条；同一个 URL 5 分钟内不要重复提交。
- IndexNow 参与方包括 Bing、Yandex、Naver、Seznam、Yep；Google 不支持，仍依赖 sitemap 与 Search Console。
- 百度的普通收录 API 与 sitemap 提交单独处理。

### 明日执行顺序

2026-11-03 的下一次定时任务：

1. 确认 GitHub Secrets 有 `VERCEL_DEPLOY_HOOK_URL`，仓库变量有 `VITE_DATAPACK_BASE`。
2. `data.yml` 的 `update` job 按现有流程拉频道列表、抓新场次、发布 R2。
3. `Read update report` 读取 `data/.update-report.json`，输出 `changed` / `published` / `structural`。
4. `deploy` job 满足条件时调用 Vercel Deploy Hook。
5. Vercel 执行完整 build，`sync:data` 拉到当天数据。
6. 部署后检查：

```bash
# sitemap 条数：2 + 6 × 5 + 单场数
curl -s https://ymmt.chilfish.top/sitemap.xml | grep -c '<loc>'

# 新场次页的 canonical 与 robots
curl -s https://ymmt.chilfish.top/<dataset>/stream/<videoId> \
  | grep -E 'rel="canonical"|name="robots"'

# 本地同款校验
bun run verify:seo
```

7. 如果 `deploy` 失败，Vercel 保留上一次部署；修复后重新触发。数据已经在 R2，站点旧静态页仍可运行。

如果采用 R2 混合，第 4–5 步换成：

1. `pages` job 读取报告，只生成 `newIds` / `forceIds` 的单场页。
2. 上传 HTML 到 R2 的 `pages/<id>/stream/<videoId>/index.html`。
3. 生成完整 sitemap，上传 R2 的 `sitemap.xml`。
4. 不触发 Vercel 构建；代码变更与新增成员才需要构建。

### 失败与回滚

| 失败点 | 结果 | 处理 |
| --- | --- | --- |
| 频道列表失败 | 该成员可能漏新场次，报告记失败 | 看 issue 与 `Check YouTube access` 日志 |
| 抓取失败 | 该成员不发布，其余成员继续 | 修复后手动 `workflow_dispatch` |
| 发布失败 | 远端仍是上一版，报告记失败 | 检查 R2 凭据与完整性校验 |
| 部署 Hook 失败 | 旧部署继续服务 | 检查 Secret 与 Vercel 项目状态，重试 |
| Vercel build 失败 | 旧部署继续服务 | 看 Vercel 构建日志；`sync:data` 拉不到数据时加严格模式 |
| 报告丢失 | `changed=false`，不部署 | 下次运行会重新生成；必要时手动部署 |

建议给 `sync:data` 增加 `REQUIRE_REMOTE_DATA=1`：远端 index / manifest 拉取失败时直接退出，不落回旧缓存。Vercel 上用这个模式，避免把过期快照部署上线。

## 验收清单

- [ ] `data/.update-report.json` 在成功、部分失败、完全失败三种情况下都能生成。
- [ ] 无变化的一天不会触发部署。
- [ ] 有新场次的一天，sitemap 条数等于 `2 + 6 × 成员数 + 单场数`。
- [ ] 新场次页返回 200，canonical / `lastmod` / `robots` 正确。
- [ ] `verify:seo` 在 Vercel build 中通过。
- [ ] 部署失败时旧站点仍可访问。
- [ ] `REQUIRE_REMOTE_DATA=1` 时，远端不可达会让 build 失败，而不是发布旧快照。
- [ ] R2 单场页通过主域名返回 200，canonical 指向主域名，App 能正常启动。
- [ ] 不存在的单场返回 404，不再回退到首页。
- [ ] 代码部署后，旧 R2 单场页仍能加载新入口，不出现白屏。
- [ ] `x-vercel-cache` 与 `CDN-Cache-Control` 的行为符合预期。
- [ ] SSG PoC 记录 hydration mismatch 数、`.data` 体积、构建耗时与 Vercel route 数。

## 参考

- [React Router: Pre-Rendering](https://reactrouter.com/how-to/pre-rendering)
- [React Router: react-router.config.ts](https://reactrouter.com/api/framework-conventions/react-router.config.ts)
- [Vike: Pre-rendering (SSG)](https://vike.dev/pre-rendering)
- [Vike: Add SSR/SSG to existing Vite app](https://vike.dev/add)
- [Vercel: Limits](https://vercel.com/docs/limits)
- [Vercel: Rewrites](https://vercel.com/docs/routing/rewrites)
- [Vercel: CDN Cache](https://vercel.com/docs/caching/cdn-cache)
- [Google: Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- [Google: JavaScript SEO basics](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [IndexNow FAQ](https://www.indexnow.org/faq)
