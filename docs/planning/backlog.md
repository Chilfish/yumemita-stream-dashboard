# 任务清单（Backlog）

> 只记录当前未完成事项。完成后直接删除条目，不保留已完成历史；历史见 git、[CHANGELOG.md](../../CHANGELOG.md) 与 [development-log](../development-log/)。
> 方向与验收标准见 [product-direction.md](../archive/product-direction.md)。

## 候选（未排期）

| 编号 | 任务 | 优先级 | 前置条件 | 来源 | 状态 |
| --- | --- | --- | --- | --- | --- |
| B5 | 观众重叠页面（`authors.json` 已有数据） | P2 | 确认重叠算法与最小样本 | roadmap | 📋 |
| B6 | 全量弹幕入库与检索 | P2 | `chat_events` 分区方案 | 迁移 | 📋 |
| B7 | 评论增长快照 / 多次抓取对比 | P3 | 抓取侧支持重复快照 | roadmap | 📋 |
| B8 | IndexNow / sitemap 主动通知 | P3 | 缓存 purge 已实现 | SEO | 📋 |
| B9 | 200% 缩放复核（320px 已通过） | P3 | 无 | roadmap | 📋 |
| B11 | 开播前 / 直播中弹幕采集（InnerTube live chat，补齐 yt-dlp 只能拿回放的空档） | P2 | 无 | 2026-11-04 需求 | 🚧 实时采集、已结束场次自动回放与合并已实现；每日任务尚未自动接入实时采集 |
| B12 | 弹幕与事件可视化组件（POC `/dev/live-chat`） | P2 | B6 或 R2 `danmaku_*.jsonl` 读取方案 | 2026-11-04 需求 | 🚧 POC 完成；数据源、组件化与正式入口待做 |
| B14 | 直播日历剩余项：首页 / 场次页入口（`FR-CAL-007`）、ICS 订阅（`FR-CAL-009`） | P2 / P3 | 无 | 2026-11-04 需求 | 🚧 侧栏与搜索面板已接；首页与场次页入口待做，ICS 暂缓。方案见 [live-calendar.md](live-calendar.md) |
| B19 | 性能审计剩余项：props 收敛、壳层重构、ingest / publish 批量化 | P1 | 无 | 2026-11-05 巡检 | 🚧 已完成逐字稿 DEV 守卫、列表窄列、对比页密度 API、单场页取数收敛、搜索防抖、context memo、图表 hover 节流；剩余项见 [performance-audit.md](performance-audit.md) |
| B27 | 界面冗余清理：其余页面按 [information-density.md](../ui-design/information-density.md) 逐页扫描 | P1 | 无 | 2026-11-07 首页讨论 | 🚧 首页完成；其余页面待扫 |
| B31 | 同接时间序列：VSTATS 只给平均 / 最大，若有采样源再加曲线 | P3 | 采样数据源 | 2026-11-03 roadmap | 📋 |
| B32 | SC 留言主题：简单关键词 / 共现，不引入重型 NLP | P3 | 无 | 2026-11-03 roadmap | 📋 |
| B33 | 峰值解释：把峰值分钟与人工标注的事件对齐 | P3 | 事件标注数据 | 2026-11-03 roadmap | 📋 |
| B34 | 推文联动：先用手动 pin 验证价值，外部服务只做增强 | P3 | 无 | roadmap | 📋 |
| B35 | 空数据 / 部分数据的更明确提示（已有基础版） | P3 | 无 | roadmap | 📋 |
| B37 | 联动关系视图（`FR-DATA-006`）：成员页「同场成员」面板 + 组级同场次数矩阵 | P3 | 无（B36 已回填 73 场） | 2026-11-12 需求 | 📋 设计已定：不用节点连线图（5 人 10 对全连通，无结构可读）；口径为「同场次数」，三人场每对各计 1 次。见 [collaboration-streams.md](collaboration-streams.md) §9 |

> 2026-11-08 隐式状态机审查的 Z / R / E / U 问题已全部关闭，记录见 [review-2026-11-08-implicit-state-machines.md](../reviews/review-2026-11-08-implicit-state-machines.md) 与 [archive/state-machine-remediation.md](../archive/state-machine-remediation.md)。

## 非目标

- 不做实时看板 / 直播中展示；归档侧可用 `fetch:live-chat` 采集等待室与直播中弹幕，页面仍只读已入库场次。
- 不做用户系统、评论、收藏。
- 不做内容正文的翻译或字幕编辑（那是归档 pipeline 的职责）。
- 不做逐字稿编辑器 / CMS（见 [product-direction.md](../archive/product-direction.md) §6.5）。

## 质量门槛

每个任务交付前必须通过（见 [engineering/git-workflow.md](../engineering/git-workflow.md)）：

```bash
bun run check
bun run build
bun run validate:data   # 改 pack / 数据时
bun run db:verify       # 改 ingest / 数据时
bun run db:query        # 改查询层时
bun run test:smoke      # 改路由时，先启动 preview
```

- 涉及页面的改动必须手工走查并记录路径与结果。
- 未执行的检查标注「未验证」，不能把构建通过当作功能已验证。
- 不接受已知红灯作为基线；先修或移除再合并。
