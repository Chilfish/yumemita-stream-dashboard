# Changelog

## 未发布

### 数据

- **datapack schema v2**：新增全量 `chat.authors` / `chat.wordCounts` 与 `topAuthors[].authorId`，跨场词频/发言者由“Top 榜单相加”改为发布时精确重扫；v1 pack 逐场回退，`insights.totals.aggregation` 标明 `full` / `partial` / `top-lists` 与覆盖率。
- 三种模式并存：全量时显示“精确聚合”，部分重建时显示“精确覆盖 X/Y 场”，全 v1 时提示“榜单相加”。
- `publish:data` 由 v2 pack 额外派生 `<dataset>/authors.json`（作者 → 场次索引），为观众重叠预留；任一场仍是 v1 时跳过并在日志里提示。
- 归档侧弹幕归一化补 `authorId`（`authorExternalChannelId`），显示名改名/重名不再影响作者合并。
- 新增 `scripts/missing-danmaku.ts` / `scripts/fetch-danmaku.ts` / `scripts/enrich-chat.ts`：只补缺失场次的 `live_chat` 回放并升级为 v2，不重抓 meta / 评论 / VSTATS；支持 `--shard i/n` 多实例并行、断点续跑与无回放标记。
- 新增 `verify:data`：校验 v2 不变量（authors 求和 / uniqueAuthors / insights 重算 / coverage / authors.json），`--remote` 直接对比对象存储内容，能发现“只传了一部分 dataset”的发布问题。
- 新增 `scripts/backfill-author-id.ts` + `scripts/enrich-chat.ts --force`：用原始 `live_chat.json` 给 1242 份旧 jsonl 补 `authorId`，修复同一发言人被拆成 `id:` / `name:` 两行；修复后 4 个全量 dataset 的同名拆分从 410/639/635/1258 降到 0。
- 数据集扩展为 5 位成员：宮永ののか、仲町あられ、峰月律、藤都子、千石ユノ，合计 **1891 场**（2023-11-18 – 2026-10-29）：nonoka 287、arale 505、ritsu 339、miyako 321、yuno 439。
- 五位成员都按频道顺序补齐历史场次（同名去重、保留正片）；当前 manifest 没有待抓场次。
- 新增 [docs/data-progress.md](docs/data-progress.md)：五位成员的抓取进度、nonoka 批次记录、跳过判定、下一批候选。

### 界面

- **封面层**：`fetch:thumbs` 把 YouTube 封面镜像到本地并随 `publish:data` 上传；首页最近一场、最近场次、单场页与相册统一 16:9 渲染，缺图走成员色兜底。
- **相册页**：`#/:datasetId/gallery`，按 JST 自然月分组的封面墙，懒加载、`?order=` 可分享；侧栏与移动端标签栏新增入口。
- **组首页**：`#/` 跨成员首屏——近 7 天 / 本月脉冲、最近一场焦点、跨成员最近更新与按成员进入；单个成员 manifest 加载失败时跳过并提示，不阻塞其余成员。
- **全组相册**：`#/gallery` 把相册扩展为跨成员时间线，`?member=` / `?type=` / `?order=` 写进 URL，成员与内容类型筛选带实时计数。
- **逐字稿**：`content/transcripts/<datasetId>/<videoId>.md` 手写 Markdown，`publish:transcripts` 上传后运行时渲染；单场页按需出现「逐字稿」分段，带目录、时间戳跳 YouTube，索引页 `#/:datasetId/transcripts`。
- 单场页页头改为「标题 + 右侧 16:9 封面」网格；移动端分段控件改为容器内横向滚动，避免页面横向溢出。
- 成员色拆成两个 token：`--member-color` 保留 `data-sources.json` 里的品牌原色（图表、色点、色条），
  `--member-ink` 用对比度达标的加深色（小号文字、焦点环）。浅色主题下 `#ffcb5b` 不再被压成棕色。
- 首页重排为四层：页面头 → 规模指标条 → 最近一场 / 本月 / 全期记录 → 最近场次 → 更新日历。
  规模指标从页头的一组小字提为 24px 数字条；最近一场只保留 3 个主指标，其余降为一行次级读数。
- 内容构成、全期高频词/发言者、典型节奏曲线移到趋势页；首页不再与趋势页重复堆叠分析块。
- 趋势页两张表升级：月度明细与内容类型对比可按列排序（表头带 `aria-sort`），月度明细新增「当前指标环比」列与全期合计行；
  内容类型对比把占比画成行内色条、加粗各列最高值；两表窄屏在面板内横向滚动并吸附首列，表内容与面板标题对齐。
- 修复横向溢出：`SidebarInset` 是 `w-full` 的 flex item，自动最小宽度把它撑到内容固有宽度；
  图表 SVG 的测量宽度也会回灌父级 min-content。现在主列加 `min-w-0`，图表容器用
  `contain: inline-size` 隔离。
- 更新日历渲染后自动滚到最近月份，首屏先看到近期活跃度。
- 新增 `--text-stat`（24/30，600）与 `--text-stat-sm`（18/22）字阶，用于规模指标、最近一场主指标与单场指标网格。
- **字体统一为自托管 Noto Sans + Noto Sans SC**：中 / 英 / 日同族，数值继续用同族 `tabular-nums`；
  不再依赖系统栈（Windows 上 Segoe UI + 微软雅黑 + Yu Gothic 混排的字重与基线跳动消失）。
- **字阶改为手机优先**：字阶令牌搬到非 `inline` 的 `@theme`，由 `<48rem` 的 `:root` 覆盖，
  `text-body` / `text-footnote` / `text-caption` 在手机上分别提升到 15 / 13 / 12px。
