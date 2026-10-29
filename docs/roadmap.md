# 路线图

## 近期（下一步）

方向与验收标准见 [product-direction.md](product-direction.md)。

1. **封面图**：`fetch:thumbs` 镜像 `video.thumbnail`，发布到对象存储，单场页与最近场次展示。
2. **相册页**：成员 / 全组封面墙，按月分组，懒加载，URL 可分享。
3. **逐字稿**：作者手动维护 Markdown，发布到对象存储后运行时渲染；时间戳跳转 YouTube。
4. **组首页与跨成员对比**：首屏回答「最近谁播了 / 下一场」，对比支持跨成员选场次。
5. **精确词频 / 发言者**：需要 datapack schema v2（全量聚合或作者索引），先设计兼容层。

## 数据

- [x] 全频道历史场次：**262 / 262**（2023-11-19 – 2026-10-22），见 [data-progress.md](data-progress.md)。
- [ ] 补齐其他成员（`data/<id>/` + `data-sources.json`，不需要改组件）。
- [x] 内容标签：`src/lib/classify.ts` 标题规则，首页「内容构成」已使用。
- [ ] 精确词频 / 发言者：现在只有各场 Top 40 / Top 20；要精确值需在 datapack 里加全量聚合或原始弹幕索引。
- [ ] 同接时间序列：VSTATS 只给平均/最大；若以后有采样源，可加曲线。
- [ ] 评论增长快照：同一场多次抓取，观察评论随时间的变化。
- [ ] 与其他成员的横向对比：同一时间段、同一内容类型的同接/弹幕/付费。

## 分析

- [x] 趋势页：场次频率、弹幕/分、SC 的月度趋势与明细表；典型节奏曲线、全期高频词/发言者已从首页移入趋势页。
- [x] 内容类型 × 指标：趋势页对比弹唱 / 活动 / 杂谈 / 游戏的场次、时长、弹幕/分、SC/小时。
- [ ] SC 留言主题：简单关键词/共现，不引入重型 NLP。
- [ ] 观众重叠：需要全量作者列表（当前只有 Top 20），或额外的作者索引文件。
- [ ] 峰值解释：把峰值分钟与人工标注的事件（抽卡、公布、读 SC）对齐。

## 体验

- [x] URL 状态：`#/:datasetId/stream/:videoId?view=`，单场、子视图与对比选择可分享、可前进后退。
- [x] 侧边栏导航（可折叠）+ 移动端底部标签栏与成员 Sheet。
- [x] 数据表筛选写 URL：`q` / `type` / `sort` / `dir` / `vstats` 随 hash 路由保存。
- [x] 复制深链：单场与对比页的「复制链接」按钮。
- [x] 图表导出 PNG/SVG：ChartCard 右上角导出当前 SVG，PNG 为 2× 画布。
- [x] 更新日历：按 JST 自然日查看场次 / 弹幕 / SC 热度，支持指标切换。
- [x] 趋势页：月度趋势、月度明细、内容类型对比、典型节奏曲线、社群榜单。
- [x] 首页层级：规模指标条 → 最近一场 + 本月 → 最近场次 → 更新日历；修复页面横向溢出（`min-w-0` + 图表行内尺寸隔离）。
- [x] 键盘快捷键：`j` / `k` 翻场、`1`–`5` 切页、`/` 搜索、`⌘K` 全局搜索、`⌘B` 侧栏。
- [x] 移动端优化：390 / 320px 无横向溢出，表格自身横向滚动，首列吸附。
- [ ] 封面图：镜像 `video.thumbnail` 到对象存储，单场页 / 最近场次展示，含兜底图。
- [ ] 相册页：成员与全组封面墙，按 JST 自然月分组，懒加载。
- [ ] 逐字稿：`content/transcripts/` 手动维护，发布后运行时渲染，支持时间戳跳转。
- [ ] 组首页与跨成员对比：全组脉搏与跨成员选场。
- [ ] 推文联动：先用手动 pin 验证价值，外部服务只做增强。
- [ ] 空数据 / 部分数据的更明确提示（已有基础版）。

## 工程

- [x] 用 valibot 做运行时 schema 校验：`scripts/validate-schema.ts` 校验 index / manifest / insights / datapack。
- [ ] 数据 schema 版本迁移：`v1 → v2` 的兼容层。
- [x] 按路由 `React.lazy()` 拆包，降低首屏 JS。
- [x] 路由错误边界：根路由与 `:datasetId` 的 `errorElement`。
- [x] agent-browser 冒烟测试：首页、单场深链刷新、无效 id、对比深链、趋势深链、前进后退。
- [x] 可访问性审计：首页 / 场次 / 单场 / 对比（桌面 + 移动）axe 0 violations。
- [x] 对象存储：datapack 与索引走 S3 / R2，`VITE_DATAPACK_BASE` 构建时注入。
- [x] 发布即生效：页面运行时直接读远端 `index.json` + `manifest.json` + `insights.json`，`publish:data` 后刷新即可，不再依赖重新构建。
- [x] 索引与明细拆分：首屏只拉 `index.json` + 当前 dataset 的 manifest/insights，单场按需拉 datapack。
- [x] CI 从对象存储拉索引；`VITE_DATAPACK_BASE` 缺失时给出明确报错。
- [x] 在 GitHub 仓库设置 `VITE_DATAPACK_BASE` repository variable（HTTPS 地址）。
- [ ] `ObjectStore` 支持二进制上传与 `Content-Type` / `Cache-Control`，供封面与逐字稿资源使用。
- [ ] `fetch:thumbs` / `publish:transcripts` 脚本：增量、可续跑、单条失败不阻塞。
- [ ] 200% 缩放复核（320px 已通过）。

## 非目标

- 不做实时抓取 / 直播中数据。
- 不做用户系统、评论、收藏。
- 不做内容正文的翻译或字幕编辑（那是归档 pipeline 的职责）。
- 不做逐字稿编辑器 / CMS（独立项目，见 [product-direction.md](product-direction.md) §6.5）。
