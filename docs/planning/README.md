# 规划与架构（Planning）

本目录记录架构决策、任务清单与阶段方案。文档关系：

```text
requirements/（需求真相源：要做什么）
planning/（规划与执行：怎么做、做到哪了）
  ├── architecture.md            ← 分层、数据流、路由、关键决策
  ├── backlog.md                 ← 任务清单与优先级
  ├── astro-ssr-migration.md     ← 当前阶段方案：Astro + Workers + PostgreSQL
  ├── transcript-index.md        ← 逐字稿索引：检索、分面、月份导航与移动端
  ├── live-calendar.md           ← 直播日历：未来场次、手工日程与月历视图
  ├── share-card.md              ← 直播日程分享卡片：层级、间距、配色与导出
  ├── product-direction.md       ← 产品方向与阶段计划
  ├── ui-refactor.md             ← UI 重构方案（已实施）
  └── ui-refactor-progress.md    ← UI 重构实施状态
```

## 文档索引

| 文档 | 说明 | 何时阅读 |
| --- | --- | --- |
| [architecture.md](./architecture.md) | 当前 Astro 7 + Workers + PostgreSQL 的分层、数据流、路由、状态与图表策略 | 任何架构级变更前 |
| [backlog.md](./backlog.md) | 任务清单：未完成项、已完成历史、审查承接区 | 规划下一阶段任务 |
| [astro-ssr-migration.md](./astro-ssr-migration.md) | Astro 7 + Cloudflare Workers + PostgreSQL + R2 迁移决策与实现记录；SSR、数据模型、`.md` 路由、缓存与发布 | 追溯迁移决策时 |
| [transcript-index.md](./transcript-index.md) | 逐字稿索引的搜索、标签分面、月份导航、折叠、密度与移动端筛选 | 改逐字稿列表或做长列表交互 |
| [live-calendar.md](./live-calendar.md) | 直播日历：`scheduled_streams`、手工日程、每日同步、月历与议程视图、缓存与验收 | 规划或实现日历页 |
| [share-card.md](./share-card.md) | 分享卡片的信息层级、间距、配色、导出与验证 | 改分享卡片或截图样式 |
| [product-direction.md](./product-direction.md) | 封面、相册、逐字稿、组首页、推文联动的产品方向与阶段验收 | 规划产品迭代 |
| [ui-refactor.md](./ui-refactor.md) | 信息架构、设计系统、coss ui 落地映射与迁移计划（已实施） | 改 UI 结构或设计系统前 |
| [ui-refactor-progress.md](./ui-refactor-progress.md) | UI 重构的实施状态与文件归属 | 查看重构是否已完成 |

## 约定

1. 关键架构决策追加到 `architecture.md`，格式 `ADR-NNN`，写清决策、理由、后果。
2. 阶段方案用 `todo-<kebab-case>.md` 或语义文件名（如 `astro-ssr-migration.md`）；完成或取消后 `git mv` 到 `../archive/`。
3. **计划不是现状**：正文只写已经成立的事实；未开工或进行中的任务放 `backlog.md` 或阶段方案。
4. 新任务先登记再实现，写清来源（需求 / 审查 / postmortem / 用户反馈）。
5. backlog 状态统一：📋 未开始 / 🚧 进行中 / ✅ 已完成 / ⏸️ 暂缓 / ❌ 已移除。
6. 方案类文档区分「当前实现」与「目标形态」；已完成的迁移以 `architecture.md` 为准。
7. 文档与界面文案按 [writing-style.md](../writing-style.md)。
