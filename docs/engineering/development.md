# 开发

> 代码规范摘要见 [code-style.md](./code-style.md)；本文保留环境、脚本、coss ui、D3 与测试的详细说明。
>
> **2026-11-03**：全部页面已迁到 Astro（`src/pages/*.astro` + `src/components/app/` 岛屿），旧 React Router 页面与 `generate-seo` / `sync-data` 已删除。下文的历史段落只作迁移对照。

## 环境

- **Bun ≥ 1.4**（推荐，仓库带 `bun.lock`）
- Node.js ≥ 22.22（Astro / Cloudflare 工具链需要）
- 阶段 0 不需要数据库；`.dev.vars.example` 已预留 `DATABASE_URL` 与 R2 变量

```bash
bun install
bun run dev
# http://localhost:4321
```

本地开发默认用本机 Postgres，避免把开发流量算进 Neon 出流量。一条命令即可拉起整条链路
（Postgres → 建库 / 迁移 → Neon HTTP 代理 → Astro）：

```bash
bun run dev           # Postgres / 代理缺失时自动启动，已有则复用
bun run dev:seed      # 可选：从本地 pack 灌数据
```

Astro 退出或被 kill 后，Postgres 与代理继续在后台运行；完整说明与排查见
[local-database.md](./local-database.md)。

## 脚本

| 命令 | 作用 |
| --- | --- |
| `bun run dev` | 开发入口：准备本地 Postgres / 库 / 代理，再用 Node 启动 Astro |
| `bun run build` | `astro build`，输出 Worker + 预渲染的 404 / 500 |
| `bun run preview` | 本地预览构建产物（workerd；复用后台的本地服务） |
| `bun run cf:preview` | 构建后预览，部署前检查 |
| `bun run cf:deploy` | `astro build` + `wrangler deploy --config dist/server/wrangler.json` |
| `bun run dev:db` | 只做本地库初始化：建库、应用迁移、补 `.dev.vars`（见 [local-database.md](./local-database.md)） |
| `bun run dev:db:proxy` | 单独前台启动本地 Neon HTTP 兼容代理（`dev` 会自动处理） |
| `bun run dev:seed` | 本地灌数据；参数同 `db:ingest` |
| `bun run db:generate` / `db:push` / `db:studio` | Drizzle 迁移工具 |
| `bun run db:migrate` | 应用 `drizzle/` 迁移（按 `.dev.vars` 与 `LOCAL` 选库） |
| `bun run db:ingest` | 本地 pack → PostgreSQL；支持 `--dataset` / `--ids` / `--limit` / `--all` / `--dry-run` |
| `bun run db:verify` | 数据库与本地 pack 字段级对账 |
| `bun scripts/suggest-collaborations.ts` | 扫 manifest 标题里的成员别名 / 组合名 tag 出联动场候选（只读；`--markdown` / `--json`） |
| `bun scripts/apply-collaborations.ts` | 一次性补丁：把联动登记写进目标库并刷新 public_totals（`--dry-run` / `--verify`） |
| `bun run db:query` | 查询层冒烟：列表 / insights / 组首页 / 相册 + 本地延迟 |
| `bun run perf:smoke` | 页面级性能冒烟：响应体大小 / 耗时中位数 / cache tag（先启动 preview 或 wrangler dev） |
| `bun run publish:assets` | 上传封面 / 表情 / archive（不写 JSON 索引） |
| `bun run purge:cache` | 按 tag 失效 Workers Cache |
| `bun run db:latest` | 输出数据库里最新一场（工作流探针） |
| `bun run validate:data` | 校验 pack 级 schema |
| `bun run add:datapack` | 加一份 datapack 并更新本地 manifest |
| `bun run typecheck` | `astro check`（TypeScript 6） |
| `bun run test` | Vitest 单次 |
| `bun run test:watch` | Vitest watch |
| `bun run test:smoke` | Worker 路由冒烟（需先起 dev/preview） |
| `bun run lint` | oxlint |
| `bun run check` | typecheck + test + lint |
| `bun run ci` | 全链路（CI 同款） |

## 数据库（阶段 1）

