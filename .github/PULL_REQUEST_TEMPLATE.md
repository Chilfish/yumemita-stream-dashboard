## 概要

<!-- 做了什么，为什么这样做。关联 issue / FR 编号。 -->

## 类型

- [ ] 功能（feat）
- [ ] 修复（fix）
- [ ] 重构（refactor）
- [ ] 数据（data）
- [ ] 文档（docs）
- [ ] 构建 / 工具（chore）

## 验证

- [ ] `bun run check` 通过
- [ ] `bun run build` 通过
- [ ] `bun run validate:data` 通过（改数据时）
- [ ] `bun run verify:seo` 通过（改路由 / SEO / 构建时）
- [ ] 相关页面已手工走查，路径与结果：

```text
（例如 /nonoka/stream/<videoId>，浅色 / 深色，390px）
```

- [ ] 未执行的检查已在下方标注「未验证」并说明原因

## 数据与迁移

- [ ] 未手改 `manifest.json` / `insights.json`
- [ ] 新增 / 修改数据已跑 `validate:data`；发布后跑过 `--remote`
- [ ] 会员限定内容公开范围已确认
- [ ] 如涉及 Astro / PostgreSQL 迁移：当前实现与目标形态分开写，未实现项标 `📋`

## UI

- [ ] 浅色 / 深色同时成立
- [ ] 390 / 320px 无横向溢出（表格自身滚动除外）
- [ ] 焦点可见；图标按钮有可访问名称；图表有 `aria-label`
- [ ] 空态、加载态、错误态齐全
- [ ] 截图 / 录屏（如适用）

## 文档

- [ ] 相关文档已更新，`docs/README.md` 索引无死链
- [ ] `CHANGELOG.md` 已更新（如适用）
- [ ] 文案符合 `docs/writing-style.md`
- [ ] 新 Bug 模式已写 postmortem（如适用）

## 备注

<!-- 风险、回滚方式、未完成项、需要 reviewer 关注的点。 -->
