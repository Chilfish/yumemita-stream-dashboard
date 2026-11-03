# Changelog

## 未发布

### 文档

- 按模板 `starter-astro-react` 的文档规范重组 `docs/`：拆成 `requirements/`、`planning/`、`engineering/`、`data/`、`ui-design/`、`postmortem/`、`reviews/`、`development-log/`、`archive/`；根目录只保留 `README.md` 与 `writing-style.md`，`docs/README.md` 作为唯一入口。
- 新增 [docs/planning/astro-ssr-migration.md](docs/planning/astro-ssr-migration.md)：Astro 7 + Cloudflare Workers + PostgreSQL + R2 的完整迁移方案，含数据模型、ingest、`.md` Agent 路由、缓存失效与发布流程。
- 新增需求规格、用户故事、工程规范、设计系统、postmortem / reviews 模板、开发日志与归档索引；移动 `architecture` / `data-model` / `deployment` 等旧文档并更新全仓链接。
- 新增根目录 `AGENTS.md` 与 `.github/PULL_REQUEST_TEMPLATE.md`。

### 数据

- **频道专属表情入库**：归一化把本场频道表情写成 `danmaku/emoji_<videoId>.json`，pack 新增 `chat.emojis` 与 `paid.superchats[].emojis`。新增 `fetch:emoji`：合并 `data/emoji-<datasetId>.html`（频道）、`data/emoji-youtube.html`（YouTube 全局）与 pack 里的图片地址，镜像到 `data/<datasetId>/emoji/`，并写 `index.json`（id → 名称）。表情是静态资源，手动跑一次 `fetch:emoji` + `publish:data` 即可，不进每日流水线；频道表情发布到 `<base>/emojis/<datasetId>/`，`UCksz…` 全局表情按 scope 单独放 `<base>/emojis/youtube/`，不重复复制。旧 pack 不需要重抓弹幕。
- **SC 币种不再丢**：金额解析改为「第一个数字之前的前缀即币种」，不再维护白名单。此前 `MX$` / `SGD` / `MYR` / `THB` / `IDR` / `ARS` / `R$` / `₱` / `₪` / `CA$` / `₫` 这些格式只会计入 SC 条数、不进 `paid.superchats` 与 `scTotalsByCurrency`（614 份 jsonl 里有 27 笔）。页面补上对应币种名称。
- 归一化 skipped 按 renderer 类型计数并打印，未收录的事件类型（Q&A、mode change、auto-mod…）不再吞成一个总数。
- **会员里程碑文案落进 jsonl**：`headerSubtext`（如 `Welcome to …`）现在随归一化写入 `msg.header`，不再依赖原始 `.live_chat.json`；`fetch-danmaku` 默认删原始档后重建也不会丢，旧 jsonl 仍回退原始档。
- **赠送会员入账**：`live_chat` 归一化补上 `liveChatSponsorshipsGiftPurchaseAnnouncementRenderer` / `GiftRedemptionAnnouncementRenderer`，输出 `kind: 'gift'`（带 `giftCount`）与 `kind: 'giftRedemption'`；pack 新增 `chat.byKind.gift` 与 `paid.gifts[]`（赠送方 / 个数 / 原文），领取赠礼并入 `membership` 与 `paid.memberships`（`header` 为 `received a gift membership by …`）。之前这两类事件在归一化阶段就被丢弃，`Sent 50 … gift memberships` 整场都不进库。旧场次需重抓弹幕才会补齐。
- **datapack schema v2**：新增全量 `chat.authors` / `chat.wordCounts` 与 `topAuthors[].authorId`，跨场词频/发言者由“Top 榜单相加”改为发布时精确重扫；v1 pack 逐场回退，`insights.totals.aggregation` 标明 `full` / `partial` / `top-lists` 与覆盖率。
- 三种模式并存：全量时显示“精确聚合”，部分重建时显示“精确覆盖 X/Y 场”，全 v1 时提示“榜单相加”。
- `publish:data` 由 v2 pack 额外派生 `<dataset>/authors.json`（作者 → 场次索引），为观众重叠预留；任一场仍是 v1 时跳过并在日志里提示。
- 归档侧弹幕归一化补 `authorId`（`authorExternalChannelId`），显示名改名/重名不再影响作者合并。
- 新增 `scripts/missing-danmaku.ts` / `scripts/fetch-danmaku.ts` / `scripts/enrich-chat.ts`：只补缺失场次的 `live_chat` 回放并升级为 v2，不重抓 meta / 评论 / VSTATS；支持 `--shard i/n` 多实例并行、断点续跑与无回放标记。
- 新增 `verify:data`：校验 v2 不变量（authors 求和 / uniqueAuthors / insights 重算 / coverage / authors.json），`--remote` 直接对比对象存储内容，能发现“只传了一部分 dataset”的发布问题。
- 新增 `scripts/backfill-author-id.ts` + `scripts/enrich-chat.ts --force`：用原始 `live_chat.json` 给 1242 份旧 jsonl 补 `authorId`，修复同一发言人被拆成 `id:` / `name:` 两行；修复后 4 个全量 dataset 的同名拆分从 410/639/635/1258 降到 0。
- 数据集扩展为 5 位成员：宮永ののか、仲町あられ、峰月律、藤都子、千石ユノ，合计 **1891 场**（2023-11-18 – 2026-10-29）：nonoka 287、arale 505、ritsu 339、miyako 321、yuno 439。
- 五位成员都按频道顺序补齐历史场次（同名去重、保留正片）；当前 manifest 没有待抓场次。
- 新增 [docs/data/data-progress.md](docs/data/data-progress.md)：五位成员的抓取进度、nonoka 批次记录、跳过判定、下一批候选。
- 词频剔除英文虚词与寒暄词（`said` / `hi` / `the` …）：分词与页面聚合共用 `src/lib/stopwords.ts` 的停用词表；旧 pack 里残留的这类词在单场页与跨场聚合展示时也会过滤。

