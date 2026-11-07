# AGENTS.md

本文件是 AI Agent 的协作入口。人类贡献者先读 [CONTRIBUTING.md](./CONTRIBUTING.md)。
项目文档的唯一入口是 [docs/README.md](./docs/README.md)。本文件只保留每次任务都成立的约束；领域细节按需读取，不要复制回来。

## 项目一句话

夢限大みゅーたいぷ 直播数据站：Astro 7 + Cloudflare Workers + Neon PostgreSQL，请求期 SSR；数据由 datapack ingest 入库，媒体与逐字稿正文放 R2。线上 `https://ymmt.chilfish.top`。

## 先读哪里

| 任务 | 先读 |
| --- | --- |
| 任何任务开始前 | [docs/README.md](./docs/README.md) |
| 新增功能 / 判断边界 | [requirements-spec.md](./docs/requirements/requirements-spec.md) |
| 架构 / 数据流 / 路由 | [architecture.md](./docs/planning/architecture.md) |
| 写代码 | [code-style.md](./docs/engineering/code-style.md) |
| 改 UI / 判断信息该不该上屏 | [ui-design/README.md](./docs/ui-design/README.md) + [information-density.md](./docs/ui-design/information-density.md) |
| 写码前防复现 | [postmortem/README.md](./docs/postmortem/README.md) |

任务意图 → 文件见 [code-map.md](./docs/engineering/code-map.md)；规划、发布、本地开发等入口见 [docs/README.md](./docs/README.md)。

## 强制规范

1. **文档先行**：每个任务第一步更新 `docs/planning/backlog.md` 或对应方案文档；实现过程中同步记录 `docs/development-log/YYYY-MM-DD.md`。
2. **验证先行**：功能先写可验证的验收标准（FR / AC），再实现。
3. **验证必须携带信号**：手工验证写清操作路径与预期结果；自动化测试要能失败。
4. **先读基线雷区**：写码前对照 [postmortem/README.md](./docs/postmortem/README.md)；新 Bug 模式回写。
5. **Commit 纪律**：先定 Conventional Commit message；超过 10 个文件或 200 行主动拆分。
6. **文档即事实**：路径、命令、路由、字段名与代码一致；改代码时同步文档与 `docs/README.md` 索引，不留死链；未完成项不写成现状。
7. **文案遵循规范**：文档与界面文案按 [writing-style.md](./docs/writing-style.md)。
8. **界面信息克制**：一屏回答一个问题；同一数字 / 名称 / 状态只出现一次；不在界面写统计口径，不加自证式导航。

## 不可协商的技术约束

- 页面只读 PostgreSQL；R2 只放不可变对象；不为单个数字拉整份 pack 或整表聚合。
- 所有数据获取覆盖 loading / empty / error；`null` 不画成 0，跳过或显示「—」。
- 颜色只用设计 Token；浅色 / 深色同时成立；不用 `dark:` 覆盖颜色。
- 站内导航用 `<a href>` + ClientRouter，脚本内用 `navigate()`；不要 `window.location.href`。
- 页面在 `src/pages/*.astro`；数据页 `prerender = false`，稳定页 `true`；不要重新引入 `react-router`。
- 服务端密钥只从 `astro:env/server` 读；R2 凭据不进客户端 bundle。

## 工作流

1. 读 [docs/README.md](./docs/README.md) 的对应文档，再读相关源码。
2. 在 [backlog.md](./docs/planning/backlog.md) 登记任务；复杂功能先写验收标准；实现中记录开发日志。
3. 写码前对照 [postmortem/README.md](./docs/postmortem/README.md) 的基线雷区。
4. 验证：`bun run check` + `bun run build`；按改动追加 `db:verify` / `db:query` / `db:bench` / `validate:data` / `test:smoke`。
5. 新 Bug 模式写 postmortem；审查问题登记 backlog。

## 维护本文件

- 只写每次任务都成立、且 Agent 无法从代码或 docs 推断的约束。
- 领域规则、目录树、多步流程与完整反模式表放在 `docs/` 或 skills，这里只留链接。
- 同一条规则只留一处；发现重复或矛盾时先删。
- 每季度审一次；Agent 能自己做对或已经过期的规则删掉。
- 取舍依据见 [AGENTS.md 的结构与长度](./docs/research/agents-md-structure.md)。
