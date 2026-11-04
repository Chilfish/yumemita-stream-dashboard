# 代码规范

**项目**：yumemita-stream-dashboard | **最后更新**：2026-11-03
**当前实现**：Astro 7 + Cloudflare Workers + TypeScript 6（迁移阶段 0）。PostgreSQL 查询与页面迁移尚未完成，见 [astro-ssr-migration.md](../planning/astro-ssr-migration.md)。旧 React Router 页面只保留在 `src/legacy/pages/`。

## 文件与命名

| 类型 | 风格 | 示例 |
| --- | --- | --- |
| Astro 页面 | kebab-case | `src/pages/index.astro`、`[...].astro` |
| 旧路由页面（迁移参考） | kebab-case | `src/legacy/pages/stream-page.tsx` |
| React 组件 | PascalCase | `StreamDetailView.tsx`、`GroupHero.tsx` |
| coss UI 组件 | kebab-case | `src/components/ui/button.tsx` |
| hooks | kebab-case，`use-` 前缀 | `use-dataset.ts`、`use-stream-packs.ts` |
| lib / 纯函数 | kebab-case | `aggregate.ts`、`table-params.ts` |
| 类型 | kebab-case 文件，PascalCase 类型 | `types/dataset.ts` → `StreamSummary` |
| 函数 / 变量 | camelCase | `buildSummaryRows`、`datasetId` |
| 常量 | UPPER_SNAKE_CASE 或 camelCase 对象 | `MAX_COMPARE`、`CHART_COLORS` |
| 目录 | 全小写 | `src/components/dashboard/`、`docs/engineering/` |

- 页面文件只做「取数 → 传给视图 → 接导航」，不要塞业务逻辑。
- 纯逻辑放 `src/lib/`；组件里不重复计算聚合。
- `src/components/ui/` 是 coss CLI 生成物，不写业务逻辑。

## 代码风格基线

旧代码使用 **分号 + 双引号 + 2 空格缩进**；迁移阶段 0 新增的 Astro 文件沿用模板的 **无分号 + 单引号 + 2 空格缩进**。两种风格暂并存，阶段 3 页面迁移完成后用一次独立 commit 统一，不要在功能提交里混入全文件格式化。

```ts
import { useEffect, useState } from "react";
import { fetchManifest } from "@/lib/data";
import type { BatchManifest } from "@/types/dataset";
```

- import 顺序：`type` 导入 → 外部依赖 → `@/` 别名 → 相对路径。
- 一个文件只做一件事；私有 helper 放文件底部或同目录。
- 禁止 wildcard import（`import * as X`），类型导入除外。
- 不用 `any`；外部数据先断言再校验。

> 迁移到 Astro 模板时，如果整体采用模板的「无分号 + 单引号」格式，先用一次独立 commit 统一格式化，不要在功能提交里混入。

## TypeScript

- 继承 `tsconfig.json`（`astro/tsconfigs/strict`）的严格配置；不新增 `// @ts-ignore`。
- 外部 JSON 先按 `src/types/*` 断言，再由 `validate:data` / `validate-schema` 兜底。
- 可空字段用 `?? null`，不要假设一定存在。
- 对外函数写出返回类型；内部回调可依赖推断。
- 路径别名 `@/*` → `src/*`；不要写 `../../` 跨多层目录。

## React 组件

- 组件名 PascalCase；默认导出用于页面级组件，命名导出用于共享组件。
- props 定义 interface；只传可序列化数据给未来可能水合的边界。
- `useEffect` 的清理函数必须成对移除监听器与定时器。
- 浏览器 API（`window` / `document` / `localStorage`）只在事件、effect 或明确客户端组件里访问。
- 状态分层：
  - URL：dataset、页面、选中场次、对比选择、表格筛选 / 排序
  - 数据 hook：manifest / insights / datapack
  - 组件内：hover、复制提示、图表临时状态
- 不引入全局 store，除非跨页面共享成为硬需求。

## 路由与 URL

- 当前使用 Astro 文件路由；数据页 `prerender = false`，稳定页 `prerender = true`。
- 新增页面：`src/pages/` 下新建 `.astro` + `src/lib/routes.ts` 的 `VIEWS` + 侧栏导航。
- 表格参数用 `parseTableParams` / `writeTableParams`，默认值不写进 URL；岛屿内更新用 `history.replaceState`。
- 导航用 `<a href>`（`ClientRouter` 接管站内导航）；脚本内跳转用 `navigate()`，不要手写 `window.location.href`。
- 链接必须可分享、可刷新、可前进后退。

## 数据边界与三态

