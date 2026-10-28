# 路线图

## 近期（下一步）

当前没有排期中的事项。下一批建议从「体验」的图表导出 / 日历热力图，或「工程」的运行时校验 / 部署 workflow 里挑。

## 数据

- [ ] 补齐其他成员（`data/<id>/` + `data-sources.json` 即可，不需要改组件）。
- [ ] 全频道历史场次，而不只是最近的批次（进度 **48/262**，见 [data-progress.md](data-progress.md)）。
- [ ] 精确词频 / 发言者：现在只有各场 Top 40 / Top 20；要精确值需在 datapack 里加全量聚合或原始弹幕索引。
- [ ] 同接时间序列：VSTATS 只给平均/最大；若以后有采样源，可加曲线。
- [ ] 评论增长快照：同一场多次抓取，观察评论随时间的变化。
- [ ] 内容标签：把场次按「弹唱 / 杂谈 / 游戏 / 复盘 / 会员限定」分类，做分组对比。
- [ ] 与其他成员的横向对比：同一时间段、同一内容类型的同接/弹幕/付费。

## 分析

- [ ] 周/月趋势：场次频率、平均同接、弹幕总量的滚动均值。
- [ ] SC 留言主题：简单关键词/共现，不引入重型 NLP。
- [ ] 观众重叠：需要全量作者列表（当前只有 Top 20），或额外的作者索引文件。
- [ ] 峰值解释：把峰值分钟与人工标注的事件（抽卡、公布、读 SC）对齐。
- [ ] 内容类型 × 指标的相关性：例如「弹唱回的平均同接 vs 游戏回」。

## 体验

- [x] URL 状态：`#/:datasetId/stream/:videoId`，单场与对比选择可分享、可前进后退。
- [x] 侧边栏导航（可折叠，移动端 Sheet），数据加载一次不随路由重复请求。
- [x] 数据表筛选写 URL：`q` / `sort` / `dir` / `vstats` 随 hash 路由保存，刷新与分享可还原。
- [x] 复制深链：单场与对比页的「复制链接」按钮，复制当前 hash URL（含查询参数）。
- [x] 图表导出 PNG/SVG：ChartCard 右上角可导出当前 SVG，样式内联，PNG 为 2× 画布。
- [ ] 日历热力图：按日期看更新频率与热度。
- [x] 键盘快捷键：`j` / `k` 切场、`1`–`5` 切页面、`/` 聚焦搜索。
- [x] 移动端优化：375px 下侧栏 Sheet、数据表横向滚动、图表触控 tooltip 均已回归。
- [ ] 空数据/部分数据的更明确提示（已有基础版）。

## 工程

- [x] 用 valibot 做运行时 schema 校验：`scripts/validate-schema.ts` 校验 index / manifest / insights / datapack，替代手写字段检查。
- [ ] 数据 schema 版本迁移：`v1 → v2` 的兼容层。
- [x] 按路由 `React.lazy()` 拆包，降低首屏 JS。
- [x] 路由错误边界：根路由与 `:datasetId` 的 `errorElement`，渲染或懒加载异常有兜底与重试。
- [x] Playwright / agent-browser 冒烟测试：首页、单场深链刷新、无效 id、对比深链、前进后退（`bun run test:smoke`）。
- [x] 可访问性审计：axe 覆盖总览/单场/对比/数据表，0 violations；CWV LCP ~1.1s、CLS 0。
- [x] 部署 workflow：`.github/workflows/deploy.yml` 发布 GitHub Pages，`VITE_BASE` 支持子路径；Pages 不支持自定义缓存头，缓存策略见部署文档。
- [x] datapack 拆成「摘要 + 明细」：`manifest.json` + `insights.json` 先渲染，单场/对比按需加载 datapack。

## 非目标

- 不做实时抓取 / 直播中数据。
- 不做用户系统、评论、收藏。
- 不做内容正文的翻译或字幕编辑（那是归档 pipeline 的职责）。
