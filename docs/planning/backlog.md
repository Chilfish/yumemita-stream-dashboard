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
| B19 | 性能审计剩余项：props 收敛、壳层流式输出、ingest / publish 批量化 | P1 | 无 | 2026-11-05 巡检 | 🚧 已完成逐字稿 DEV 守卫、列表窄列、对比页密度 API、单场页取数收敛、搜索防抖、context memo、图表 hover 节流、命令面板按需加载、按路由拆岛屿（B42）；剩余项见 [performance-audit.md](performance-audit.md) |
| B27 | 界面冗余清理：其余页面按 [information-density.md](../ui-design/information-density.md) 逐页扫描 | P1 | 无 | 2026-11-07 首页讨论 | 🚧 首页完成；其余页面待扫 |
| B31 | 同接时间序列：VSTATS 只给平均 / 最大，若有采样源再加曲线 | P3 | 采样数据源 | 2026-11-03 roadmap | 📋 |
| B32 | SC 留言主题：简单关键词 / 共现，不引入重型 NLP | P3 | 无 | 2026-11-03 roadmap | 📋 |
| B33 | 峰值解释：把峰值分钟与人工标注的事件对齐 | P3 | 事件标注数据 | 2026-11-03 roadmap | 📋 |
| B34 | 推文联动：先用手动 pin 验证价值，外部服务只做增强 | P3 | 无 | roadmap | 📋 |
| B35 | 空数据 / 部分数据的更明确提示（已有基础版） | P3 | 无 | roadmap | 🚧 2026-11-24 完成单场页与图表空态归因（`data-availability.ts` + `DataEmpty`）；`captured` 三态字段仍待做 |
| B39 | `/gallery` 载荷：SSR 只渲染首屏，其余按页从服务端拉取，别把 1,837 行塞进 `astro-island` props（当前 1.71 MB / 全页 1.89 MB） | P2 | 需要新端点与三态 | 2026-11-15 审计 | 📋 背景见 [seo-audit-2026-11-15.md](../research/seo-audit-2026-11-15.md) |
| B40 | `ymmt-s3.chilfish.top` 加 Cloudflare Cache Rule：`Cache-Control: public, max-age=31536000, immutable`（现为 R2 默认 4 小时） | P2 | 无 | 2026-11-15 审计 | 📋 桶侧配置，代码改不了 |
| B41 | 部署后线上复测 Lighthouse：mobile preset（首页）、桌面 preset（对比度复核），以及逐字稿页的 SSR 与 CSP 修复 | P3 | 需先部署 | 2026-11-15 审计 | 🚧 线上复核与修复见 [seo-audit-2026-11-15.md](../research/seo-audit-2026-11-15.md) 第八节；本地生产构建 a11y / BP / SEO 均 100，线上数字仍待复测 |
| B43 | 公开域名 `ymmt-s3.chilfish.top` 可直接下载 `archive/` 与 `*/transcripts/`（会限正文与原始 pack）：先加 WAF block，再把两类对象迁到私有桶并补匿名可达性检查 | P0 | Cloudflare 配置 / 新桶 | 2026-11-15 安全自查 | 🚧 误传的 1 个会限逐字稿已删除；125 个会限 archive pack 仍公开，见 [postmortem 006](../postmortem/006-public-r2-member-only-leak.md) |
| B44 | `/admin`、`/api/admin` 与会限 API 加 Cloudflare Rate Limiting；`MEMBER_ONLY_KEY` 改为 32 位以上随机值并建立轮换 | P1 | 无 | 2026-11-15 安全自查 | 📋 见 [security-review-2026-11-15.md](../research/security-review-2026-11-15.md) |
| B49 | 类名体积：把表格 / 列表里重复的长 cva 类串收成语义类（`/arale/streams` 一条 352 字符的 `td` 类名重复 400 次 = 140 KB raw）；类名重命名只在 CSS 侧有确定性收益，先用 `npx minwind measure` 出只读预估再决定 | P2 | 无 | 2026-11-15 类名调研 | 📋 实测与方案对比见 [ssr-html-classname-weight.md](../research/ssr-html-classname-weight.md) |
| B50 | 成员串门发言：单场 `chat.memberChats` + `?view=words` 独立区块；历史 143 场回填 | P2 | 无 | 2026-11-18 需求 | 🚧 本地与线上数据回填完成、对账 0 问题；等待部署上线。方案见 [member-chats.md](member-chats.md) |
| B51 | 官方账号场次：官方场次独立归属、不并入成员个人场次；`data update` 只同步配置账号，其他官方场次手动添加 | P1 | 无 | 2026-11-21 需求 | 🚧 POC 通过（查询 / 日历 / 相册 / 页面 / 门禁）。2026-11-23 `bangdream` 改为 `manual`，不回补、不自动抓取，`filtered` 暂不实现；待办：官方 dataset 的 insights 并入 ingest。方案见 [official-channels.md](official-channels.md) |
| B52 | `data update` 成员并发已完成，但真实并发下载路径未验证（当天全部安静日）；下次有新场次时确认并发上限与限流表现 | P2 | 需有新场次的日子 | 2026-11-24 并发改造 | 📋 代码见 [concurrency.md](../engineering/concurrency.md) 的两阶段编排 |

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