所有数据获取路径覆盖：

```text
loading → 骨架 / 加载提示
empty   → 说明「这里是什么、为什么空、下一步」
error   → 消息 + 可执行动作（重试 / 检查配置 / 查看日志）
```

- 数据库查询可能失败；单个成员失败不能阻塞组首页。
- 查询失败时显示错误态与可执行动作，不要静默返回空数组。
- `vstats`、`comments`、`avgConcurrent` 可能是 `null`；图表跳过或显示「—」，不要画 0。
- 不把回退成功当成配置正确；日志要说明原因。

## Tailwind / coss UI

- 颜色使用设计 Token：`bg-background`、`text-muted-foreground`、`border`、`var(--chart-1)`；禁止 `#fff`、`rgb()`、`bg-[#xxx]`。
- 浅色 / 深色同时成立；不要用 `dark:` 覆盖颜色。
- 移动端优先，再用 `sm:` / `md:` / `lg:` 增强。
- 组合 class 用 `cn()`（`@/lib/utils`）。
- 优先复用 `src/components/ui/`；新增基础组件按 coss / Base UI 模式实现。
- Toast Provider 只在使用它的岛屿 / 组件内挂载。
- 交互元素处理 hover、active、focus-visible、disabled；焦点环可见。
- 图标按钮有 `aria-label`；图表 SVG 有 `aria-label` 与 `<title>`。

## D3 图表

- **React 拥有 DOM，D3 只算数学**；不用 `d3-selection` 操作 React 节点。
- 用 `ChartCanvas` 拿响应式宽度，不自己写 ResizeObserver。
- 用 `scaleLinear` / `scaleBand` / `scaleSqrt`；`line` / `area` / `pie` / `arc` 生成 path。
- 空数据用 `EmptyChart`；`null` 跳过，不画 0。
- 每个数据标记尽量有 `<title>`；SVG 有 `aria-label`。
- hover / 触控用 pointer 事件，不只写 `onMouseMove`；覆盖层保留纵向滚动。

## 测试

- 框架：Vitest；测试文件与源码同目录，命名 `*.test.ts`。
- 覆盖：`src/lib/` 纯函数（聚合、格式化、路由、表格参数、分类、快捷键）与关键数据转换。
- 结构：Given-When-Then；每条 `it` 至少一条断言。
- 禁止空 `describe`、全 `skip`、`only` 或条件断言冒充通过。
- 路由冒烟：`bun run test:smoke`（先启动 dev / preview）。
- 组件不强制单测；交互复杂时再加 `@testing-library/react`。

## 禁止事项

| 禁止 | 替代方案 |
| --- | --- |
| `any`（含隐式） | 明确类型 / `unknown` + 收窄 |
| 在视图里重复聚合 | 放 `src/lib/aggregate.ts`，补测试 |
| 硬编码颜色 | CSS 变量 / Token |
| 首屏渲染依赖 `window` | 放到事件或 effect |
| 手写弹层 / 下拉 | 复用 `src/components/ui/` |
| 对不可信 Markdown 用 `set:html` | 只渲染自有内容；`react-markdown` 默认安全模式 |
| 提交 `data/`、`dist/` | 用脚本生成，gitignore |
| `console.log` 遗留 | 移除；错误路径用 `console.error` / `console.warn` |

## 验证与诚实

- 当前门禁：`bun run check`（typecheck + test + lint）与 `bun run build`。
- 数据改动：`bun run validate:data`；发布后 `--remote` 确认可达。
- 涉及页面：在 `bun run dev` 或 `bun run preview` 下手工走查，写清路径与结果。
- 不把「构建通过」当作功能已验证；未执行的检查标注「未验证」。
- 不接受「既有红灯」作为基线；已知失败先修或移除。
- 报告时写清命令、结果、未跑项与原因。

## Astro 约定（当前生效）

- 每个页面显式声明 `export const prerender`；静态页写 `true`，数据页写 `false`。
- `.astro` frontmatter 只跑在服务端 / 构建期；不读 `window` / `localStorage`。
- 岛屿 props 必须可序列化；`client:only` 不用于首屏正文或 SEO 内容。
- 导航用 `<a href>` + `ClientRouter`；脚本内跳转用 `navigate()`。
- 服务端密钥（`DATABASE_URL`）只从 `astro:env/server` 读；R2 凭据只在脚本 / 构建期使用。
- 数据页三态与缓存指令（`Astro.cache.set`）一起交付。
- 页面用 `<Layout meta={buildSeo(...)}>` 输出 head；不要手写重复的 meta 标签。
