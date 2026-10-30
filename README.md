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
- SEO：真实路径、每页 title / description / canonical / OG，构建期生成单场页静态 head、`sitemap.xml` 与 `robots.txt`；旧 `#/...` 链接自动跳转

## 技术栈

- **前端**：React 19、Vite、TypeScript
- **路由**：React Router v8，path 路由（兼容子路径），路由级懒加载
- **UI**：Tailwind CSS v4、coss ui（Base UI + shadcn 风格组件）
- **图表**：D3，只算比例尺与路径，DOM 交给 React
- **测试**：Vitest、oxlint
- **数据**：Cloudflare R2（S3 兼容），与前端分开发布

## 快速开始

环境要求：Bun 1.4 以上（仓库的 `packageManager` 为 `bun@1.4.4`），Node.js 22.22 以上。

```bash
git clone https://github.com/Chilfish/yumemita-stream-dashboard.git
cd yumemita-stream-dashboard
bun install
bun run dev
```

打开 <http://localhost:5173>。

### 配置

把 `.env.example` 复制成 `.env`。

```env
# 数据根地址，构建时注入；留空则只读本地 data/ 的兜底快照
VITE_DATAPACK_BASE=https://s3.example.com/stream-dashboard

# 站点根地址，canonical / OG / sitemap 用；CI 里必填
VITE_SITE_URL=https://ymmt.example.com

# 以下只有发布数据时需要
R2_ACCOUNT_ID=""
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_BUCKET=""
R2_PREFIX="stream-dashboard"
```

页面启动后直接向 `VITE_DATAPACK_BASE` 请求索引和单场数据，所以发布数据不用重新构建前端。远端不可达或还没发布过索引时，会回退到 `public/data/` 里的构建期快照。

## 数据

`data/<成员>/*.datapack.json` 是本地暂存区，不入库。`bun run publish:data` 从这些 pack 派生出 `index.json`、`manifest.json`、`insights.json`，连同封面、逐字稿一起上传对象存储。git 里只有代码、`data-sources.json` 和手写的逐字稿。

```text
data/<id>/*.datapack.json            本地暂存
        │  bun run publish:data
        ▼
对象存储  index.json
          <id>/manifest.json
          <id>/insights.json
          <id>/<videoId>.datapack.json
          <id>/thumbs/<videoId>.webp
          <id>/transcripts/<videoId>.json
        │  页面启动时读取
        ▼
组首页 / 成员页 / 场次 / 单场 / 趋势 / 相册 / 对比
```

索引和 pack 一起上传，索引最后写，保证不会指向还不存在的文件。封面同样是本地镜像后再传，不热链 YouTube。

## 常用命令

```bash
bun run dev                  # 同步数据 + 开发服务器
bun run build                # 同步数据 + 类型检查 + 生产构建
bun run check                # typecheck + test + lint
bun run ci                   # CI 同款：sync + validate + check + build + verify:seo
bun run verify:seo           # 校验静态 head、canonical、sitemap 与 robots

bun run publish:data         # 重建索引并上传对象存储
bun run publish:transcripts  # 增量上传逐字稿
bun run add:datapack         # 加一份 datapack，自动更新 manifest
bun run fetch:thumbs         # 镜像封面到本地
bun run validate:data        # 校验 index → manifest → insights
```

补缺失弹幕、回填 `authorId` 这类一次性修复脚本没有注册到 `package.json`，用法见 [scripts/README.md](scripts/README.md)。

## 加数据

加一场直播：

```bash
bun run add:datapack nonoka /path/to/<videoId>.datapack.json
bun run fetch:thumbs --dataset nonoka
bun run publish:data
```

加一位成员：新建 `data/<id>/` 放入 pack，在 `data-sources.json` 里加一条 dataset，再 `bun run publish:data --dataset <id>`。成员入口和页面都是按配置生成的，不用改组件。

逐字稿：`bun run transcript:new <videoId> --dataset nonoka` 建模板，写完执行 `bun run publish:transcripts`。

字段和步骤的细节见 [docs/adding-data.md](docs/adding-data.md)。

## 部署

构建产物在 `dist/`，交给任意静态托管即可，`vercel.json` 里已经配好 SPA 重写和缓存头。

```bash
VITE_DATAPACK_BASE=https://s3.example.com/stream-dashboard \
VITE_SITE_URL=https://ymmt.example.com bun run build
```

构建会为每个路由生成带 head 的静态 HTML，并输出 `sitemap.xml` / `robots.txt`。数据更新只需要 `bun run publish:data`，逐字稿更新 `bun run publish:transcripts`，都不用重新构建；新场次的静态分享卡片要等下次构建，客户端 meta 立即生效。部署在子路径时设 `VITE_BASE`。详见 [docs/deployment.md](docs/deployment.md)。

## 项目结构

```text
src/
├─ pages/          # 路由页面：数据 ↔ 视图 ↔ 导航
├─ components/
│  ├─ dashboard/   # 页面级组件
│  ├─ charts/      # D3 图表
│  └─ ui/          # coss ui 生成物，不手写业务逻辑
├─ hooks/          # 数据加载、主题、尺寸测量
├─ lib/            # 纯函数：聚合、格式化、路由、SEO
├─ types/          # datapack / dataset 的 TS 镜像
└─ router.tsx
scripts/           # 同步、发布、校验、封面、逐字稿
content/transcripts/  # 手写逐字稿
docs/              # 架构、数据模型、开发、部署
data-sources.json  # 成员注册表
```

## 文档

- [docs/README.md](docs/README.md) 文档索引
- [docs/architecture.md](docs/architecture.md) 分层、数据流、路由
- [docs/performance.md](docs/performance.md) 首屏数据流、缓存、图片与实测数字
- [docs/data-model.md](docs/data-model.md) manifest / datapack 字段与口径
- [docs/adding-data.md](docs/adding-data.md) 加场次、成员、数据集
- [docs/development.md](docs/development.md) 本地开发、代码规范、图表写法
- [docs/deployment.md](docs/deployment.md) 构建与静态托管
- [docs/troubleshooting.md](docs/troubleshooting.md) 常见问题
- [docs/roadmap.md](docs/roadmap.md) 后续计划

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
