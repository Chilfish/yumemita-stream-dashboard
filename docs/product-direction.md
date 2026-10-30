# 产品方向：封面、相册与逐字稿

> 状态：P1 封面与相册、P2 逐字稿、P3 组首页与全组相册已实施（2026-10-30）；跨成员对比待做。
> 关联：[roadmap.md](roadmap.md)、[architecture.md](architecture.md)、[data-model.md](data-model.md)。

## 1. 定位

一句话：**把五人团的直播读成一份可回看的观赛笔记。**

三个层次各司其职：

| 层次 | 载体 | 回答的问题 |
| --- | --- | --- |
| 读数 | 指标、趋势、对比、词频 | 这场 / 这个人表现如何？ |
| 记忆 | 封面、逐字稿、峰值与留言 | 这场发生了什么？ |
| 存在感 | 相册、组首页、视觉身份 | 这是谁的站？为什么回来？ |

明确不做：实时聚合（HoloDex 的强项）、全站排行榜（HoloStats / hololyzer 的强项）、用户系统与评论。五人团的差异在**深度与关系**，不在覆盖广度。

## 2. 现状复核（2026-10-29）

桌面 1440、手机 390、单场页截图复核结论：

- 首屏是「页头事实串 → 4 个大数字 → 最近一场」，信息准确但全部由文字和数字构成，**没有图像锚点**。
- 单场页只有曲线、指标、表格；`datapack.video.thumbnail`、`description`、`chapters`、SC 留言、评论都已存在，但没有进入页面叙事。
- 成员只存在于侧栏，`/` 固定落到第一个成员；对比只能在单个成员内选场次。
- 整站唯一的视觉身份是成员色和 20px 头像，陌生人看两秒只会说「一个数据看板」。

结论：**不是数据不够，是缺少图像层与叙事层。** 封面图是成本最低、收益最高的一步。

## 3. 目标信息架构

在现有成员维度上补「图像 + 文本 + 全组」三条线，不推翻现有页面。

| 页面 | 路由 | 作用 | 状态 |
| --- | --- | --- | --- |
| 组首页 | `#/` | 全组脉搏：最近谁播了 / 近 7 天 / 本月 / 最近更新 | 已上线 |
| 成员首页 | `#/:datasetId` | 单人近况与规模 | 已有 |
| 场次 | `#/:datasetId/streams` | 表格浏览与筛选 | 已有 |
| 单场 | `#/:datasetId/stream/:videoId?view=` | 读数 + 封面 + 逐字稿入口 | 已有 |
| 相册 | `#/:datasetId/gallery`、`#/gallery` | 封面墙，按时间回看 | 成员相册与全组相册已上线 |
| 逐字稿索引 | `#/:datasetId/transcripts` | 有逐字稿的场次列表 | 已上线 |
| 趋势 / 对比 / 说明 | 现有路由 | 不变 | 已有 |

新增页面一律写 URL 状态，保持可分享、可前进后退的既有约束。

## 4. 封面图管线（P1）

### 4.1 来源与本地暂存

- 真源：`datapack.video.thumbnail`（YouTube 抓取时写入的封面地址）。
- 只在本地暂存镜像，运行时**不直连 YouTube**：避免热链、CORS、CDN 策略与慢请求影响首屏。
- 本地路径：`data/<datasetId>/thumbs/<videoId>.jpg`（gitignore，和 pack 同级）。
- 抓取脚本：`scripts/fetch-thumbnails.ts`。

```bash
bun run fetch:thumbs --dataset nonoka          # 只补缺失
bun run fetch:thumbs --dataset nonoka --force  # 重抓全部
bun run fetch:thumbs --dataset nonoka --limit 20 --dry-run
```

行为约定（与 `fetch-streams` 一致）：

- 已存在的文件默认跳过；`--limit` 控制单次批量；`--dry-run` 只列候选。
- 单张失败记日志并继续，不阻塞其余场次；结束打印 `成功 / 跳过 / 失败` 计数。
- 超时、UA、有限重试；并发默认 4，避免被 YouTube 限流。
- 选图顺序：`maxresdefault.jpg`（1280×720，真 16:9）→ `mqdefault.jpg`（320×180，真 16:9）。不用 `hqdefault` / `sddefault`，它们是 4:3 letterbox，进页面会出现黑边。
- 原图之外再存 480 / 960 / 1280w 三档 WebP（quality 78），用 Bun 自带的 `Bun.Image` 编码，不引入额外依赖；
  已有原图时自动补齐变体，不重新下载。宽度与命名约定见 `src/lib/thumb-variants.ts`。

