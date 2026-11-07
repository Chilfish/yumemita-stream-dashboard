# Git 开发流程

**项目**：yumemita-stream-dashboard | **最后更新**：2026-11-03

## 分支模型

采用简化版 Trunk-Based Development：

```text
main ─────●─────●─────●─────●──→（始终可部署）
           \     /
feat/xxx ──●───●
```

| 分支类型 | 命名格式 | 用途 | 生命周期 |
| --- | --- | --- | --- |
| `main` | — | 稳定分支，始终可部署 | 永久 |
| `feat/*` | `feat/agent-markdown` | 功能开发 | 合并后删除 |
| `fix/*` | `fix/null-vstats` | Bug 修复 | 合并后删除 |
| `refactor/*` | `refactor/router-compat` | 重构 | 合并后删除 |
| `docs/*` | `docs/adopt-doc-structure` | 文档更新 | 合并后删除 |
| `data/*` | `data/add-2026-11-02` | 数据更新 | 合并后删除 |

数据更新与代码改动尽量分开提交；`data/` 是本地暂存区，不进 git。

## Commit 规范

遵循 [Conventional Commits 1.0.0](https://www.conventionalcommits.org/)。

```text
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

| Type | 说明 | 示例 |
| --- | --- | --- |
| `feat` | 新功能 | `feat(agent): add stream markdown endpoint` |
| `fix` | Bug 修复 | `fix(stream): handle null vstats` |
| `refactor` | 重构（不改变行为） | `refactor(data): extract manifest builder` |
| `test` | 测试 | `test(aggregate): cover peak minute` |
| `docs` | 文档 | `docs: adopt documentation structure` |
| `style` | 格式化 | `style: reorder imports` |
| `chore` | 构建 / 工具 | `chore(ci): add verify step` |
| `perf` | 性能优化 | `perf(gallery): defer image decode` |
| `data` | 数据变更 | `data: add 2026-11-02 stream` |

规则：

- Description 用英文祈使句：`add`、`fix`、`remove`。
- 首字母小写、不加句号、不超过 72 字符。
- Breaking change 在 footer 标记 `BREAKING CHANGE: description`。
- 先想 commit message，再动工；diff 超过 10 个文件或 200 行时主动拆分。

## 验证门禁

每个 commit / PR 合并前必须通过：

```bash
bun run check          # typecheck + test + lint
bun run build          # astro build（Worker + 预渲染 404/500/about）
bun run db:verify      # 改 ingest / 数据时必跑
bun run db:query       # 改查询层时必跑
```

- 涉及页面的改动必须在 `bun run dev` 或 `vite preview` 下手工走查相关路径，并写清结果。
- 不把「构建通过」当作功能已验证。
- 未执行的检查标注「未验证」，并说明原因。
- 不接受「既有红灯」作为基线；已知失败先修或移除。

## 代码审查

1. 创建 PR，按 [`.github/PULL_REQUEST_TEMPLATE.md`](../../.github/PULL_REQUEST_TEMPLATE.md) 填写。
2. 单人项目由作者自查；有协作者时至少 1 人 Approve。
3. 审查问题登记进 [planning/backlog.md](../planning/backlog.md) 的「审查承接区」。
4. 检查通过后 Merge，保留原子 commit。
5. Merge 后删除 feature 分支。

### 审查清单

- [ ] 逻辑正确，边界情况有处理
- [ ] 数据路径三态覆盖；回退时标明来源
- [ ] 无硬编码颜色；浅色 / 深色都成立
- [ ] 导航可分享、可刷新、可前进后退
- [ ] 服务端密钥未进入客户端 bundle
- [ ] 无障碍：焦点可见，图标按钮有可访问名称，图表有 `aria-label`
- [ ] UI 变更附带截图或手工路径与结果
- [ ] 相关文档已更新（`docs/`、索引、`CHANGELOG.md`）
- [ ] 文档与界面文案符合 [writing-style.md](../writing-style.md)
- [ ] 路径、命令、路由仍能对上代码；无死链
- [ ] 新 Bug 模式写 postmortem

## 部署

当前部署目标是 Cloudflare Workers + Neon PostgreSQL，媒体在 R2；部署入口见 [deployment.md](./deployment.md)：

```bash
bunx wrangler secret put DATABASE_URL
bun run cf:deploy
```

- 部署前跑通验证门禁与 [release-checklist.md](./release-checklist.md)。
- `cf:deploy` 会从零构建、扫描本机地址后部署；不要直接用根 `wrangler.jsonc` 部署。
- 数据更新单独跑 `db:ingest` + `publish:assets` + `purge:cache`，不需要重新构建前端。
- R2 凭据只在上传 / 抓取环境注入，不进入前端构建产物。

## AI 协作开发

- 文档先行：先更新 [planning/backlog.md](../planning/backlog.md) 或方案文档，再写代码。
- 验证先行：先写验收标准，再实现。
- 新库 API 行为不确定时，先写最小 spike 实测，不凭记忆写集成代码。
- 新 Bug 模式写 postmortem，预防项同步到本文件或 postmortem 基线雷区；只有每次任务都成立的约束才进 `AGENTS.md`。
- 文档与界面文案按 [writing-style.md](../writing-style.md) 执行。
