# 项目文档

> **本文档是项目文档的唯一入口。** 处理任务前先读本页，再按「按任务导航」读取对应文档，不要一次性全读。
>
> 当前是 **Astro 7 + Cloudflare Workers + Neon PostgreSQL** 形态：全部页面请求期查库，`.md`、sitemap、llms、purge 端点已实现。已合并到 `main` 并部署在 `ymmt.chilfish.top`。方案与实现说明见 [planning/astro-ssr-migration.md](./planning/astro-ssr-migration.md)。

## 一、文档目录

```text
docs/
├── README.md                    # 本文档（唯一入口）
├── writing-style.md             # 文档与界面文案的写作规范
├── requirements/                # 需求真相源（PRD / 用户故事 / 验收标准）
│   ├── README.md
│   ├── requirements-spec.md
│   └── user-stories.md
├── planning/                    # 架构、任务清单、阶段方案
│   ├── README.md
│   ├── architecture.md
│   ├── backlog.md
│   ├── astro-ssr-migration.md
│   ├── transcript-index.md
│   ├── db-optimization.md
│   ├── performance-audit.md
│   ├── live-calendar.md
│   ├── share-card.md
│   ├── product-direction.md
│   ├── ui-refactor.md
│   └── ui-refactor-progress.md
├── engineering/                 # 工程规范、开发、部署、性能、排查
│   ├── README.md
│   ├── code-style.md
│   ├── git-workflow.md
│   ├── release-checklist.md
│   ├── development.md
│   ├── local-database.md
│   ├── deployment.md
│   ├── schedule-admin.md
│   ├── performance.md
│   ├── troubleshooting.md
│   └── astro-experiments.md
├── data/                        # 数据模型、加数据、抓取进度
│   ├── README.md
│   ├── data-model.md
│   ├── chat-events.md
│   ├── adding-data.md
│   └── data-progress.md
├── ui-design/                   # 设计系统与 coss 组件规范
│   ├── README.md
│   ├── GENERAL.md
│   ├── chat-visualization.md
│   └── time-input.md
├── postmortem/                  # 事故复盘与基线雷区
│   ├── README.md
│   └── TEMPLATE.md
├── reviews/                     # 代码审查记录
│   ├── README.md
│   └── TEMPLATE.md
├── development-log/             # 按天开发日志
│   ├── README.md
│   ├── 2026-11-03.md
│   └── 2026-11-04.md
└── archive/                     # 历史调研与已完成阶段方案
    ├── README.md
    └── ssg-research.md
```

## 二、按任务导航

| 任务场景 | 先读 | 说明 |
| --- | --- | --- |
| 新增功能 / 判断功能边界 | [requirements-spec.md](./requirements/requirements-spec.md) + [user-stories.md](./requirements/user-stories.md) | FR 编号、验收标准、范围 |
| 架构级变更 | [architecture.md](./planning/architecture.md) | 分层、数据流、路由与关键决策 |
| 规划下一阶段 | [backlog.md](./planning/backlog.md) | 未决任务、优先级、前置条件 |
| 迁移到 Astro / PostgreSQL | [astro-ssr-migration.md](./planning/astro-ssr-migration.md) + [astro-experiments.md](./engineering/astro-experiments.md) | 目标架构、数据模型、`.md` 路由、缓存与发布 |
| 规划 / 实现直播日历 | [live-calendar.md](./planning/live-calendar.md) | 未来场次、手工日程、月历与议程视图、缓存与验收 |
| 优化数据库读路径 | [db-optimization.md](./planning/db-optimization.md) | 查询条数、往返、传输量、缓存与压测 |
| 写代码 | [code-style.md](./engineering/code-style.md) + [writing-style.md](./writing-style.md) | 命名、组件、数据边界、文案 |
| 本地开发 / 测试 | [development.md](./engineering/development.md) + [local-database.md](./engineering/local-database.md) | 环境、脚本、D3、测试；本地 Postgres 与开发代理 |
| Commit / PR | [git-workflow.md](./engineering/git-workflow.md) + [../.github/PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md) | 分支、提交纪律、审查清单 |
| 发布 | [release-checklist.md](./engineering/release-checklist.md) + [deployment.md](./engineering/deployment.md) | 验证、冒烟、部署、回滚 |
| 维护未来日程 / Agent 录日程 | [schedule-admin.md](./engineering/schedule-admin.md) + [live-calendar.md](./planning/live-calendar.md) | 管理端、幂等、时段与关联规则 |
| 改分享卡片 / 分享截图 | [share-card.md](./planning/share-card.md) | React + Tailwind 布局、官方背景、modern-screenshot 导出 |
| 性能回归 | [performance.md](./engineering/performance.md) | 首屏数据流、缓存分层、实测数字 |
| 做全栈性能优化 | [performance-audit.md](./planning/performance-audit.md) | 岛屿拆分、props 收敛、交互热点、ingest / publish 与优先级 |
| 排查页面 / 数据问题 | [troubleshooting.md](./engineering/troubleshooting.md) | 常见报错与口径 |
| 读写数据 / 加场次 | [data-model.md](./data/data-model.md) + [adding-data.md](./data/adding-data.md) | 字段、口径、发布步骤 |
| 弹幕 / 事件字段与事件类型 | [chat-events.md](./data/chat-events.md) | 消息记录、事件记录、去重、表情索引、已知限制 |
| 做弹幕可视化 / 时间线 | [chat-visualization.md](./ui-design/chat-visualization.md) + [ui-design/README.md](./ui-design/README.md) | 数据契约、行类型、虚拟化、导入与正式化路径 |
| 查看抓取进度 | [data-progress.md](./data/data-progress.md) | 已入库场次、跳过判定、下一批候选 |
| 改 UI / 组件 | [ui-design/README.md](./ui-design/README.md) + [GENERAL.md](./ui-design/GENERAL.md) | Token、排版、coss 原子组件；时间输入见 [time-input.md](./ui-design/time-input.md) |
| 写文档 / 界面文案 | [writing-style.md](./writing-style.md) | 语气、用词、术语、反例 |
| 代码审查 | [reviews/README.md](./reviews/README.md) + [TEMPLATE.md](./reviews/TEMPLATE.md) | 审查视角、问题分级、承接流程 |
| 写代码前防复现 | [postmortem/README.md](./postmortem/README.md) | 基线雷区、高危文件 |
| 了解历史决策 | [development-log/](./development-log/) + [archive/](./archive/) | 按日期查阅；存档不主动读 |

