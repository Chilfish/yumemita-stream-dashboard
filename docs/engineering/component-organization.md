# 组件组织

**最后更新**：2026-11-07
**适用范围**：`src/components/dashboard/` 及其子目录。

`dashboard/` 曾把视图、壳层、基础件、context 与领域区块平铺在一层（59 个文件），
文件名不足以说明职责，也无法从目录判断一个组件属于哪个页面。本文件定义目录分层、
文件职责与拆分门槛；新增组件按这里的规则落位，不再平铺到根目录。

## 目录

```text
src/components/dashboard/
├─ contexts/       React context 与对应 hook（dataset / group 数据）
├─ primitives/     dashboard 级基础件：Panel、DataTable、PageHeader、封面、头像……
├─ shell/          壳层：侧栏、顶栏、移动端标签栏、命令面板、成员 Sheet
├─ calendar/       日历、月网格、议程、今天+明天时间线、日程分享卡片
├─ compare/        同成员多场对比
├─ gallery/        相册（成员与全组共用）
├─ group/          组首页区块
├─ home/           成员首页与其区块
├─ stream/         单场详情及其分段面板
├─ streams/        场次列表、工具栏、筛选与列定义
├─ transcript/     逐字稿正文与逐字稿索引
└─ trends/         趋势页、月度/类型表与榜单
```

`src/components/app/` 仍只放页面外壳岛屿（`DatasetPage` / `GroupPage`），
`src/components/pages/` 放按页面组合的视图，二者只从上述目录导入，不再定义区块。

## 分层与依赖方向

```text
pages / app  →  领域目录（home, streams, stream, calendar, …）
                     ↓
                primitives
                     ↓
                contexts（只被叶子读取）
```

- 领域目录之间不互相导入；共用件下沉到 `primitives/`。
- `primitives/` 不导入任何领域组件，也不读 `DatasetViewContext` —— 收 props。
- `contexts/` 只放 context 与 `useXxx`，不放渲染。
- 只有 `app/`、`pages/`、`shell/` 读取 URL（`useSearchParams` / `navigate`）；
  领域视图通过 props 接收参数与回调。

## 单文件职责

一个文件只承担一种职责，按下列角色拆分：

| 角色 | 放哪里 | 例子 |
| --- | --- | --- |
| 容器 | 领域目录根，导出页面级组件 | `trends/trends-view.tsx` |
| 展示区块 | 同目录的子组件文件 | `calendar/month-grid.tsx` |
| 纯逻辑 | 同目录 `*.ts`（可测、无 React） | `streams/stream-filters.ts` |
| 列定义 / 渲染映射 | 同目录 `*.tsx`，导出 builder 函数 | `streams/stream-columns.tsx`、`trends/trends-tables.tsx` |
| 三态（loading / empty / error） | 同文件或就近的 `*-states.tsx` | `transcript/transcripts-view.tsx` |

拆分门槛：超过 250 行，或同时包含「取数与状态」「纯计算」「列/渲染定义」三类职责时拆分。
不按行数机械切分；一个 200 行的单一职责组件保持原样。

## 命名

- 文件 kebab-case，导出组件 PascalCase；纯逻辑文件导出 camelCase。
- `*-view.tsx` 是页面级容器；`*-panel.tsx` 是单场分段区块；
  `use-*.ts` 是 hook；`*-columns.tsx` / `*-filters.ts` 是表的列与筛选纯逻辑。
- 目录全小写、单数领域名；不新增 `common/`、`utils/`、`shared/` 这类无边界目录
  （已有 `primitives/` 承担基础件）。

## 约束

1. 新增 dashboard 组件必须放进对应领域目录；根目录不再新增文件。
2. 领域目录的新增子目录需要同时在本文件登记，否则视为未组织的文件。
3. 跨领域复用的组件先下沉 `primitives/`，不要在两端各写一份。
4. 拆分时同步更新 [code-map.md](./code-map.md) 与 [architecture.md](../planning/architecture.md) 的目录树。
5. 移动文件只改路径与 import，不顺手改逻辑；逻辑变更单独提交。