- 图表响应式：数据点密集的图（月度趋势、逐分钟、时间轴、场次柱状）在窄屏按数据点给保底绘图宽度并横向滚动，
  右缘淡出提示可滑动，不再把 36 个月压进 360px；高度不压缩，绘图区留白按 0.78 收紧，刻度按容器宽度取点。
  图表刻度统一用 `caption` 字阶，不再写 9/10px 字面量。
- 场次与「最近场次」在窄屏改为两行式列表（日期/类型/时长 → 标题 → 平均/峰值/弹幕/SC），不再横向滚动看半截标题；
  工具栏补手机端「排序」菜单（类型 + 升降序），状态照常写回 URL。
- 移动端交互：底部标签栏按 HIG 重做（图标 22px、标签 11px、仅用着色标记选中），面板头与图表头在窄屏改为纵向堆叠。
- 清理写死的 px：内容最大宽、表格最小宽、滚动区高度、对比页侧栏、单场指标列宽改为 rem 或视口单位。
- **动效**：路由切换只给内容区淡入、单场子视图互换、折线自绘与柱子生长、按钮按压反馈、封面解码后淡入、顶栏滚动阴影；主题切换用 View Transitions 交叉淡入。`prefers-reduced-motion` 下位移与缩放全部降级。
- **说明页注脚**：补充项目地址、作者 Bilibili、问题反馈入口，以及非官方项目 / 数据来源 / 版权 / 技术栈声明。

### 工程

- **封面管线**：新增 `fetch:thumbs`（`maxresdefault` → `mqdefault`、并发、重试、单张失败跳过），`publish:data` 按 thumbs → pack → manifest/insights → index 上传，沿用增量发布进度。
- **封面变体**：`fetch:thumbs` 用 `Bun.Image` 额外编码 480 / 960 / 1280w 的 WebP（480w 约 24 KB，原图约 144 KB），已有原图时自动补齐；`StreamCover` 用 `srcset` + `sizes` 由浏览器选档，变体缺失时退回原图。发布脚本把变体与 `Content-Type: image/webp` 一起上传，缺变体只警告。对象存储侧的长缓存规则见 [docs/deployment.md](docs/deployment.md) 的「封面与变体」。
- **逐字稿管线**：新增 `transcript:new` / `transcript:import` / `publish:transcripts`；正文先传、索引最后写，单篇失败不阻塞；离线回退到构建期 Markdown 快照。
- **数据发布即生效**：`publish:data` 现在同时生成并最后上传根 `index.json`；页面启动时直接从对象存储读
  `index.json` / `manifest.json` / `insights.json` / datapack，发布后刷新即可，不需要重新构建前端。
  manifest / insights 用索引的 `generatedAt` 做版本参数，绕开 CDN 旧缓存。
- `sync:data` 改为只生成 `public/data/` 兜底快照（远端 index 可用时原样复用）；`validate:data --remote`
  同时校验根 `index.json`。
- **数据源迁到对象存储**：manifest / insights / datapack 全部放 R2，git 里只保留 `data-sources.json`。
- 新增 `bun run publish:data`：以本地 pack 为唯一真源，派生 manifest + insights 后先传 pack、再传索引，
  避免索引指向不存在的文件；`--no-upload` 可只生成本地文件。
- `sync:data` 支持从 `VITE_DATAPACK_BASE` 拉 manifest/insights，带 `node_modules/.cache` 缓存兜底；
  没配地址时回退本地 `data/` 暂存区。
- `validate:data --remote` 逐条 HEAD 校验对象存储上的 index / manifest / insights / datapack。
- 新增 `vercel.json`（缓存头）与 `.env.example`。
- `publish:data` 支持 `R2_PREFIX`：对象写进桶内指定前缀，`VITE_DATAPACK_BASE` 指向同一前缀。
- 上传改用 Bun 原生 `S3Client`，移除 `aws4fetch` 依赖。
- 依赖升级：`lucide-react` 1.64、`@types/node` 26.6.6、Bun 1.4.4；GitHub Actions 的 checkout / setup-node / upload-artifact 升到 v7。
- 移除 GitHub Pages 部署 workflow（`.github/workflows/deploy.yml`），部署迁到 Vercel。
- 修复：`data/.gitignore` 的全忽略规则导致 232 份 datapack 从未被提交，远端构建缺数据。

- `scripts/stream-datapack.ts` 接入 `data-sources.json`：按 `channel_id` 匹配 dataset，直接写
  `data/<id>/<videoId>.datapack.json` 并 upsert manifest；支持一次传入多个会话目录。
- manifest 摘要抽到 `scripts/lib/dataset-manifest.ts`，与 `add-datapack.mjs` 共用。

## 0.1.0 — 2026-10-28

首个可用版本。

### 数据

- 内置 `nonoka`（宮永ののか）最近 30 场直播的归一化 datapack（2026-08-10 – 2026-10-22）。
- `data/` 作为源数据随仓库提交；`public/data/` 由 `sync:data` 生成。
- 提供 `add:datapack` / `validate:data` 脚本。

### 页面

- 总览：KPI、每场同接、SC 币种构成、弹幕浓度散点、全月高频词/发言者、最近场次。
- 单场：逐分钟弹幕 + SC、每 10 分钟分布、SC 全表、Top 词/发言者、徽章、评论区。
- 对比：最多 4 场，逐分钟叠加 + 指标对比表。
- 数据表：搜索、排序、仅有 VSTATS 筛选、CSV 导出。
- 说明：口径、限制、更新方式。
- 深浅色主题、响应式布局、多 dataset 选择器。

### 工程

- React 19 + Vite + TypeScript + Tailwind CSS v4 + coss ui + D3。
- Vitest 单元测试（格式化、聚合）。
- oxlint、`bun run check` / `bun run ci`。
- GitHub Actions CI。
- 文档：架构、数据模型、加数据、开发、部署、排错、路线图。
