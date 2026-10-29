# 开发

## 环境

- **Bun ≥ 1.4**（推荐，仓库带 `bun.lock`）
- Node.js ≥ 22.22（React Router v8 / Vite 工具链需要）
- 不需要后端或数据库；连对象存储时在 `.env` 填 `VITE_DATAPACK_BASE`（留空则走本地 `data/`）

```bash
bun install
bun run dev
```

## 脚本

| 命令 | 作用 |
| --- | --- |
| `bun run dev` | `sync:data` → `vite` |
| `bun run build` | `sync:data` → `tsc -b` → `vite build` |
| `bun run preview` | 预览 `dist/` |
| `bun run sync:data` | 生成 `public/data/` 兜底快照（远端优先） |
| `bun run publish:data` | 由 pack 重建 index + manifest + insights，增量上传对象存储 |
| `bun run validate:data` | 校验数据引用链（`--remote` 检查对象存储） |
| `bun run add:datapack` | 加一份 datapack 并更新 manifest |
| `bun run typecheck` | `tsc -b` |
| `bun run test` | Vitest 单次 |
| `bun run test:watch` | Vitest watch |
| `bun run test:smoke` | agent-browser 路由冒烟（需先起 dev/preview） |
| `bun run lint` | oxlint |
| `bun run check` | typecheck + test + lint |
| `bun run ci` | 全链路（CI 同款） |

## 代码组织

```text
src/
├─ types/           JSON schema 的 TS 镜像，不放逻辑
├─ lib/             纯函数，不 import React
│  ├─ data.ts       fetch / 并发加载
│  ├─ aggregate.ts  合并、聚合、找极值
│  ├─ routes.ts     URL 构造与对比 id 解析
│  ├─ table-params.ts 数据表 URL 参数解析/序列化
│  ├─ keyboard.ts   快捷键纯函数
│  └─ format.ts     数字 / 时间 / 币种格式化
├─ hooks/           异步状态、主题、尺寸
├─ pages/           路由页面（数据 ↔ 视图 ↔ navigate）
├─ components/
│  ├─ charts/       D3 + SVG 图表
│  ├─ dashboard/    视图、Sidebar、Header、布局与 context
│  └─ ui/           coss ui primitives（生成物）
├─ router.tsx       createHashRouter 路由表
├─ App.tsx          RouterProvider
└─ index.css        Tailwind v4 + coss token
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
- `Table` 自身不带排序/分页；场次表的筛选/排序状态存在 URL 里，由 `streams-page.tsx` + `lib/table-params.ts` 管理，`streams-view.tsx` + `dashboard/data-table.tsx` 是受控视图。
- 导航用 `SidebarMenuButton render={<NavLink to={...} />}`；active 状态自己算好传给 `isActive`，不要给 `NavLink` 传函数式 `className`。
- 侧边栏折叠样式靠祖先的 `group-data-[collapsible=icon]`；只在折叠时隐藏的内容加这个 class。

## 路由

- 使用 React Router v8 的 **hash 路由**（`createHashRouter`），静态托管/子路径不需要服务端回退。
- URL 形态：`#/:id` 成员首页、`#/:id/streams?q=&type=&sort=&dir=&vstats=` 场次页、`#/:id/trends` 趋势页、`#/:id/stream/:videoId?view=` 单场、`#/:id/compare?ids=a,b,c` 对比、`#/:id/about` 说明；旧地址 `#/:id/overview`、`#/:id/table` 自动重定向。
- 表格参数用 `parseTableParams` / `writeTableParams`（`lib/table-params.ts`），默认值不写入 URL，更新用 `replace: true`。
- 根路由与 `:datasetId` 有 `errorElement`（`route-error.tsx`）；新页面不需要单独加错误兜底。
- `DatasetLayout` 只加载 manifest + `insights.json`；列表页不下载 datapack。单场和对比用 `useStreamPacks` 按需拉取，缓存由 `lib/data.ts` 负责。
- 全局快捷键在 `hooks/use-keyboard-shortcuts.ts`：`j` / `k` 翻场、`1`–`5` 切页面、`/` 聚焦搜索、`⌘K` 搜索场次与成员、`⌘B` 收起/展开侧栏；除 `⌘K` 外，输入框内自动忽略。
- `src/pages/` 只做三件事：取 `useDatasetView()` 数据、调用 `navigate`、渲染 `dashboard/` 里的视图。
- 页面按路由 `lazy()`（`src/pages/lazy-pages.tsx`），`DatasetLayout` 用 `Suspense` 包住 `Outlet`。

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

## 加一个路由页面

1. 在 `src/components/dashboard/` 新建视图组件，props 只接收 `StreamRow[]` / `DatasetTotals` / 单场 `StreamRow`。
2. 在 `src/pages/` 新建页面，从 `useDatasetView()` 取数据，把跳转接到 `navigate`。
3. 在 `src/pages/lazy-pages.tsx` 用 `lazy()` 导出页面。
4. 在 `src/router.tsx` 的 `:datasetId` children 加 route。
5. 在 `src/lib/routes.ts` 的 `VIEWS` 加 key，并在 `app-sidebar.tsx` 的 `NAV_ITEMS` 加导航项。
6. 如果新视图需要新聚合，先在 `lib/aggregate.ts` 加函数和测试。

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

- `tsc -b` 使用 project references：`tsconfig.app.json`（src）+ `tsconfig.node.json`（vite.config）。
- TypeScript 7 已移除 `baseUrl`；路径别名只写在 `paths`，相对于 tsconfig 解析。
- 构建产物：`dist/`；`dist/data/` 只含兜底快照（`index.json`、`manifest.json`、`insights.json`），页面运行时直接向对象存储请求。
- 当前主包约 349 KB（gzip ~112 KB），主要来自 D3 + Base UI；视图已按路由 `lazy()` 拆包。

## 提交前

```bash
bun run check
bun run build
```

- 不要提交 `public/data/`、`dist/`、`node_modules/`。
- 改了数据/字段：同时更新 `docs/data-model.md`。
- 改了流程/脚本：同时更新 `README.md` 与相关 docs。
