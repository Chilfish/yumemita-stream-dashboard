# 数据模型

页面消费四层 JSON：**dataset 索引 → manifest → insights → datapack**。四层都是纯 JSON，没有数据库，全部放在对象存储（R2 等），页面运行时直接读取。`public/data/` 里的同源副本由 `sync:data` 生成，只在远端不可达时兜底。

所有数据由 `bun run publish:data` 从本地 pack 派生并上传；git 里只有 `data-sources.json`。

## 1. dataset 索引

`<base>/index.json` 由 `scripts/publish-data.ts` 生成，是页面的入口。`data.ts` 启动时带时间戳请求它，避免 CDN 旧缓存；远端缺失或不可达时回退到构建时的 `public/data/index.json`。

```json
{
  "schema": "yumemita.dashboard.datasets/v1",
  "generatedAt": "2026-10-28T04:24:04.000Z",
  "datasets": [
    {
      "id": "nonoka",
      "label": "宮永ののか",
      "channelId": "UCGeCnpimiSN5rgiKbJzHd3A",
      "count": 48,
      "generatedAt": "2026-10-28T03:24:04+09:00",
      "manifest": "data/nonoka/manifest.json",
      "insights": "data/nonoka/insights.json"
    }
  ]
}
```

| 字段 | 说明 |
| --- | --- |
| `id` | dataset 唯一标识，对应 `data/<id>/` |
| `label` | 页面显示名（成员名） |
| `channelId` | YouTube channel ID |
| `count` | manifest 里的场次数 |
| `generatedAt` | 源 manifest 的生成时间 |
| `manifest` | manifest 的相对路径 |
| `insights` | 预聚合摘要的相对路径 |

## 2. manifest

`<base>/<dataset>/manifest.json`（对象存储），由 `publish:data` 从 `data/<dataset>/*.datapack.json` 派生，页面按索引里的 `generatedAt` 作版本参数直接请求；`sync:data` 只生成 `public/data/` 兜底副本。

```json
{
  "schema": "yumemita.stream-datapack.batch/v1",
  "generatedAt": "2026-10-28T03:24:04+09:00",
  "subject": "宮永ののか",
  "channelId": "UCGeCnpimiSN5rgiKbJzHd3A",
  "scope": "按频道顺序补齐的历史场次（同名去重，保留正片）",
  "count": 287,
  "note": "vstats 为 null 表示该场没有 VSTATS 条目。",
  "streams": []
}
```

`streams[]` 的每一行是列表页/图表用的摘要，字段与 `src/types/dataset.ts` 的 `StreamSummary` 对应：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `rank` | number | 排序序号（最新 = 1） |
| `date` | string | 开播日期（JST，`YYYY-MM-DD`） |
| `videoId` | string | YouTube video id，也是 datapack 文件名 |
| `title` | string | 原标题 |
| `url` | string | YouTube 链接 |
| `durationHms` / `durationSec` | string / number | 时长 |
| `startedAt` / `endedAt` | ISO string | 开播/结束（JST） |
| `availability` | string | `public` / `subscriber_only` 等 |
| `avgConcurrent` / `maxConcurrent` | number \| null | VSTATS 同接 |
| `maxConcurrentAt` | string \| null | 最大值时刻（`MM/DD HH:mm`） |
| `watchTimeHours` | number \| null | VSTATS 视聴时间（人·时） |
| `vstatsViews` / `vstatsLikes` | number \| null | VSTATS 快照 |
| `snapshotViews` / `snapshotLikes` / `snapshotComments` | number \| null | yt-dlp 抓取时点 |
| `chatTotal` | number | 弹幕全部条目 |
| `chatByKind` | object | `text` / `superchat` / `sticker` / `membership` |
| `pureEmojiOnly` | number | 纯表情条数 |
| `uniqueAuthors` | number | 发言人数（单场去重） |
| `superchats` | number | SC 笔数 |
| `scTotalsByCurrency` | object | `{ "¥": { count, amount } }` |
| `stickers` / `memberships` | number | 贴纸 / 会员里程碑 |
| `commentsCaptured` | number \| null | 抓到的评论条数 |
| `chatPer1000AvgViewers` | number \| null | 每千同接弹幕 |
| `likesPer1000Views` | number \| null | 千播放点赞 |
| `scPerHour` | number \| null | SC 笔/小时 |
| `thumbnail` | string \| null | 封面原图相对 key（`thumbs/<videoId>.jpg`，WebP 变体由宽度后缀推导）；旧 pack 或没有封面时为 `null` |
| `sessionDir` | string | 原始会话目录（归档侧） |
| `datapack` | string | 归档侧相对路径 |