- Schema：`src/db/schema.ts`；迁移产物在 `drizzle/`，用 `bun run db:migrate` 应用。
- 读连接：`src/db/connection.ts` 的 `createDb()`，`drizzle-orm/neon-http`；Worker 用 `src/db/client.ts`。
- 写连接：同文件的 `createWriteDb()`，`drizzle-orm/neon-serverless` 的 WebSocket Pool；只在脚本里用。
- 本地开发：`DATABASE_URL` 指向 `localhost` 时，脚本自动切 `pg`；workerd 不能直连 TCP，`bun run dev` 会自动准备 `NEON_HTTP_ENDPOINT` 与代理。见 [local-database.md](./local-database.md)。
- 生产仍是 HTTP 读 + WebSocket 事务；不要把 `pg` 静态引入 Worker 产物。
- ingest：`scripts/ingest-db.ts`，一场一个事务，`content_hash` 增量；小批量 `--limit` 跳过 insights。
  - 全量回填可按 `--dataset <id>` 一个 dataset 一个进程并行；每个进程独立算该成员的 insights，互不覆盖。
  - `dataset_insights.public_totals` 由 ingest 用窄 SQL 聚合写入，页面汇总只读它；请求期不再加载明细。
- 对账：`scripts/verify-db.ts`，覆盖行数、`chat_total`、SC 币种、`paid_events`、`comments`、作者与词表；`dataset_insights` 用 `scripts/lib/json-equal.ts` 深比较（`jsonb` 不保留键顺序）。
- `DATABASE_URL` 从 `.dev.vars` 读取（`loadEnvFiles()`），运行环境里的同名变量优先；`LOCAL=0` 时取 `DATABASE_URL_ONLINE`；缺失时直接报错，不静默回退。
- 查询层：`src/db/queries/`，函数接收 `Db` 作为第一个参数（页面 / 脚本共用）；DTO 在 `src/types/db.ts`。
  - `batch.ts`：`runBatch()`，Neon HTTP 下用 `db.batch` 把多条只读 SQL 放进一次请求；本地 `pg` 回退并行。
  - `datasets.ts`：`selectDatasetsQuery` / `getDatasets` / `getDataset`
  - `streams.ts`：`buildStreamListQuery` / `listStreams`（需要总数时 `withTotal: true`）/ `buildAllStreamRefsQuery`（sitemap）/ `buildAllStreamHeadsQuery`（llms）/ `selectStreamQuery` / `getStream` / `getLatestStream`
  - `insights.ts`：`selectPublicTotalsQuery` / `getDatasetPublicTotals`
  - `packs.ts`：`getStreamPack`（单场 6 条查询一个 batch）/ `getStreamPacks`（多场一次 `inArray`）
  - `dataset-totals.ts`：`computeDatasetPublicTotals`（仅供 ingest / verify / refresh；窄 SQL 聚合词频、作者与汇总列，不还原 pack）
  - `group.ts`：`getGroupSummary` / `getGroupGallery`，查询构造函数供页面组合 batch
  - `transcripts.ts`：`getTranscriptIndex` / `getTranscriptMeta` / `selectTranscriptMetaQuery`（索引页与单场可用性）
  - `view-data.ts`：页面级组合（`getDatasetPageData` / `getGroupPageData` / `getComparePacks` / `getStreamPageExtras`）。
- `numeric` 列统一在查询层转成 `number | null`；时间列统一转成 ISO 字符串，不把 `Date` 传给岛屿。

## 代码组织

```text
src/
├─ types/           JSON schema 的 TS 镜像，不放逻辑
├─ lib/             纯函数，不 import React
│  ├─ data.ts       fetch / 并发加载（旧页面入口，阶段 1 后由查询层替换）
│  ├─ aggregate.ts  合并、聚合、找极值
│  ├─ routes.ts     URL 构造与对比 id 解析
│  ├─ table-params.ts 数据表 URL 参数解析/序列化
│  ├─ keyboard.ts   快捷键纯函数
│  └─ format.ts     数字 / 时间 / 币种格式化
├─ hooks/           异步状态、主题、尺寸、水合判定
├─ layouts/         Layout.astro：SEO、主题、ClientRouter、全局岛屿
├─ pages/           Astro 文件路由（.astro）；404 / 500 预渲染
├─ components/
│  ├─ charts/       D3 + SVG 图表
│  ├─ dashboard/    视图、Sidebar、Header、布局与 context（旧页面复用）
│  ├─ shared/       SEO.astro、ThemeProvider、ProgressBar、Spinner、ThemeToggle
│  └─ ui/           coss ui primitives（生成物）
├─ stores/          Zustand：主题等全局状态
├─ styles/app.css   Tailwind v4 + coss token + 动效
├─ middleware.ts    请求 id、安全头
├─ worker.ts        Cloudflare Worker 入口
└─ env.d.ts         Astro App.Locals 类型
```

### 约定

