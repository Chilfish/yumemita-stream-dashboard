# ゆめみた 配信数据台

把 **夢限大みゅーたいぷ** 成员直播的归一化 JSON 做成可交互的数据可视化页面：同接、弹幕密度、SC、评论、词频与跨场对比。

当前内置数据集：**宮永ののか**，最近 **30 场**不重复直播（2026-08-10 – 2026-10-22）。

> 这个目录设计为**独立仓库**：数据在 `data/` 内随仓库一起提交，不依赖上层归档目录。
> 页面只读数据，所有统计都在浏览器端完成。

## 界面

![总览](docs/assets/overview.png)

![单场](docs/assets/stream.png)

> 截图来自本地 30 场数据；右上角可切换深浅色主题。

## 功能

- **总览**：月度 KPI、每场平均/最大同接、SC 币种构成、弹幕浓度 × 同接散点、全月高频词/发言者、最近场次。
- **单场**：逐分钟弹幕曲线（含 SC 标记）、每 10 分钟分布、SC 全表、Top 词/发言者、徽章、评论区。
- **对比**：最多选 4 场，逐分钟弹幕叠加对比 + 指标横表（最高值高亮）。
- **数据表**：可搜索、排序、筛选（仅有 VSTATS）、导出 CSV。
- **说明**：数据口径、已知限制、更新方式。
- 深色/浅色主题、响应式布局、多数据集切换（为后续成员预留）。

## 快速开始

需要 **Bun ≥ 1.4**（推荐）和 Node.js ≥ 20。

```bash
bun install
bun run dev
# http://localhost:5173
```

`dev` 会先运行 `sync:data`，把 `data/` 同步到 `public/data/`（生成物，已 gitignore）。

### 常用命令

| 命令 | 说明 |
| --- | --- |
| `bun run dev` | 同步数据 + 启动开发服务器 |
| `bun run build` | 同步数据 + 类型检查 + 生产构建（`dist/`） |
| `bun run preview` | 预览生产构建 |
| `bun run sync:data` | `data/` → `public/data/`，生成 dataset 索引 |
| `bun run validate:data` | 校验 index → manifest → datapack 的完整性 |
| `bun run add:datapack` | 加一份 datapack，自动更新 manifest |
| `bun run typecheck` | TypeScript 类型检查 |
| `bun run test` | Vitest 单元测试 |
| `bun run lint` | oxlint |
| `bun run check` | typecheck + test + lint |
| `bun run ci` | sync + validate + check + build（CI 同款） |

## 数据流

```text
data/<dataset>/manifest.json + <videoId>.datapack.json
        │
        │  scripts/sync-data.mjs
        ▼
public/data/index.json + <dataset>/manifest.json + <videoId>.datapack.json
        │
        │  fetch（浏览器）
        ▼
useDatasetIndex → useDataset → StreamDatapack Map
        │
        ▼
buildStreamRows / aggregateDataset（纯函数）
        │
        ▼
总览 / 单场 / 对比 / 数据表
```

- `data/` 是**源数据**，随仓库提交。
- `public/data/` 是**构建中间产物**，由 `sync:data` 生成，不提交。
- `dist/data/` 会随生产构建一起打包，静态托管即可直接访问。

## 目录结构

```text
stream-dashboard/
├─ data/                     # 源数据（提交）
│  ├─ README.md
│  └─ nonoka/
│     ├─ manifest.json
│     └─ <videoId>.datapack.json
├─ docs/                     # 架构 / 数据模型 / 开发 / 部署文档
├─ public/data/              # 生成物（gitignore）
├─ scripts/
│  ├─ sync-data.mjs
│  └─ validate-data.mjs
├─ src/
│  ├─ components/
│  │  ├─ charts/             # D3 图表（React 持有 DOM，D3 只算比例尺/路径）
│  │  ├─ dashboard/          # 页面级组件与视图
│  │  └─ ui/                 # coss ui primitives（生成物，避免手改）
│  ├─ hooks/                 # 数据加载、主题、尺寸测量
│  ├─ lib/                   # 纯函数：data / aggregate / format
│  ├─ types/                 # datapack / dataset schema 的 TS 镜像
│  ├─ App.tsx
│  └─ index.css              # Tailwind v4 + coss 主题 token
├─ data-sources.json         # dataset 注册表
├─ components.json           # shadcn/coss 配置
└─ vite.config.ts
```

## 技术栈

- **React 19 + Vite + TypeScript**
- **Tailwind CSS v4** + **coss ui**（Base UI + shadcn 风格组件）
- **D3**：`scale` / `shape` / `pie` / `arc`，只负责数学与路径，不接管 DOM
- **Vitest**：数据聚合与格式化单元测试
- **oxlint**：静态检查

## 增加数据 / 成员

### 加一场直播

1. 把 `<videoId>.datapack.json` 放进 `data/<dataset>/`。
2. 更新 `data/<dataset>/manifest.json` 的 `streams` 数组、`count`、`generatedAt`。
3. `bun run sync:data && bun run validate:data`。

### 加一位成员

1. 新建 `data/<id>/`，放入 `manifest.json` 和 datapack。
2. 在 `data-sources.json` 增加一条 dataset。
3. 重新同步；页面会自动出现 dataset 选择器，不需要改组件。

详细步骤与字段说明见 [docs/adding-data.md](docs/adding-data.md)。

## 部署

```bash
bun run build
# 产物在 dist/，包含 dist/data/
```

任意静态托管（GitHub Pages / Netlify / Vercel / Cloudflare Pages）都可以。若部署在子路径，请在 `vite.config.ts` 设置 `base`；数据加载使用 `import.meta.env.BASE_URL`，会自动跟随。详见 [docs/deployment.md](docs/deployment.md)。

## 文档

- [docs/README.md](docs/README.md) — 文档索引
- [docs/architecture.md](docs/architecture.md) — 架构与数据流
- [docs/data-model.md](docs/data-model.md) — manifest / datapack 字段与口径
- [docs/adding-data.md](docs/adding-data.md) — 新增场次、成员、数据集
- [docs/development.md](docs/development.md) — 本地开发、代码规范、图表写法
- [docs/deployment.md](docs/deployment.md) — 构建与静态托管
- [docs/troubleshooting.md](docs/troubleshooting.md) — 常见问题
- [docs/roadmap.md](docs/roadmap.md) — 后续计划

## 数据与内容说明

- 数据来自 YouTube 直播回放、弹幕、评论区与 VSTATS 快照，经 `stream-datapack` 归一化。
- 会员限定内容可能包含不适合公开传播的信息；部署前请自行确认范围与权限。
- 原始内容版权归各自权利人所有，本仓库只做个人研究与分析用途。详见 [NOTICE.md](NOTICE.md)。