## 三、文档生命周期

```text
需求与规划 → 工程规范 → 功能实现 → 反馈沉淀 → 存档
requirements/ planning/ → engineering/ → 代码 → postmortem/ reviews/ development-log/ → archive/
```

| 事件 | 动作 |
| --- | --- |
| 新功能 / 需求变更 | 先更新 `requirements/` 与 `planning/backlog.md`，再实现 |
| 架构级决策 | 追加到 `planning/architecture.md` 的 ADR |
| 新 Bug 模式 / 返工 | 写 `postmortem/0NN-*.md`，教训进入「基线雷区」 |
| 每次代码审查 | 记录 `reviews/review-YYYY-MM-DD-<主题>.md`，问题登记 backlog |
| 每天收尾 | 记录 `development-log/YYYY-MM-DD.md` |
| 阶段计划完成 | `git mv` 到 `archive/`，更新本页索引 |
| 里程碑发布 | 走 `engineering/release-checklist.md` |

## 四、文档约定

1. **语言**：文档用简体中文；代码、命令、字段名、commit message 用英文。
2. **单一入口**：新增、删除、移动文档时同步更新本页；索引只列存在的文件。
3. **文档即事实**：路径、命令、路由、字段名必须与当前代码一致；改代码时同步清理旧引用。
4. **不把计划当现状**：未完成的内容放 `planning/backlog.md` 或 `planning/todo-*.md`，正文只写已经成立的事实。
5. **迁移期**：Astro / PostgreSQL 的内容写在 `planning/`，不要写成当前实现；当前命令仍以 `package.json` 为准。
6. **写作**：按 [writing-style.md](./writing-style.md) 执行。不堆形容词和黑话，数字带单位，链接写清指向。
7. **复盘 blameless**：postmortem 归因于系统条件，不归因于个人。
8. **存档不主动读取**：`archive/` 只作历史参考。

## 五、验证

当前仓库的验证命令（以 `package.json` 为准）：

```bash
bun run check          # astro check + vitest + oxlint
bun run build          # astro build（Worker + 预渲染 404/500）
bun run preview        # Cloudflare workerd 预览
bun run db:bench       # 冷渲染 SQL / HTTP 往返与 p50/p95（本地库）
bun run validate:data  # 校验旧数据链路的 index / manifest / insights / group-*
```

- 涉及页面的改动必须在 `bun run dev` 或 `bun run preview` 下手工走查相关路径。
- 数据改动要跑 `validate:data`；发布后加 `--remote` 确认对象存储可达。
- 不把「构建通过」当作功能已验证；未执行的检查标注「未验证」。
- 阶段 1 接入 PostgreSQL 后，验证会补上 `scripts/verify-db.ts` 与 `.md` 端点检查。

## 六、根目录文档

| 文档 | 说明 |
| --- | --- |
| [README.md](../README.md) | 项目介绍、技术栈、路由、环境变量、部署 |
| [AGENTS.md](../AGENTS.md) | AI Agent 协作指南（意图 → 文件映射、强制规范） |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | 人类贡献者指南 |
| [CHANGELOG.md](../CHANGELOG.md) | 变更日志 |
| [NOTICE.md](../NOTICE.md) | 数据与内容版权说明 |
| [SECURITY.md](../SECURITY.md) | 安全问题报告方式 |
| [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | 行为准则 |
