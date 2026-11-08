# 规划与架构（Planning）

本目录只保留**当前仍生效**的架构说明、进行中的方案与未完成任务。已完成的阶段方案归档到 [`../archive/`](../archive/README.md)。

```text
requirements/（需求真相源：要做什么）
planning/（规划与执行：怎么做、还差什么）
  ├── architecture.md        ← 分层、数据流、路由、关键决策
  ├── backlog.md             ← 当前未完成任务与优先级
  ├── live-calendar.md       ← 直播日历：剩余入口与 ICS
  └── performance-audit.md   ← 性能审计：剩余 props / 壳层 / 管线项
```

## 文档索引

| 文档 | 说明 | 何时阅读 |
| --- | --- | --- |
| [architecture.md](./architecture.md) | 当前 Astro 7 + Workers + PostgreSQL 的分层、数据流、路由、状态与图表策略 | 任何架构级变更前 |
| [backlog.md](./backlog.md) | 当前未完成任务、优先级与前置条件 | 规划下一阶段任务 |
| [live-calendar.md](./live-calendar.md) | 直播日历：已落地部分的接口索引；未完成项见 backlog | 继续做日历入口或 ICS |
| [performance-audit.md](./performance-audit.md) | 尚未落地的性能优化：props 收敛、壳层重构、管线批量化 | 继续做性能优化 |

历史方案与已定稿的产品方向（迁移、数据库优化、UI 重构、逐字稿索引、状态机整改、分享卡片、产品方向）见 [archive/](../archive/README.md)。

## 约定

1. 关键架构决策追加到 `architecture.md`，格式 `ADR-NNN`，写清决策、理由、后果。
2. 阶段方案用 `todo-<kebab-case>.md` 或语义文件名；**完成或取消后立即 `git mv` 到 `../archive/`**，并更新本页与 [docs/README.md](../README.md) 索引。
3. **计划不是现状**：正文只写已经成立的事实；未开工或进行中的任务放 `backlog.md` 或阶段方案。
4. 新任务先登记再实现，写清来源（需求 / 审查 / postmortem / 用户反馈）。
5. **backlog 只放未完成项**：完成后直接删除条目，不保留「已完成历史」；状态只用 📋 未开始 / 🚧 进行中 / ⏸️ 暂缓。历史见 git、CHANGELOG 与 development-log。
6. 方案类文档区分「当前实现」与「目标形态」；已完成的方案不再留在本目录。
7. 文档与界面文案按 [writing-style.md](../writing-style.md)。
