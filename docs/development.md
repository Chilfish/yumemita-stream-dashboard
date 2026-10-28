# 开发

## 环境

- **Bun ≥ 1.4**（推荐，仓库带 `bun.lock`）
- Node.js ≥ 20（Vite / 工具链需要）
- 不需要后端、数据库或环境变量

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
| `bun run sync:data` | 生成 `public/data/` |
| `bun run validate:data` | 校验数据引用链 |
| `bun run add:datapack` | 加一份 datapack 并更新 manifest |
| `bun run typecheck` | `tsc -b` |
| `bun run test` | Vitest 单次 |
| `bun run test:watch` | Vitest watch |
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
│  └─ format.ts     数字 / 时间 / 币种格式化
├─ hooks/           异步状态、主题、尺寸
├─ components/
│  ├─ charts/       D3 + SVG 图表
│  ├─ dashboard/    页面级视图与业务组件
│  └─ ui/           coss ui primitives（生成物）
├─ App.tsx          壳：dataset、页签、选中场次、加载/错误态
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

`Card` / `CardHeader` / `CardTitle` / `CardDescription` / `CardPanel` / `CardAction`、`Tabs`、`Table`、`Select`、`Badge`、`Button`、`Checkbox`、`Label`、`Input`、`ScrollArea`、`Alert`、`Skeleton`。

### 常见坑

- `Select` 用 **items-first**：`<Select items={items}>` + `<SelectItem value={item}>`；不要沿用 Radix 的纯 children 写法。
- `Button` 默认 `type="button"`；表单里要显式写 `type`。
- `Table` 自身不带排序/分页；排序在 `table-view.tsx` 里用 React state 实现。
- `TabsPanel` 即使隐藏也会挂载；本项目用 `view === "..."` 条件避免隐藏页渲染图表。

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

## 加一个页签

1. 在 `src/components/dashboard/` 新建视图组件，props 只接收 `StreamRow[]` / `DatasetTotals` / 单场 `StreamRow`。
2. 在 `App.tsx` 的 `VIEWS` 加 key。
3. 在 `TabsList` 加 `TabsTab`，在对应 `TabsPanel` 里用 `view === "..."` 条件渲染。
4. 如果新视图需要新聚合，先在 `lib/aggregate.ts` 加函数和测试。

## 加一个聚合指标

1. 在 `src/lib/aggregate.ts` 的 `DatasetTotals` / `StreamRow` 里加字段。
2. 在 `aggregateDataset` 里计算；对 `null` 做显式处理。
3. 在 `src/lib/aggregate.test.ts` 加断言。
4. 在视图里消费；如需图表，按 D3 骨架新增组件。

## 测试

- `src/lib/format.test.ts`：格式化边界（null、时长、币种、JST）。
- `src/lib/aggregate.test.ts`：合并、合计、币种排序、Top 词/作者、最佳场次、峰值分钟。
- 组件不强制单测；交互复杂时再加 `@testing-library/react`。

```bash
bun run test
bun run test:watch
```

## 类型与构建

- `tsc -b` 使用 project references：`tsconfig.app.json`（src）+ `tsconfig.node.json`（vite.config）。
- TypeScript 7 已移除 `baseUrl`；路径别名只写在 `paths`，相对于 tsconfig 解析。
- 构建产物：`dist/`；数据在 `dist/data/`。
- 当前 bundle 约 550 KB（gzip ~180 KB），主要来自 D3 + Base UI。需要进一步瘦身时，可按视图 `lazy()` 拆包。

## 提交前

```bash
bun run check
bun run build
```

- 不要提交 `public/data/`、`dist/`、`node_modules/`。
- 改了数据/字段：同时更新 `docs/data-model.md`。
- 改了流程/脚本：同时更新 `README.md` 与相关 docs。