### 4.2 对象存储布局

```text
<base>/<dataset>/thumbs/<videoId>.jpg
<base>/<dataset>/thumbs/<videoId>.<width>.webp      # width ∈ 480 / 960 / 1280
```

- **key 由「dataset + videoId（+ 变体宽度）」确定**，不依赖 manifest；离线也能拼 URL。
- manifest 的 `streams[]` 增加可选字段 `thumbnail: string | null`，用于「有没有封面」与相册索引；旧 pack 缺失时为 `null`。
- 上传顺序：`thumbs → pack → manifest / insights → index`。索引仍然最后写，任何中途失败都不会让索引指向不存在的文件。
- 增量发布复用 `data/.publish-state.json`：内容摘要一致且远端大小对得上就跳过。
- 缓存：封面按 `public, max-age=31536000, immutable` 处理。`ObjectStore.putObject` 负责二进制上传与 `Content-Type`；Bun 的 S3 写入不支持自定义 `Cache-Control`，缓存规则配在桶 / CDN 侧（见 [deployment.md](deployment.md) 的「封面与变体」）。
- 体积预算：1600 场 ×（144 KB 原图 + 约 158 KB 变体）≈ 480 MB，只存在对象存储；列表页按 `srcset` 只下 480w（约 24 KB）。

### 4.3 渲染规范

| 位置 | 尺寸 | 说明 |
| --- | --- | --- |
| 场次表 / 最近场次行 | 96×54（桌面）、64×36（手机） | 可选，先加在最近场次与单场页 |
| 单场页头 | 16:9，桌面约 1/3 栏宽，手机全宽 | 第一屏建立画面锚点 |
| 相册 | 2 列（390）→ 3 列（md）→ 4–5 列（xl） | 统一 16:9 网格 |

- 统一 `aspect-video` + `object-cover` + `rounded-panel`，发丝线描边，不加厚阴影。
- 加载：`loading="lazy"`、`decoding="async"`；`srcset` 三档 + `sizes` 由浏览器选档，只有首屏主图设 `fetchpriority="high"`。
- 兜底：成员色渐变 + 标题首字 + 播放图标，**不允许出现破图**；图片 `onError` 时切到兜底。
- `alt` 用场次标题；悬停只做轻微亮度变化，不加缩放与位移。
- 点击直接进入单场页，不做 lightbox（v1 不需要多一层交互）。

### 4.4 版权与可维护性

- 封面是创作者内容，本站只做个人向归档展示，每处都保留 YouTube 原链接。
- 不做超分、不裁切重构图；保留原图比例与信息。
- 提供移除路径：删除本地文件并在 `data-sources.json` 的 dataset 上记录排除项，重跑发布即下架。
- 关于页补充来源与移除说明，避免「这是谁的图」的疑问。

## 5. 相册页（P1）

**目的**：给「回看」一个非表格的入口。趋势页回答「变化」，相册回答「那天的画面」。

### 5.1 结构

- 成员相册 `#/:datasetId/gallery`；全组相册 `#/gallery`（同一套组件，多一层成员筛选）。
- 按 **JST 自然月**分组，月份标题吸顶；右侧（桌面）或顶部（手机）放年份跳转。
- 全组视图支持 `?member=nonoka&type=歌枠` 过滤，状态写进 URL。
- 排序默认最新在前；可切最早在前。

### 5.2 卡片

封面 + 日期（`10/29`） + 标题（2 行截断） + 一个读数（默认峰值同接，可切弹幕）。悬停或聚焦时显示「打开单场」提示，但信息本身不依赖悬停。

### 5.3 性能与状态