> manifest 是**摘要**，页面图表需要的逐分钟序列、SC 明细、Top 列表在 datapack 里。

封面图是这套数据里唯一的二进制对象：原图放在 `<base>/<dataset>/thumbs/<videoId>.jpg`，
同目录另有 480 / 960 / 1280w 的 WebP 变体 `<videoId>.<width>.webp`（本地暂存为
`data/<dataset>/thumbs/…`，gitignore），都由 `bun run fetch:thumbs` 生成（原图从 YouTube 镜像，变体由
`Bun.Image` 编码）。key 只由 dataset + videoId（+ 宽度）推导，不依赖 manifest，离线也能拼出 URL；
发布顺序是 **thumbs → pack → manifest / insights → index**，所以 `streams[].thumbnail` 出现时
原图与全部 `srcset` 候选都一定已经在桶里。

## 3. insights

`<base>/<dataset>/insights.json` 由 `publish:data` 用 `aggregateDataset` 预聚合，schema `yumemita.dashboard.insights/v1`，页面直接从对象存储请求，`sync:data` 只生成兜底副本。

```json
{
  "schema": "yumemita.dashboard.insights/v1",
  "generatedAt": "2026-10-28T07:07:33.929Z",
  "totals": {
    "streamCount": 48,
    "chatTotal": 99117,
    "scByCurrency": [],
    "topWords": [],
    "topAuthors": [],
    "aggregation": { "words": "full", "authors": "full" },
    "bestByAvg": null,
    "peakChatMinute": null
  }
}
```

- `totals` 的结构与 `src/lib/aggregate.ts` 的 `DatasetTotals` 一致：KPI、币种、Top 词/发言者、最佳场次、峰值分钟、典型节奏等。
- `aggregation` 标明跨场口径：`full` = 全部场次用 v2 全量字段重扫，`partial` = 部分场次全量、其余按 Top 列表相加，`top-lists` = 全部按 Top 列表相加。旧 insights 没有该字段时按 `top-lists` 理解。
- `coverage` 给出参与全量聚合的场次数（`words` / `authors` / `total`），页面的“精确覆盖 X/Y 场”直接读它。
- 逐场判断：v2 pack 用全量字段，v1 pack 用该场 Top 列表，不会因为少数缺失场次把整个 dataset 判成近似。
- **生成物，不要手改**；数据更新后重新 `bun run publish:data`。
- 列表页依赖它渲染总览；缺失时页面会提示重新发布。

## 4. datapack

`<base>/<dataset>/<videoId>.datapack.json`（对象存储），schema `yumemita.stream-datapack/v1` 或 `/v2`。本地暂存在 `data/<dataset>/<videoId>.datapack.json`，是唯一真源。v2 在 v1 基础上追加全量作者与全量词频；旧 pack 继续可用。

### 顶层

| 字段 | 说明 |
| --- | --- |
| `schema` | `yumemita.stream-datapack/v1` 或 `/v2` |
| `generatedAt` | datapack 生成时间（JST） |
| `video` | 视频元信息 |
| `vstats` | VSTATS 单场快照，可能为 `null` |
| `chat` | 弹幕、SC、密度、Top 列表 |
| `comments` | 评论区，可能为 `null` |
| `derived` | 派生比值 |

### `video`

| 字段 | 说明 |
| --- | --- |
| `id` / `url` / `title` | 视频标识与标题 |
| `channelId` / `channelName` / `channelUrl` | 频道 |
| `channelFollowersAtCapture` | 抓取时订阅数 |
| `liveStatus` / `availability` | `was_live` / `public` / `subscriber_only` |
| `startedAt` | 开播时刻（`release_timestamp`，不是 `timestamp`） |
| `publishedAt` | 公开/确认时刻 |
| `durationSec` / `durationHms` | 时长 |
| `endedAt` | 结束时刻 |
| `thumbnail` / `description` / `links` / `chapters` | 简介与章节 |
| `hasLiveChatReplay` / `captionsJa` | 弹幕回放 / 日语字幕有无 |
| `snapshot` | 抓取时点的 `views` / `likes` / `comments` |

### `vstats`

| 字段 | 说明 |
| --- | --- |
| `updatedAt` | VSTATS 页面更新时间 |
| `startedAt` / `endedAt` / `durationText` | 站点口径的开始/结束/时长 |
| `avgConcurrent` / `maxConcurrent` | 平均/最大同接 |
| `maxConcurrentAt` | 最大值时刻 |
| `watchTimeHours` | 视聴时间（人·时，站点口径） |
| `views` / `likes` | 站点快照 |

