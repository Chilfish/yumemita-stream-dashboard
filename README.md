# ゆめみた 配信数据台

夢限大みゅーたいぷ 成员直播数据的可视化页面，按成员、场次和趋势浏览同接、弹幕、SC 与评论，支持跨场对比和逐字稿。

线上实例：<https://ymmt.chilfish.top>

![组首页](docs/assets/overview.png)

## 收录

只收已结束的直播，按标题去重、保留正片；会员限定场也在内，但同接等统计通常缺失，页面上会标注。

| 成员 | 场次 |
| --- | ---: |
| 宮永ののか | 287 |
| 仲町あられ | 505 |
| 峰月律 | 339 |
| 藤都子 | 321 |
| 千石ユノ | 439 |

合计 1,891 场、691 万条弹幕，时间跨度 2023 年 11 月至 2026 年 10 月。

## 功能

**组首页**

- 近 7 天与本月脉冲、全组最新一场、跨成员最近更新
- 按成员进入；单个成员加载失败不影响其他人

**成员页**

- 规模指标、最近一场、本月变化、全期记录、更新日历
- 场次表：搜索、内容类型筛选、排序、导出 CSV，筛选条件写进 URL
- 日历按天看场次、弹幕、SC 热度

**单场**

- 概览、时间轴、弹幕与词、付费、评论；有逐字稿时多一栏
- 逐分钟弹幕曲线、每 10 分钟分布、高频词、发言者、SC 一览、评论区

**趋势**

- 月度趋势与明细、内容类型对比、典型节奏曲线、全期高频词与发言者

**相册**

- 按日本自然月分组的封面墙，全组相册可按成员和类型筛选

**对比**

- 最多选 4 场，逐分钟弹幕叠加，附指标横表

**其他**

- 深浅色主题，移动端底部标签栏，每个视图都有独立 URL
- 快捷键 `j` / `k` 翻场、`1`–`5` 切页、`/` 聚焦搜索、`⌘K` 全局搜索、`⌘B` 收起侧栏
- SEO：请求期输出 title / description / canonical / OG / JSON-LD；`sitemap.xml` 与 `llms.txt` 查库生成；旧 `#/...` 链接自动跳转

## 技术栈

- **框架**：Astro 7（`output: 'server'`）+ `@astrojs/cloudflare`
- **前端**：React 19 岛屿、TypeScript
- **UI**：Tailwind CSS v4、coss ui（Base UI + shadcn 风格组件）
- **图表**：D3，只算比例尺与路径，DOM 交给 React
- **测试**：Vitest、oxlint
- **数据**：Neon PostgreSQL（查询）+ Cloudflare R2（封面 / 表情 / 归档 / 逐字稿正文）

## 快速开始

环境要求：Bun 1.4 以上（仓库的 `packageManager` 为 `bun@1.4.4`），Node.js 22.22 以上。

```bash
git clone https://github.com/Chilfish/yumemita-stream-dashboard.git
cd yumemita-stream-dashboard
bun install
bun run dev
```

打开 <http://localhost:4321>。构建与本地预览用 `bun run build` / `bun run preview`（Cloudflare workerd）。

### 配置

把 `.env.example` 复制成 `.env`。

```env
# Neon PostgreSQL（页面查询 + ingest 写入）
DATABASE_URL=postgresql://user:password@ep-xxx.neon.tech/neondb?sslmode=require

# 封面 / 表情的 R2 公开域名，构建时内联
PUBLIC_R2_BASE=https://ymmt-s3.chilfish.top

# 站点根地址，canonical / OG / sitemap / purge 用
SITE_URL=https://ymmt.example.com

# 以下只有发布数据 / 失效缓存时需要
R2_ACCOUNT_ID=""
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_BUCKET="yumemita-data"
PURGE_TOKEN=""
```

页面请求期查数据库，所以新场次 ingest + purge 后刷新即可，不需要重新构建前端。

## 数据

`data/<成员>/*.datapack.json` 是本地暂存区，也是唯一真源。`bun run db:ingest` 把它们事务投影到 PostgreSQL；`bun run publish:assets` 上传封面、表情与原始 pack 归档；`bun run publish:transcripts` 上传逐字稿正文。git 里只有代码、`data-sources.json` 和手写的逐字稿。

日常增量用 `bun scripts/daily-update.ts`（仓库按 14:17 JST 的 cron 每天跑一次，GitHub 调度可能晚几小时）：先和数据库做频道差集，只处理有新场次或缺 VSTATS / 弹幕的成员，然后 ingest、发布资产、purge 缓存。

```text
data/<id>/*.datapack.json            本地暂存
        ├─ bun run db:ingest
        │     ▼
        │   Neon PostgreSQL（datasets / streams / details / insights / transcripts）
        │
        └─ bun run publish:assets
              ▼
            R2  <id>/thumbs/*
                emojis/<id>/*
                archive/<id>/<videoId>.datapack.json
                <id>/transcripts/<videoId>.json
        │
        ▼
请求期 SSR：组首页 / 成员页 / 场次 / 单场 / 趋势 / 相册 / 对比
```

封面同样是本地镜像后再传，不热链 YouTube。数据更新后按 Cache-Tag 失效，不触发前端构建。

## 常用命令

```bash
bun run dev                  # Astro 开发服务器（Cloudflare workerd）
bun run build                # astro build：Worker + 预渲染 404/500
bun run preview              # 本地预览构建产物
bun run check                # astro check + test + lint
bun run ci                   # check + build

bun run db:migrate           # 应用 Drizzle 迁移
bun run db:ingest            # 本地 pack → PostgreSQL（增量）
bun run db:verify            # 数据库与 pack 字段级对账
bun run db:query             # 查询层冒烟 + 本地延迟

bun run publish:assets       # 上传封面 / 表情 / archive（不写 JSON 索引）
bun scripts/daily-update.ts  # 每日增量：频道差集 → 抓取 → ingest → 资产 → purge
bun run publish:transcripts  # 增量上传逐字稿
bun run purge:cache          # 手动按 tag 失效 Workers Cache
bun run fetch:thumbs         # 镜像封面到本地
```