- 每个月份 section 用 `content-visibility: auto`，图片懒加载，`aspect-ratio` 预留高度，避免 CLS。
- 300 场一次渲染可接受；超过 1000 场再按月分页，不提前做虚拟列表。
- 空状态：该月没有场次时跳过，不显示空月份；没有封面时用兜底图，不占位说明。
- 无障碍：用列表语义，每张图的 `alt` 是标题；键盘可逐项聚焦；焦点环沿用 `outline-member-ink`。
- 验收：390 / 320px 页面无横向滚动；首屏 30 张图内 LCP < 2.5s；破图 0。

## 6. 逐字稿（P2）

**原则**：作者手动维护 Markdown，站点只读渲染；不在本仓库做编辑器。

### 6.1 文件约定

源文件放在 `content/transcripts/<datasetId>/<videoId>.md`（入库，属于作者内容，不是抓取原始数据）。

```markdown
---
videoId: W0bKqP-Eyj4
date: 2026-10-13
title: 【ライブ振り返り】13thライブをふりかえる
members: [nonoka]
tags: [杂谈, 13th live]
summary: 一场把 13th live 从头聊到尾的复盘。
---

## 开场

[00:00:12] 大家好，今天想聊聊 13th live……
```

- `videoId` 必填且唯一，是关联场次的唯一键；文件名不参与匹配。
- 允许的 frontmatter 字段：`videoId`、`date`、`title`、`members`、`tags`、`summary`、`tweets`（见 §7）。
- 导入命令（v1 只做复制 + 校验，不改写正文）：

```bash
bun run transcript:import "D:/messages/archives/…/2026-10-13_ライブ振り返り.md" --dataset nonoka
```

- 论坛式富文本、图片粘贴上传、在线编辑都属于编辑器项目（§6.5），不进这里。

### 6.2 发布与读取

两种做法：

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| A. 构建时打包 Markdown | 简单，离线可用 | 每改一篇都要重新构建，违背「发布即生效」 |
| B. 发布到对象存储，运行时读取 | 与现有数据链路一致，改完即生效 | 需要多一个发布步骤 |

**采用 B，A 作为兜底快照**（与 index / manifest 的处理方式一致）：

```text
<base>/transcripts/index.json                     # 有逐字稿的场次列表
<base>/<dataset>/transcripts/<videoId>.json       # { frontmatter, markdown, updatedAt }
```

- `bun run publish:transcripts`：解析 frontmatter → 写索引 → 上传正文 JSON；单篇失败跳过并记录，索引最后写。
- `sync:data` 顺带拉一份 `transcripts/index.json` 到 `public/data/` 作为离线兜底。
- 页面远端优先，失败回退到构建快照。
- 正文保留 Markdown 原文，客户端渲染；不预渲染 HTML，避免 sanitizer 版本与缓存问题。

### 6.3 渲染

- 依赖：`react-markdown` + `remark-gfm`（主流、维护活跃、体积可控）。禁用原始 HTML，不引入重型编辑器与语法高亮全家桶。
- 版式：正文 65–75ch，手机 15–16px / 1.75，标题沿用现有字阶；表格在自身容器内横向滚动；引用块用发丝线与成员色左线。
- 时间戳：行首 `[12:34]` / `00:12:34` 自动转成 YouTube 深链（`&t=754s`），点击跳原视频对应位置。
- 目录：从 `h2` / `h3` 生成；桌面右侧吸顶，手机折叠在正文上方；每个标题可复制锚点。
- 图片：相对路径资源随发布上传到 `<base>/<dataset>/transcripts/assets/`，渲染时懒加载并带说明文字。
- 入口：
  - 单场页分段控件增加「逐字稿」，**只在该场有稿时出现**，避免空标签占位。
  - 逐字稿索引页列出标题、日期、标签、摘要，可按成员 / 标签筛选。
- 状态：无稿、加载骨架、加载失败（给出 YouTube 链接与重试）三态齐全。
- 不做站内全文搜索；需要检索时先由索引页筛选，后续再评估把标题/摘要并入 ⌘K。

### 6.4 阅读体验的验收

- 320px 下正文不横向溢出，代码块与表格自身滚动。
- 从任一条目进入后，TOC 锚点、时间戳跳转、返回列表都可用键盘完成。
- 一篇 5000 字的中文稿在 390px 下通读无字号跳变。

### 6.5 编辑器 / CMS（单独项目，不排期）