- **纯逻辑放 `lib/`**：聚合、格式化、排序都在这里；组件只做展示。
- **不写 `any`**：数据边界用 `src/types/*`；外部 JSON 先按类型断言，再由 `validate:data` 兜底。
- **空值显式处理**：`vstats`、`comments`、`avgConcurrent` 都可能是 `null`；图表要跳过或显示“—”。
- **文件命名 kebab-case**，导出组件 PascalCase，函数 camelCase。
- **导入用 `@/` 别名**（`@/lib/...`、`@/components/...`）。
- **样式用 Tailwind token**：`bg-background`、`text-muted-foreground`、`border`、`var(--chart-1)`；不要写死颜色。
- **组合用 `cn()`**：条件 class 统一走 `@/lib/utils`。
- **可访问性**：图标按钮要有 `aria-label`；图表 SVG 要有 `aria-label`；每个数据标记尽量有 `<title>`。

## coss ui

### 位置与升级

- 组件在 `src/components/ui/`，由 shadcn CLI + `@coss` registry 生成。
- `components.json` 里配置了 registry：`https://coss.com/ui/r/{name}.json`。
- **不要手改生成文件里的业务逻辑**；需要新组件时重新 add，或用 `render` / `className` 组合。

```bash
# 加单个 primitive
bunx --bun shadcn@latest add @coss/dialog -y

# 加整套 UI（会覆盖同名文件，先看 diff）
bunx --bun shadcn@latest add @coss/ui -y
```

### 本页用到的组件

`Sidebar` 系列、`Breadcrumb`、`Table`、`Badge`、`Button`、`Checkbox`、`Label`、`Input`、`ScrollArea`、`Alert`、`Skeleton`、`SegmentedControl`、`ToggleGroup`、`Meter`、`Kbd`、`Sheet`、`Tooltip`。

### 常见坑

- `Select` 用 **items-first**：`<Select items={items}>` + `<SelectItem value={item}>`；不要沿用 Radix 的纯 children 写法。
- `Button` 默认 `type="button"`；表单里要显式写 `type`。
- `Table` 自身不带排序/分页；场次表的筛选/排序状态存在 URL 里，由 `streams-page.tsx` + `lib/table-params.ts` 管理，`dashboard/streams/streams-view.tsx` + `dashboard/primitives/data-table.tsx` 是受控视图。
- 导航用 `SidebarMenuButton render={<NavLink to={...} />}`；active 状态自己算好传给 `isActive`，不要给 `NavLink` 传函数式 `className`。
- 侧边栏折叠样式靠祖先的 `group-data-[collapsible=icon]`；只在折叠时隐藏的内容加这个 class。

## 路由

- 当前用 Astro 文件路由：`src/pages/index.astro`（组首页）、`404.astro`、`500.astro`；稳定页面显式 `export const prerender = true`。
- 页面从 `src/lib/seo.ts` 的 `buildSeo()` 生成 `SeoMeta`，交给 `<Layout meta={meta}>` 输出 title / description / canonical / OG / JSON-LD。
- 旧 React Router 路由表与 `src/legacy/` 已删除；当前 URL 形态：`/:id` 成员首页、`/:id/streams?q=&type=&sort=&dir=&vstats=`、`/:id/trends`、`/:id/stream/:videoId?view=`、`/:id/compare?ids=a,b,c`、`/:id/about`；旧地址 `/:id/overview`、`/:id/table` 用 `Astro.redirect()`。
- 表格参数继续用 `parseTableParams` / `writeTableParams`（`lib/table-params.ts`）；岛屿内更新用 `history.replaceState`。

## D3 图表写法

### 基本骨架

```tsx
<ChartCanvas ariaLabel="..." height={300}>
  {({ width, height }) => {
    const margin = { top: 16, right: 16, bottom: 40, left: 48 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;
    const x = scaleLinear().domain([0, maxX]).range([0, innerWidth]);
    const y = scaleLinear().domain([0, maxY]).nice().range([innerHeight, 0]);
    return (
      <g transform={`translate(${margin.left},${margin.top})`}>
        {/* 网格 / 轴 / 数据标记 */}
      </g>
    );
  }}
</ChartCanvas>
```

### 规则

1. **React 拥有 DOM，D3 只算数学**；不要用 `d3-selection` / `select()` 操作节点。
2. 用 `ChartCanvas` 拿响应式宽度；不要自己写 ResizeObserver。
3. 用 `scaleLinear` / `scaleBand` / `scaleSqrt`；用 `line` / `area` / `pie` / `arc` 生成 path。
4. 颜色用 `CHART_COLORS`（映射到 `--chart-1..5`）。
5. 空数据用 `EmptyChart`；`null` 值跳过，不要画 0。
6. 每个 mark 加 `<title>`；SVG 加 `aria-label`。
7. 文本用 `className="fill-muted-foreground text-[10px]"` 等 token class。
8. 需要 hover / 触控提示时用 pointer 事件（`onPointerDown` / `onPointerMove`），不要只写 `onMouseMove`；给覆盖层加 `touchAction: "pan-y"` 保留纵向滚动。