### 界面

- 单场「弹幕与词」的表情榜改用图片渲染（频道表情按 id 取对象存储，Unicode 表情仍显示字符）；付费页的 SC 留言也会显示留言里的表情。
- **封面层**：`fetch:thumbs` 把 YouTube 封面镜像到本地并随 `publish:data` 上传；首页最近一场、最近场次、单场页与相册统一 16:9 渲染，缺图走成员色兜底。
- **相册页**：`/:datasetId/gallery`，按 JST 自然月分组的封面墙，懒加载、`?order=` 可分享；侧栏与移动端标签栏新增入口。
- **组首页**：`/` 跨成员首屏：近 7 天 / 本月脉冲、最近一场焦点、跨成员最近更新与按成员进入；单个成员 manifest 加载失败时跳过并提示，不阻塞其余成员。
- **全组相册**：`/gallery` 把相册扩展为跨成员时间线，`?member=` / `?type=` / `?order=` 写进 URL，成员与内容类型筛选带实时计数。
- **逐字稿**：`content/transcripts/<datasetId>/<videoId>.md` 手写 Markdown，`publish:transcripts` 上传后运行时渲染；单场页按需出现「逐字稿」分段，带目录、时间戳跳 YouTube，索引页 `/:datasetId/transcripts`。
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

- **SEO**：路由从 hash 改为真实路径（`createBrowserRouter` + `basename`），旧 `#/...` 链接由 `index.html` 内联脚本改写；`vercel.json` 增加 SPA rewrite。新增 `src/lib/seo.ts`（`buildSeo` / `buildSitemap` 纯函数）与 `useSeo`，统一每页 title / description / canonical / OG / JSON-LD；`scripts/generate-seo.ts` 在构建时为组首页、全组相册、每位成员的 6 个栏目页与 1891 个单场页生成静态 head 和 `<noscript>` 摘要，并输出 `sitemap.xml` / `robots.txt`；`verify:seo` 进 CI。对比页与未知路径 noindex，canonical 丢弃 query。
- **代理出口改为日本优先**：`mihomo-config.ts` 不再写死只留香港节点，按 `MIHOMO_REGION`（默认 `日本,香港`）挑选地区，工作流显式设 `日本,香港`。出口地区要跟 `YT_COOKIES` 的签发地区一致，日本 cookie 配香港出口正是这次 100% 撞 bot 检查的原因。
- **`export-yt-cookies` 只导 YouTube**：新增 `--domains`（默认 `youtube.com,google.com`），浏览器 profile 里 bilibili / pixiv / tiktok 等站的会话不再被塞进 CI secret；导出体积从 28 KB 降到 8 KB。导出前会删掉旧文件，避免上次裁剪坏了导致 yt-dlp 拒绝读写。
- **定时任务抗 bot 检查**：`data.yml` 增加 `bgutil-ytdlp-pot-provider` 插件 + 本地 `4416` 令牌容器，cookie 与 PO token 同时具备；新增 `Check YouTube access` 预检（出口 IP/地区、PO token 提供者、cookie 是否失效，读不到直接在报错处停下）。`fetch-streams` 不再吞掉元信息失败——bot 检查计入失败并触发 `Data update failed` issue，会员限定降级为跳过；同时去掉 `--no-warnings`，失败时能看到 cookie / PO token 的真实提示。

- **封面管线**：新增 `fetch:thumbs`（`maxresdefault` → `mqdefault`、并发、重试、单张失败跳过），`publish:data` 按 thumbs → pack → manifest/insights → index 上传，沿用增量发布进度。
- **封面变体**：`fetch:thumbs` 用 `Bun.Image` 额外编码 480 / 960 / 1280w 的 WebP（480w 约 24 KB，原图约 144 KB），已有原图时自动补齐；`StreamCover` 用 `srcset` + `sizes` 由浏览器选档，变体缺失时退回原图。发布脚本把变体与 `Content-Type: image/webp` 一起上传，缺变体只警告。对象存储侧的长缓存规则见 [docs/engineering/deployment.md](docs/engineering/deployment.md) 的「封面与变体」。
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

### 文档

- 重写 README：补线上地址、成员场次表，功能按页面重组，截图换成线上版本。
- 新增 [docs/writing-style.md](docs/writing-style.md)：语气、用词、术语表与提交前检查表；`docs/README.md`、`CONTRIBUTING.md` 同步引用。
- 按规范清理文档与界面文案里的口号式对偶、英文标语和设计黑话。
- 文档里的路由写法统一为真实路径，删掉已失效的设计截图引用；`docs/README.md` 增加「文档即为事实」约定。
- 补 MIT [LICENSE](LICENSE)、[SECURITY.md](SECURITY.md)、[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)；[NOTICE.md](NOTICE.md) 更新代码许可说明，`package.json` 增加 `license` 字段。

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