明确不在本仓库实现。待办清单留给独立项目：

- [ ] 本地优先的桌面或 Web 编辑器：打开 `content/transcripts/` 文件夹。
- [ ] 从 manifest 选择场次，自动带出 `videoId` / 日期 / 标题。
- [ ] frontmatter 表单 + Markdown 分栏预览。
- [ ] 图片粘贴即上传到对象存储，回填相对路径。
- [ ] 一键发布（调用 `publish:transcripts` 或直传 API）。
- [ ] 草稿、离线、冲突提示；版本交给 git，不自建版本库。

过渡方案：`bun run transcript:new <videoId>` 从模板生成文件，减少手写 frontmatter 的成本。

## 7. 推文联动（评估，不排期）

素材：[tweet.chilfish.top/llms.txt](https://tweet.chilfish.top/llms.txt) 提供只读 REST：用户时间线、关键词搜索、那年今日、媒体列表。

可选形态与判断：

| 形态 | 数据来源 | 判断 |
| --- | --- | --- |
| 单场「相关推文」 | `tweets` frontmatter 手动 pin | 推荐。可靠、可控，不用模糊搜索猜关联 |
| 组首页「那年今日」 | `last-years-today` API | 可做一张卡，但不进首屏主路径 |
| 相册「同期媒体」 | `/v3/tweets/medias` | 与封面墙主题冲突，暂不做 |

约束：

- 外部服务只作为增强：失败、超时、跨域异常都不能影响主页面；客户端懒加载 + 超时 + 缓存。
- 不做写入，不复制推文正文入库；展示时保留原推链接。
- 先在 frontmatter 里手动维护 `tweets: [id, id]`，验证阅读价值后再考虑自动匹配。

## 8. 分阶段与验收

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| P1 | 封面抓取 + 二进制上传 + 单场/最近场次展示 | 300 场全部有图或明确兜底；发布后刷新即生效 |
| P1 | 相册页（成员 + 全组） | 390 / 320 无横向滚动；懒加载；URL 可分享 |
| P2 | 逐字稿导入、发布、渲染、时间戳、索引页 | 改一篇稿只需重新发布，不用构建；320px 可读 |
| P3 | 组首页 / 全组相册 | 已完成：首屏回答「最近谁播了」；全组相册可按成员 / 类型筛选并分享 URL |
| P3 | 跨成员对比 | 待做：同一时间段 / 内容类型的横向对比可分享 |
| P4 | 推文联动（手动 pin 优先） | 外部服务不可用时页面无变化 |
| 独立项目 | 逐字稿编辑器 | 不阻塞本站迭代 |

每阶段完成时同步更新：`data-model.md`（新增字段 / 文件布局）、`architecture.md`（路由与目录）、`adding-data.md`（作者工作流）、`README.md`、`CHANGELOG.md`。

## 9. 维护性约束

- 单一真源：封面来自 pack 的 `video.thumbnail`，逐字稿来自 `content/`；派生索引一律由发布步骤生成，不手改。
- 增量、可续跑、单条失败不阻塞（与 `fetch-streams` / `publish:data` 一致）。
- 不新增常驻服务、数据库、账号体系；对象存储 + 静态托管仍是唯一运行时依赖。
- 外部服务（YouTube、推文归档）一律可降级，不能成为首屏阻塞。
- 新依赖需要维护性理由；封面转码用 Bun 自带的 `Bun.Image`、逐字稿不引编辑器，都是这个原则的体现。
- 路由和 URL 参数保持可分享、可刷新、可后退。

## 10. 待定

1. ~~封面只存一份原图，还是同时生成 480w 变体？~~ 已定：原图 + 480 / 960 / 1280w WebP，`Bun.Image` 编码。
2. `thumbnail` 写进 manifest，还是完全由 videoId 推导？（v1 建议写进去，便于相册判断缺失）
3. ~~全组相册放在 `#/gallery`，还是并入未来的组首页？~~ 已定：独立路由 `#/gallery`，组首页底部放入口。
4. 逐字稿时间戳是否需要与逐分钟弹幕曲线联动高亮？（先做跳转，联动放 P3）
5. 推文模块是否值得长期维护？先用手动 pin 验证，不急于接 API。
