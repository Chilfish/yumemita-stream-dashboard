# 工程规范（Engineering）

本目录存放项目级工程规范、开发与部署流程。

## 文档索引

| 文档 | 说明 | 何时阅读 |
| --- | --- | --- |
| [code-style.md](./code-style.md) | TypeScript / React / Astro / Tailwind / D3 约定、数据边界、测试与禁止事项 | 写代码前 |
| [code-map.md](./code-map.md) | 任务意图 → 关键文件；只放入口，不写实现细节 | 不确定该改哪个文件时 |
| [component-organization.md](./component-organization.md) | 组件分层、依赖方向与拆分门槛 | 新增或重组组件时 |
| [git-workflow.md](./git-workflow.md) | 分支模型、Commit 规范、验证门禁、PR 与审查 | 每次 commit / PR |
| [release-checklist.md](./release-checklist.md) | 里程碑发布清单：验证、冒烟、数据、文档、回滚 | 发布前 |
| [development.md](./development.md) | 本地环境、脚本、coss ui、D3 图表写法、测试 | 日常开发 |
| [local-database.md](./local-database.md) | 本地 Postgres、Neon HTTP 代理、灌数据与排查 | 本地开发不连线上库 |
| [deployment.md](./deployment.md) | Cloudflare Workers、R2 发布、子路径、缓存、CI | 上线与数据发布 |
| [schedule-admin.md](./schedule-admin.md) | 日程管理 API：认证、日期与时段、幂等、关联规则、端点和示例 | 维护未来日程 / 写 Agent 调用 |
| [share-card.md](../archive/share-card.md) | 分享卡片：React + Tailwind 布局、官方背景、modern-screenshot 导出 | 改分享卡片或截图样式 |
| [performance.md](./performance.md) | 首屏数据流、缓存分层、图片 / 字体 / 拆包与实测数字 | 改加载逻辑或排查性能 |
| [troubleshooting.md](./troubleshooting.md) | 常见报错、数据异常与口径问题 | 页面空白 / 图表为空 |
| [astro-experiments.md](./astro-experiments.md) | 模板已验证的 Astro 模式与本项目迁移时的落点 | 追溯迁移决策时 |

## 约定

1. 每个 commit / PR 必须通过当前验证门禁：`bun run check` + `bun run build`。
2. 手工验证要写清路径与预期；未执行的检查标注「未验证」。
3. 验收标准必须能失败：测试接入后，故意改坏被测行为时相关测试应变红。
4. 新 Bug 模式写 postmortem，预防项同步本目录规范或 postmortem 基线雷区，不往 `AGENTS.md` 堆细节。
5. 当前实现是 Astro 7 + Cloudflare Workers + PostgreSQL；改架构或约定时同步更新本目录规范，不保留双份事实。
6. 每季度审阅 `AGENTS.md` 与仓库规则，删除已学会或过期的条目；依据见 [agents-md-structure.md](../research/agents-md-structure.md)。
