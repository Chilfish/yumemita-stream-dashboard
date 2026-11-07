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
- [ ] `bun run db:verify` 通过（改 ingest / 数据时）
- [ ] `bun run db:query` 通过（改查询层时）
- [ ] `bun run test:smoke` 通过（改路由时，先启动 preview）
- [ ] 相关页面已手工走查，路径与结果：

```text
（例如 /nonoka/stream/<videoId>，浅色 / 深色，390px）
```

- [ ] 未执行的检查已在下方标注「未验证」并说明原因

## 数据与迁移

- [ ] 未手改 `manifest.json` / `insights.json`
- [ ] 新增 / 修改数据已跑 `db:ingest` 与 `db:verify`
- [ ] 会员限定内容公开范围已确认
- [ ] 如涉及未完成能力：文档标 `📋`，不写成现状

## UI

- [ ] 浅色 / 深色同时成立
- [ ] 390 / 320px 无横向溢出（表格自身滚动除外）
- [ ] 焦点可见；图标按钮有可访问名称；图表有 `aria-label`
- [ ] 空态、加载态、错误态齐全
- [ ] 信息密度：同一数字 / 名称不重复；无口径脚注与自证式导航
- [ ] 截图 / 录屏（如适用）

## 文档

- [ ] 相关文档已更新，`docs/README.md` 索引无死链
- [ ] `CHANGELOG.md` 已更新（如适用）
- [ ] 文案符合 `docs/writing-style.md`
- [ ] 新 Bug 模式已写 postmortem（如适用）

## 备注

<!-- 风险、回滚方式、未完成项、需要 reviewer 关注的点。 -->