### 现有图表

| 组件 | 用途 |
| --- | --- |
| `stream-bars.tsx` | 每场平均/最大同接，点击跳单场 |
| `chat-density.tsx` | 逐分钟弹幕 + SC 条 + hover |
| `ten-minute-bars.tsx` | 每 10 分钟弹幕量 + SC 点 |
| `scatter-plot.tsx` | 平均同接 × 每千同接弹幕 |
| `currency-donut.tsx` | SC 笔数按币种构成 |
| `top-bars.tsx` | 横向 Top 排行（词/发言者/徽章） |
| `multi-line-chart.tsx` | 多场逐分钟弹幕叠加 |
| `stream-shape.tsx` | 全部场次按直播进度对齐的典型节奏曲线（含 25–75 分位带） |
| `sparkline.tsx` | 迷你曲线 / 面积，供首页与行内复用 |
| `stream-timeline.tsx` | 单场双轨时间轴：弹幕面积 + SC 刻度 + 悬停读数 |
| `chart-frame.tsx` | 无卡片图表容器：标题 + 口径 + 动作 |
| `calendar-heatmap.tsx` | 按日热力图：场次 / 弹幕 / SC，横向滚动 + 原生 tooltip |
| `trend-line.tsx` | 月度趋势折线：单指标、空值断线、原生 tooltip |

## 加一个页面（Astro）

1. 在 `src/components/dashboard/<domain>/` 新建视图组件，props 只接收 `StreamRow[]` / `DatasetTotals` / 单场 `StreamRow`；落位规则见 [component-organization.md](./component-organization.md)。
2. 在 `src/pages/` 新建 `.astro`，用 `buildSeo()` 生成 meta，`<Layout meta={meta}>` 包住内容；数据页写 `export const prerender = false`。
3. 交互部分拆成岛屿（`client:visible` / `client:load`），props 只传可序列化数据；首屏正文由 `.astro` 输出。
4. 在 `src/lib/routes.ts` 的 `VIEWS` 加 key，并在 `dashboard/shell/app-sidebar.tsx` 的 `NAV_ITEMS` 加导航项。
5. 如果新视图需要新聚合，先在 `lib/aggregate.ts` 加函数和测试。
6. 新增页面按现有 Astro 结构实现，不要参考已删除的旧页面。

## 加一个聚合指标

1. 在 `src/lib/aggregate.ts` 的 `DatasetTotals` / `StreamRow` 里加字段。
2. 在 `aggregateDataset` 里计算；对 `null` 做显式处理。
3. 在 `src/lib/aggregate.test.ts` 加断言。
4. 在视图里消费；如需图表，按 D3 骨架新增组件。

## 测试

- `src/lib/format.test.ts`：格式化边界（null、时长、币种、JST）。
- `src/lib/aggregate.test.ts`：合并、合计、币种排序、Top 词/作者、最佳场次、峰值分钟。
- `src/lib/table-params.test.ts`：表格 URL 参数的默认值、非法值回退、序列化与往返。
- `src/lib/keyboard.test.ts`：快捷键的邻居索引、输入框判定与 ⌘K 判定。
- `src/lib/classify.test.ts`：标题类型规则与未匹配回退。
- `src/lib/routes.test.ts`：路由构造、子视图解析、对比 id 解析。
- 路由冒烟：`bun run test:smoke`（先启动 dev/preview，可通过 `--url` / `BASE_URL` 指定地址）。
- 组件不强制单测；交互复杂时再加 `@testing-library/react`。

```bash
bun run test
bun run test:watch
```

## 类型与构建

- `astro check` 是当前 typecheck 入口；它暂不支持 TypeScript 7，仓库锁定 TypeScript 6（与模板一致）。
- 路径别名只写在 `tsconfig.json` 的 `paths`（`@/*` → `./src/*`）；`astro.config.mjs` 与 `vitest.config.ts` 使用同一别名。
- `scripts/` 由 `oxlint` 覆盖，不进入 `astro check`；新增脚本仍要保证无 `any` 与未使用导入。
- 构建产物：`dist/` 是 Cloudflare Worker + 静态资源；`astro build` 只预渲染 404 / 500，数据页请求期渲染。
- 本地预览 `bun run preview` 走 workerd，与线上响应头（`cache-tag` / `cloudflare-cdn-cache-control`）一致。

## 提交前

```bash
bun run check
bun run build
```

- 不要提交 `dist/`、`node_modules/`。
- 改了数据/字段：同时更新 `docs/data/data-model.md`。
- 改了流程/脚本：同时更新 `README.md` 与相关 docs。
