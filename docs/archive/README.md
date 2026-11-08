# 存档（Archive）

本目录存放已完成或已取消的阶段方案、历史调研，以及不再作为当前事实来源的文档。**不主动读取**，只在追溯决策时查阅。

## 索引

| 文档 | 说明 | 归档原因 |
| --- | --- | --- |
| [ssg-research.md](./ssg-research.md) | 2026-11-02 的 SSG / SPA + 部分 SSG / 每日增量更新调研 | 结论已被 [astro-ssr-migration.md](./astro-ssr-migration.md) 替代；保留历史对比 |
| [astro-ssr-migration.md](./astro-ssr-migration.md) | Astro 7 + Workers + PostgreSQL + R2 迁移方案、数据模型与实施记录 | 迁移已完成；现状见 [architecture.md](../planning/architecture.md) |
| [db-optimization.md](./db-optimization.md) | 2026-11-05 数据库读路径优化：查询合并、窄列、缓存与压测 | 已完成；结论见 [performance.md](../engineering/performance.md) |
| [transcript-index.md](./transcript-index.md) | 逐字稿索引的检索、分面、月份导航与移动端筛选 | 已实现 |
| [ui-refactor.md](./ui-refactor.md) | UI 重构：信息架构、设计系统与 coss 落地映射 | 已实施；规则见 [ui-design/README.md](../ui-design/README.md) |
| [ui-refactor-progress.md](./ui-refactor-progress.md) | UI 重构的实施状态与文件归属 | 已实施 |
| [state-machine-remediation.md](./state-machine-remediation.md) | 隐式状态机显式化的阶段方案与验收标准 | 2026-11-08 审查问题已全部关闭 |
| [share-card.md](./share-card.md) | 直播日程分享卡片的信息层级、布局与导出 | 已实现 |
| [product-direction.md](./product-direction.md) | 封面、相册、逐字稿、组首页与跨成员对比的产品方向与边界 | P1–P3 已实施；CMS 明确不做，推文联动只在 backlog |

## 约定

- 归档文档不要求路径、命令与当前代码一致；正文开头标注归档原因与替代文档。
- 当前任务不要以归档文档为准；需要历史背景时再读。
- 新增归档时更新本页索引，并在原文档开头加一行「已归档」说明。
- 已完成的后台任务条目不再保留在 [backlog.md](../planning/backlog.md)；历史见 git、[CHANGELOG.md](../../CHANGELOG.md) 与 [development-log](../development-log/)。