补缺失弹幕、回填 `authorId` 这类一次性修复脚本没有注册到 `package.json`，用法见 [scripts/README.md](scripts/README.md)。

## 加数据

加一场直播：

```bash
bun run add:datapack nonoka /path/to/<videoId>.datapack.json
bun run fetch:thumbs --dataset nonoka
bun run db:ingest --dataset nonoka
bun run publish:assets --dataset nonoka
bun run purge:cache --dataset nonoka
```

加一位成员：新建 `data/<id>/` 放入 pack，在 `data-sources.json` 里加一条 dataset，再 `bun run db:ingest --dataset <id>`。成员入口和页面都是按配置生成的，不用改组件。

逐字稿：`bun run transcript:new <videoId> --dataset nonoka` 建模板，写完执行 `bun run publish:transcripts`。

字段和步骤的细节见 [docs/data/adding-data.md](docs/data/adding-data.md)。

## 部署

目标是 Cloudflare Workers + Neon PostgreSQL + R2。`wrangler.jsonc` 已声明 Worker 入口、`nodejs_compat`、静态资源、R2 binding 与 Workers Cache。

```bash
bun run build          # astro build
bun run cf:deploy      # astro build + wrangler deploy --config dist/server/wrangler.json
```

- 数据页请求期查 Neon；`/`、成员页、场次、单场、趋势、相册、对比都由数据库驱动。
- 单场 Markdown：`/{datasetId}/stream/{videoId}.md`，返回 `text/markdown` 并带逐字稿。
- `sitemap.xml` / `llms.txt` 由 endpoint 生成；`robots.txt` 是静态文件。
- 数据更新后调内部 `POST /api/internal/cache/purge`（Bearer `PURGE_TOKEN`）按 tag 失效。
- 全量场次已入库；已部署到 `ymmt-cf.chilfish.top`，切回原域名后复核 canonical / sitemap。详见 [docs/engineering/deployment.md](docs/engineering/deployment.md)。

## 项目结构

```text
src/
├─ pages/          # Astro 文件路由与 endpoint（含 .md、sitemap、purge）
├─ layouts/        # Layout.astro：SEO、主题、ClientRouter
├─ components/
│  ├─ app/         # 岛屿壳层：DatasetPage / GroupPage
│  ├─ pages/       # 页面视图（沿用迁移前的 dashboard 视图）
│  ├─ dashboard/   # 页面级组件
│  ├─ charts/      # D3 图表
│  ├─ shared/      # SEO、主题、进度条、错误态
│  └─ ui/          # coss ui 生成物，不手写业务逻辑
├─ db/             # schema、连接、查询层
├─ hooks/          # 水合、快捷键、逐字稿
├─ lib/            # 纯函数：聚合、格式化、路由兼容、SEO、Markdown
├─ stores/         # Zustand：主题
├─ types/          # datapack / dataset / db DTO
└─ middleware.ts / worker.ts
scripts/           # 抓取、ingest、对账、发布、封面、逐字稿
content/transcripts/  # 手写逐字稿
docs/              # 架构、数据模型、开发、部署
data-sources.json  # 成员注册表
```

## 文档

- [docs/README.md](docs/README.md) 文档唯一入口
- [docs/requirements/](docs/requirements/) 需求规格与用户故事
- [docs/planning/architecture.md](docs/planning/architecture.md) 分层、数据流、路由
- [docs/planning/astro-ssr-migration.md](docs/planning/astro-ssr-migration.md) Astro + Workers + PostgreSQL 迁移方案
- [docs/planning/backlog.md](docs/planning/backlog.md) 任务清单
- [docs/data/data-model.md](docs/data/data-model.md) manifest / datapack 字段与口径
- [docs/data/adding-data.md](docs/data/adding-data.md) 加场次、成员、数据集
- [docs/engineering/development.md](docs/engineering/development.md) 本地开发与代码规范
- [docs/engineering/deployment.md](docs/engineering/deployment.md) 构建与部署
- [docs/engineering/performance.md](docs/engineering/performance.md) 性能记录
- [docs/engineering/troubleshooting.md](docs/engineering/troubleshooting.md) 常见问题
- [docs/ui-design/README.md](docs/ui-design/README.md) 设计系统
- [docs/development-log/](docs/development-log/) 开发日志
- [AGENTS.md](AGENTS.md) AI 协作指南

## 说明

- 同接、视聴时间、播放、点赞来自 VSTATS；弹幕、SC、评论从 YouTube 公开数据抓取。时间一律按日本时间。
- 不同币种的 SC 分开累计，不做汇率换算。
- 非官方项目，与 夢限大みゅーたいぷ、所属事务所、Bushiroad、YouTube、VSTATS 均无隶属或合作关系。
- 会员限定场可能包含不宜公开传播的信息，部署前请自行确认范围。
- 原始内容版权归各自权利人所有，本仓库只做个人研究与分析用途，详见 [NOTICE.md](NOTICE.md)。

## 贡献

欢迎数据修正、可访问性改进、图表和文档，细节见 [CONTRIBUTING.md](CONTRIBUTING.md)。提交前确保 `bun run check` 和 `bun run build` 通过。参与讨论请遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)，安全问题按 [SECURITY.md](SECURITY.md) 私下报告。

## License

代码以 [MIT](LICENSE) 发布。直播数据与内容不在 MIT 范围内，见 [NOTICE.md](NOTICE.md)。
