# 贡献指南

## 开发

```bash
bun install
bun run dev
```

提交前跑：

```bash
bun run check
bun run build
```

## 分支与提交

- 从 `main` 开分支：`feat/...`、`fix/...`、`docs/...`、`data/...`。
- 提交信息用祈使句，说明“做了什么”：
  - `feat: add compare view`
  - `fix: handle null vstats in stream view`
  - `data: add 2026-10-22 stream`
  - `docs: document datapack fields`
- 一个提交只做一件事；数据更新与代码改动尽量分开。

## 数据改动

- 新增场次：把 pack 放进 `data/<dataset>/`，然后跑 `bun run publish:data`（会重建 manifest + insights 并上传对象存储）。
- 不要手写或手改 manifest / insights：它们由 pack 派生。
- 数据文件必须能通过 `bun run validate:data`；发布后加 `--remote` 确认对象存储可达。
- 不要提交 `data/`（除 `README.md`）、`public/data/`、`dist/`、原始媒体/弹幕/评论抓取。
- 会员限定内容：确认可公开范围；不确定就不要放到公开桶里。

## 代码改动

- 纯逻辑放 `src/lib/`，并补对应 `.test.ts`。
- 新组件遵循现有分层：`dashboard/`（页面）、`charts/`（D3）、`ui/`（coss 生成）。
- 不修改 `src/components/ui/` 里的业务逻辑；需要定制时用 props / `render` / `className`。
- 新图表必须处理空数据与 `null`，并加 `aria-label` / `<title>`。
- 改字段/口径时同步更新 `docs/data-model.md`。

## PR 检查清单

- [ ] `bun run check` 通过
- [ ] `bun run build` 通过
- [ ] `bun run validate:data` 通过（如果改了数据）
- [ ] 新增/修改的交互在浅色与深色主题下都能看
- [ ] 移动端窄屏不横向溢出（表格允许自身滚动）
- [ ] 相关文档已更新

## 范围

欢迎数据修正、可访问性改进、图表与文档。以下改动请先开 issue 讨论：

- 改变 datapack schema 的语义
- 引入后端/数据库
- 大规模重构状态管理
- 引入新的 UI/图表框架
