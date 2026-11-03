# 工程规范（Engineering）

本目录存放项目级工程规范、开发与部署流程。

## 文档索引

| 文档 | 说明 | 何时阅读 |
| --- | --- | --- |
| [code-style.md](./code-style.md) | TypeScript / React / Astro / Tailwind / D3 约定、数据边界、测试与禁止事项 | 写代码前 |
| [git-workflow.md](./git-workflow.md) | 分支模型、Commit 规范、验证门禁、PR 与审查 | 每次 commit / PR |
| [release-checklist.md](./release-checklist.md) | 里程碑发布清单：验证、冒烟、数据、文档、回滚 | 发布前 |
| [development.md](./development.md) | 本地环境、脚本、coss ui、D3 图表写法、测试 | 日常开发 |
| [deployment.md](./deployment.md) | 当前静态托管、R2 发布、子路径、缓存、CI | 上线与数据发布 |
| [performance.md](./performance.md) | 首屏数据流、缓存分层、图片 / 字体 / 拆包与实测数字 | 改加载逻辑或排查性能 |
| [troubleshooting.md](./troubleshooting.md) | 常见报错、数据异常与口径问题 | 页面空白 / 图表为空 |
| [astro-experiments.md](./astro-experiments.md) | 模板已验证的 Astro 模式与本项目迁移时的落点 | 执行 Astro 迁移 |

## 约定

1. 每个 commit / PR 必须通过当前验证门禁：`bun run check` + `bun run build`。
2. 手工验证要写清路径与预期；未执行的检查标注「未验证」。
3. 验收标准必须能失败：测试接入后，故意改坏被测行为时相关测试应变红。
4. 新 Bug 模式写 postmortem，预防项同步 `AGENTS.md` 或本目录规范。
5. 当前实现是 React Router 8 + Vite；迁移到 Astro 后，本目录的 `code-style.md`、`release-checklist.md`、`development.md` 要同步改写，不保留双份事实。