`vstats: null` 的常见原因：会员限定（站点不收录）、早于站点开始收录的日期（本频道约 2026-08-31 以前）。

### `chat`

| 字段 | 说明 |
| --- | --- |
| `total` | 全部条目数（含纯表情） |
| `byKind` | `text` / `superchat` / `sticker` / `membership` |
| `pureEmojiOnly` | 只剩频道表情的条目 |
| `uniqueAuthors` | 发言人数（单场去重） |
| `ownerMessages` | 主播本人发言数 |
| `badges` | 徽章分布，如 `Member` / `New member` / `Owner` |
| `timeRange` | `firstAt` / `lastAt` / `preRollSec`（开播前待机秒数） |
| `coveragePct` | 弹幕覆盖到的时长占比 |
| `density.perMinute` | 逐分钟条数，下标 = 开播后第几分钟 |
| `density.perMinuteSc` | 逐分钟 SC 笔数 |
| `density.perFiveMinute` / `perTenMinute` | 5/10 分钟汇总；10 分钟档带 `offsetMin` / `at` |
| `density.peakMinute` | 峰值分钟 `{ offsetMin, at, count }` |
| `paid.superchats` | SC 全量：`at` / `author` / `amountText` / `currency` / `amount` / `message` |
| `paid.scTotalsByCurrency` | 分币种合计，不换算汇率 |
| `paid.stickers` / `stickerTotalsByCurrency` | 贴纸同上 |
| `paid.memberships` | 会员里程碑（`header` 来自原始 chat 回放） |
| `paid.paidSharePct` | 付费条目占比 |
| `topAuthors` | 发言数 Top 20（含 `authorId` / SC / 贴纸 / 会员次数） |
| `topWords` | 分词词频（≥3 次、最多 40 个） |
| `authors` | **v2**：全量作者统计，按发言数降序；字段 `author` / `authorId` / `messages` / `superchats` / `stickers` / `memberships` |
| `wordCounts` | **v2**：全量分词词频 `{ 词: 次数 }`，不截断 |
| `hashtags` | `#` / `＃` 标签计数 |
| `emojiKinds` | 表情种类数 + Top 15 |

`authorId` 是 YouTube 的稳定频道 ID（原始回放里的 `authorExternalChannelId`）。显示名会改、也会重名，**观众重叠必须按 `authorId` 合并**；没有 ID 的旧数据才退回显示名。

### `comments`

| 字段 | 说明 |
| --- | --- |
| `total` | 顶层 + 回复 |
| `topLevel` / `replies` | 顶层 / 回复数 |
| `pinned` | 置顶数 |
| `totalLikes` | 顶层评论赞数合计 |
| `items[]` | `author` / `authorId` / `likes` / `at` / `pinned` / `byUploader` / `text` |

### `derived`

| 字段 | 说明 |
| --- | --- |
| `chatPer1000AvgViewers` | 弹幕 ÷ 平均同接 × 1000 |
| `likesPer1000Views` | 点赞 ÷ 播放 × 1000 |
| `scPerHour` | SC 笔/小时 |
| `vstatsVsYtdlpViews` | VSTATS 播放 − 抓取时点播放（可能为负） |

## 5. 作者索引

`<base>/<dataset>/authors.json` 由 `publish:data` 从 v2 pack 派生，只在观众重叠等分析页按需加载，不参与首屏。

```json
{
  "schema": "yumemita.dashboard.authors/v1",
  "generatedAt": "2026-10-30T02:00:00.000Z",
  "datasetId": "nonoka",
  "authors": [{ "id": "UC…", "name": "@…" }],
  "streams": [{ "videoId": "…", "authors": [0, 3, 7] }]
}
```

- `authors[]` 按稳定 ID 去重；`name` 取最新场次里抓到的显示名。
- `streams[].authors` 是指向 `authors[]` 的下标，按最新场次在前排列，单场内升序。
- 任一场还是 v1（缺 `chat.authors`）时**不生成**该文件：宁可不给，也不用半套数据算重叠。
- 体积参考：约 166 人/场、1891 场时，全量作者记录约 8 MB（JSON），远小于逐场拉 datapack。

## 6. 逐字稿

逐字稿是作者手写的 Markdown，源文件在 `content/transcripts/<datasetId>/<videoId>.md`（进 git）。发布后页面读两份 JSON：

`<base>/transcripts/index.json`：

```json
{
  "schema": "yumemita.transcripts/v1",
  "generatedAt": "2026-10-29T23:00:00+09:00",
  "entries": [
    {
      "datasetId": "nonoka",
      "videoId": "0Oom7elwKMo",
      "date": "2026-10-13",
      "title": "【ライブ振り返り】バンドリ！13thライブをふりかえる！",
      "tags": ["杂谈", "13th live"],
      "summary": "一句话摘要",
      "updatedAt": "2026-10-29T22:55:00.000Z"
    }
  ]
}
```

`<base>/<datasetId>/transcripts/<videoId>.json`：

```json
{
  "schema": "yumemita.transcript/v1",
  "datasetId": "nonoka",
  "videoId": "0Oom7elwKMo",
  "frontmatter": {
    "videoId": "0Oom7elwKMo",
    "date": "2026-10-13",
    "title": "…",
    "members": ["nonoka"],
    "tags": ["杂谈"],
    "summary": "…",
    "tweets": []
  },
  "markdown": "## 开场\n\n[00:00:12] …",
  "updatedAt": "2026-10-29T22:55:00.000Z"
}
```

- 索引最后写；单篇失败只记日志，不阻塞其余稿件。
- `videoId` 是关联场次的唯一键；`markdown` 保留原始时间码，渲染时再改写成深链。
- 远端不可达时页面回退到构建期的 Markdown 快照（Vite `import.meta.glob`），所以本地不发布也能预览。

## 口径与限制

- **时间一律 JST（UTC+9）**。`video.startedAt` 取 `release_timestamp`（开播），不是 `timestamp`（公开）。
- **SC / 贴纸金额不换算汇率**，只按币种分组。页面上的币种占比按**笔数**画，金额单独列。
- **`vstats` 可能为 null**：会员限定、站点未收录、或早于收录起始日。相关图表会跳过/显示“—”。
- **评论区是抓取上限内的条数**，不等于视频总评论数；`video.snapshot.comments` 是 YouTube 侧的总数。
- **Top 列表有截断**：`topWords` 最多 40、`topAuthors` 最多 20，单场页直接用它们。
- **跨场精确聚合依赖 v2**：v2 pack 另存全量 `wordCounts` / `authors`，`publish:data` 据此重扫；v1 场次自动回退到该场的 Top 列表相加。`insights.totals.aggregation` 标出 `full` / `partial` / `top-lists` 与覆盖率，页面文案随之切换。
- **作者身份以 `authorId` 为准**：旧 jsonl 没有该字段（显示名会改、会重名），需要归档侧重跑归一化才能补齐；缺 ID 时只能按显示名匹配，重叠结果仅供参考。
- **会员里程碑 ≠ 入会人数**：只记录直播中出现的提示。
- **播放/点赞有两套时点**：`vstats` 是站点快照，`video.snapshot` 是 yt-dlp 抓取时点；差值方向不固定。
- **纯表情单列**：`chat.total` 含纯表情；正文条数 = `total - pureEmojiOnly` 的近似（还要扣掉 SC/贴纸/会员条目，页面按 `byKind` 分别展示）。

## 版本演进

- 当前 schema：`yumemita.stream-datapack/v1` / `/v2` 并存。
- **v2**：在 v1 上追加 `chat.authors` / `chat.wordCounts`，并给 `topAuthors` 增加可选 `authorId`。字段全部可选，v1 pack 与 v2 pack 可以同时存在。
- 兼容策略是逐场混合：有全量字段的场次用全量，没有的用该场 Top 列表；`insights.totals.aggregation` 按覆盖场次数标 `full` / `partial` / `top-lists`，并给出 `coverage`。
- **加字段**：向后兼容，旧 datapack 缺失时用 `?? null`；更新 `src/types/datapack.ts` 与本文档。
- **改语义 / 删字段**：提升 schema 版本（如 `/v3`），在 `src/lib/aggregate.ts` 做兼容或迁移，不要静默改变旧数据含义。
- manifest schema：`yumemita.stream-datapack.batch/v1`；新增摘要字段同样按“可选 + 默认值”处理。

## 校验

```bash
bun run sync:data
bun run validate:data
```

`validate-data.mjs` 检查：

- `index.json`（兜底快照）存在且有 dataset；
- 每个 manifest 有 `streams`；
- 每个 dataset 的 `insights.json` 存在，且 `totals.streamCount` 与 manifest 场次数一致；
- 每个 `streams[].videoId` 非空；
- 加 `--remote` 时逐条 HEAD `<base>` 上的 `index.json`、manifest / insights / datapack。

datapack 的字段级校验（`schema`、`video.id === videoId`、`chat.total`、`density.perMinute` 等）
在 `publish:data` 读取 pack 时完成——`video.id` 与文件名不一致会直接中止发布。

更严格的数据质量检查（时长、币种、JST 等）建议在生成 datapack 的 pipeline 侧完成。
