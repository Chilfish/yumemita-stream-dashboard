# 数据模型

> **2026-11-04 更新**：页面只读 **PostgreSQL**（`src/db/schema.ts`、`src/db/queries/`）。本文保留 pack / manifest 的字段口径，供 ingest 与本地派生参考；字段到表的映射见 [astro-ssr-migration.md §6](../archive/astro-ssr-migration.md#6-数据模型)。`index.json` / `manifest.json` / `insights.json` / `group-*.json` 不再上传对象存储，也不再被页面读取。

成员页的数据来源是 **`streams` + `dataset_insights`**；组首页与全组相册由 `getGroupSummary` / `getGroupGallery` 在 SQL 里聚合。本文第 1–4 节的 JSON 只用于理解派生产物与本地调试。

所有结构化数据由 `bun db:ingest` 从本地 pack 投影到数据库；对象存储只放封面、表情、archive 与逐字稿正文。git 里只有 `data-sources.json` 与手写逐字稿。

## 1. dataset 索引

`index.json` 只是旧派生格式，不再上传或读取。当前成员入口由 `getDatasets()` 查 `datasets` 表生成。

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

`manifest.json` 只由本地 `publish:data` 派生，用于调试与恢复，不再上传。当前列表数据由 `listStreams()` 查 `streams` 表返回。

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
| `chatByKind` | object | `text` / `superchat` / `sticker` / `membership` / `gift` |
| `pureEmojiOnly` | number | 纯表情条数 |
| `uniqueAuthors` | number | 发言人数（单场去重） |
| `superchats` | number | SC 笔数 |
| `scTotalsByCurrency` | object | `{ "¥": { count, amount } }` |
| `stickers` / `memberships` | number | 贴纸 / 会员里程碑 |
| `gifts` / `giftedMemberships` | number | 赠送会员公告数 / 赠送会员总数（旧 manifest 没有） |
| `commentsCaptured` | number \| null | 抓到的评论条数 |
| `chatPer1000AvgViewers` | number \| null | 每千同接弹幕 |
| `likesPer1000Views` | number \| null | 千播放点赞 |
| `scPerHour` | number \| null | SC 笔/小时 |
| `paidSharePct` | number \| null | 付费条目（SC / 贴纸 / 会员 / 赠送）占时间轴内消息的比例；写入 `streams.paid_share_pct`，汇总按场平均 |
| `thumbnail` | string \| null | 封面原图相对 key（`thumbs/<videoId>.jpg`，WebP 变体由宽度后缀推导）；旧 pack 或没有封面时为 `null` |
| `sessionDir` | string | 原始会话目录（归档侧） |
| `datapack` | string | 归档侧相对路径 |

> manifest 是**摘要**，页面图表需要的逐分钟序列、SC 明细、Top 列表在 datapack 里。

频道专属表情是静态资源，手动跑一次即可：`bun run fetch:emoji` 合并
`data/emoji-<dataset>.html`、`data/emoji-youtube.html`（频道 / YouTube 全局表情选择器）与
`chat.emojis[].url`，镜像到
`data/<dataset>/emoji/<hash>.png`，发布到 `<base>/emojis/<dataset>/<hash>.png`；
`UCksz…` 开头的 YouTube 全局表情单独放 `emojis/youtube/`，不按成员复制。
同目录的 `index.json` 提供 id → 名称，旧 pack 也能显示文字标签。
页面按 `emojiId`（`<channelId>/<hash>`）直接拼 URL，不读图片清单。发布顺序与封面相同。

封面图是这套数据里唯一的二进制对象：原图放在 `<base>/<dataset>/thumbs/<videoId>.jpg`，
同目录另有 480 / 960 / 1280w 的 WebP 变体 `<videoId>.<width>.webp`（本地暂存为
`data/<dataset>/thumbs/…`，gitignore），都由 `bun run fetch:thumbs` 生成（原图从 YouTube 镜像，变体由
`Bun.Image` 编码）。key 只由 dataset + videoId（+ 宽度）推导，不依赖 manifest，离线也能拼出 URL；
发布顺序是 **thumbs → pack → manifest / insights → index**，所以 `streams[].thumbnail` 出现时
原图与全部 `srcset` 候选都一定已经在桶里。

## 3. 组级精简数据

组首页与全组相册不拉五份完整 manifest，而是读两份由 manifest 派生的精简文件：

- `<base>/group-summary.json`（schema `yumemita.dashboard.group-summary/v1`）：组首页的旧派生格式，当前页面不再读取；`days` 覆盖最近 100 天。
- `<base>/group-gallery.json`（schema `yumemita.dashboard.group-gallery/v1`）：全组相册的旧派生格式，当前页面不再读取。

这两份文件只在本地派生，不再上传。当前组数据由 `getGroupSummary()` / `getGroupGallery()` 查询生成。

### group-summary.json

```json
{
  "schema": "yumemita.dashboard.group-summary/v1",
  "generatedAt": "2026-10-30T15:28:17+09:00",
  "members": [
    {
      "datasetId": "nonoka",
      "streamCount": 287,
      "chatTotal": 770849,
      "superchats": 2661,
      "durationSec": 1234567,
      "avgConcurrent": 626.32
    }
  ],
  "days": [
    { "datasetId": "nonoka", "date": "2026-10-29", "streams": 1, "chat": 3463 }
  ],
  "latest": [],
  "recent": []
}
```

| 字段 | 说明 |
| --- | --- |
| `members` | 全期汇总：场次、弹幕、SC、时长、按时长加权的平均同接。不随“今天”变化。 |
| `days` | 最近 100 天有场次的日期桶（`streams` / `chat`）。近 7 天 / 本月窗口与首页出勤条共用，客户端用当前日期在这些桶上求和与补格；不需要 1,891 行逐场明细。 |
| `latest` | 每位成员最新一场，供 hero、成员列表与 SEO 分享图。 |
| `recent` | 全组最近 20 场，首页实际展示前 8 条。 |

`latest` / `recent` 的每一行是 `GroupStreamSummary`，即 `StreamSummary` 的精简子集：

| 字段 | 说明 |
| --- | --- |
| `datasetId` | 归属成员 |
| `date` / `videoId` / `title` / `startedAt` | 场次标识与标题 |
| `durationSec` / `availability` | 时长、会员限定 |
| `avgConcurrent` / `maxConcurrent` | 同接 |
| `chatTotal` / `superchats` | 弹幕、SC |
| `vstatsViews` / `snapshotViews` | 播放（优先 VSTATS） |
| `thumbnail` | 封面相对 key，与 manifest 同义 |

### group-gallery.json

```json
{
  "schema": "yumemita.dashboard.group-gallery/v1",
  "generatedAt": "2026-10-30T15:28:17+09:00",
  "streams": []
}
```

相册需要铺满所有场次，所以 `streams` 是全部 `GroupStreamSummary`（按开播时间倒序）；组首页不加载它。

### 为什么不用逐场 `stats`

窗口（近 7 天 / 本月）与出勤条依赖“今天”，不能在发布时写死；但也不该把 1,891 行逐场统计塞进首页。用 `members`（全期汇总）+ `days`（最近 100 天按日桶）即可在客户端精确求和与补格，体积仍远小于逐场明细。

## 4. insights

`insights.json` 由 `publish:data` / `ingest-db` 用 `aggregateDataset` 预聚合，schema `yumemita.dashboard.insights/v1`。页面汇总读 `dataset_insights.public_totals`，不在请求期从 pack 重算。

- `totals`：含会员限定场的全量口径，供本地核对与 `db:verify` 使用。
- `public_totals`：公开页面口径。会员限定场只计入 `streamCount` / `memberOnlyCount`，其余指标按公开场次计算；由 ingest 用 `aggregateDataset` 生成。旧数据没有该列时回退 `totals`。
- 请求期不再加载 `stream_details` / comments / paid / words / authors；一次页面汇总查询只有一行 JSON（约 15–22 KB）。

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
- **生成物，不要手改**；数据更新后重新 `bun run db:ingest`。
- 列表页依赖它渲染总览；缺失时页面会显示错误态，重新 ingest 即可。

## 5. datapack

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
| `byKind` | `text` / `superchat` / `sticker` / `membership` / `gift`（赠送会员公告；领到的赠礼会员计入 `membership`） |
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
| `paid.superchats` | SC 全量：`at` / `author` / `amountText` / `currency` / `amount` / `message` / `emojis`（留言里的表情 id） |
| `paid.scTotalsByCurrency` | 分币种合计，不换算汇率 |
| `paid.stickers` / `stickerTotalsByCurrency` | 贴纸同上 |
| `paid.memberships` | 会员里程碑（`header` 来自归一化弹幕，旧 jsonl 回退原始回放的 `headerSubtext`；领到赠礼时为 `received a gift membership by …`） |
| `paid.gifts` | 赠送会员公告：`at` / `author`（赠送方）/ `count`（个数）/ `text`（原文） |
| `paid.paidSharePct` | 付费条目（SC / 贴纸 / 会员 / 赠送）占比 |
| `topAuthors` | 发言数 Top 20（含 `authorId` / SC / 贴纸 / 会员次数） |
| `topWords` | 分词词频（≥3 次、最多 40 个；已剔除英文虚词与寒暄词） |
| `authors` | **v2**：全量作者统计，按发言数降序；字段 `author` / `authorId` / `messages` / `superchats` / `stickers` / `memberships` |
| `wordCounts` | **v2**：全量分词词频 `{ 词: 次数 }`，不截断；同样已剔除英文虚词与寒暄词 |
| `hashtags` | `#` / `＃` 标签计数 |
| `emojiKinds` | 表情种类数 + Top 15 |
| `ownerChats` | 主播本人发言与操作，按时间顺序全量：`at` / `kind` / `text` / `emojis`；`kind: "event"` 表示置顶 / 投票 / Q&A 等主播操作。旧 pack 缺失 |
| `emojis` | 本场出现过的频道专属表情：`id`（`<channelId>/<hash>`）/ `name` / `url`（InnerTube 原图）；旧 pack 缺失 |
| `events` | 非消息事件：`at` / `type` / `owner` / `author` / `text` / `data`。`type` 取 `banner` / `bannerRemoved` / `poll` / `pollUpdate` / `qna` / `product` / `system` / `modeChange` / `deleted` / `deletedAuthor` / `replaced` / `panel` / `other`；投票的 `data.choices` 是最后一次快照。没有实时采集时缺失 |

`authorId` 是 YouTube 的稳定频道 ID（原始回放里的 `authorExternalChannelId`）。显示名会改、也会重名，**观众重叠必须按 `authorId` 合并**；没有 ID 的旧数据才退回显示名。

#### 事件覆盖

| renderer | 记录为 |
| --- | --- |
| `liveChatTextMessageRenderer` | `text` |
| `liveChatPaidMessageRenderer` / `liveChatPaidStickerRenderer` | `superchat` / `sticker`（金额取 `purchaseAmountText`） |
| `liveChatMembershipItemRenderer` | `membership`（入会/续费里程碑） |
| `liveChatSponsorshipsGiftPurchaseAnnouncementRenderer` | `gift`（赠送方 + 个数） |
| `liveChatSponsorshipsGiftRedemptionAnnouncementRenderer` | `giftRedemption`，在 pack 里并入 `membership` |

主动忽略的：`liveChatViewerEngagementMessageRenderer`（系统欢迎语）、`liveChatModeChangeMessageRenderer`（慢速/会员限定开关）、auto-mod 提示、`liveChatBannerRenderer` / ticker（置顶与滚动副本，回放里它们的 renderer id 都能在 `addChatItemAction` 找到）、删除类 action（已记录的条目不回溯改写）。Q&A（`liveChatCallForQuestionsRenderer` / `liveChatCreatorAnswersQuestionsRenderer`）尚未收录，出现时会进入归一化的 skipped 统计。

YouTube 不回传赠送会员的单价，`paid.gifts[].count` 只有个数；实时同接曲线也只有 VSTATS 的平均/最大两个快照值。

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

## 6. 作者索引

`authors.json` 是旧派生格式，不再上传。当前作者数据在 `authors` / `stream_authors` 表，观众重叠以后直接查库。

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

## 7. 逐字稿

逐字稿是作者手写的 Markdown，源文件在 `content/transcripts/<datasetId>/<videoId>.md`（进 git）。

- **正文**：`publish:transcripts` 上传到 R2 `<base>/<datasetId>/transcripts/<videoId>.json`，Worker 通过 R2 binding 读取。
- **索引与可用性**：`ingest-db` 把 frontmatter 投影到 `transcripts` 表；索引页与「这场有没有稿」都由 `src/db/queries/transcripts.ts` 查库，请求期 SSR。
- `<base>/transcripts/index.json` 仍由发布脚本维护为兼容产物，页面不再读取。

正文 JSON（`<base>/<datasetId>/transcripts/<videoId>.json`）：

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

- 单篇发布失败只记日志，不阻塞其余稿件。
- `videoId` 是关联场次的唯一键；`markdown` 保留原始时间码，渲染时再改写成深链。
- 索引页与可用性查 `transcripts` 表；正文不可达时页面显示加载失败，不把整页变成错误。

## 8. 开播前 / 直播中采集

消息与事件的字段级定义、事件类型、合并去重和已知限制见 [chat-events.md](./chat-events.md)。本节只保留与 pack 相关的入口。

yt-dlp 的 `live_chat` 字幕只在直播结束后才存在；等待室与直播中的弹幕走 InnerTube：

```bash
bun run fetch:live-chat --video <videoId>          # 跟随到结束，Ctrl-C 保存状态退出
bun run fetch:live-chat --video <videoId> --once   # 只拉一页（等待室历史 / 定时任务）
```

- watch 页必须带浏览器 UA + `hl=en`；continuation 优先级 **reload → timed → invalidation → replay**。
  等待室只给 `reloadContinuationData`，只认 timed 会拿不到历史。`LIVE_STREAM_OFFLINE` 不是终态。
- 产出 `danmaku/danmaku_live_<videoId>.jsonl`，记录形状与回放 jsonl 相同，额外带 `rendererId`
  （同一条消息在实时与回放里 id 相同，合并时按它去重；旧档缺失时退回 `timestampUs + 作者 + kind + text`）。
- 非消息事件写 `danmaku/events_<videoId>.jsonl`（原始 renderer 也保留），置顶 / 投票 / Q&A / 商品标
  `owner: true`；ticker 是消息的滚动副本，忽略并计入 `skipped`。
- `fetch:streams` / `fetch:danmaku` 抓到回放后自动合并两份 jsonl，输出仍是 `danmaku_<videoId>.jsonl`；
  合并按 `ts` 排序并重编 `seq`。只有实时采集、没有回放时，`stream-datapack` 会回退读 `danmaku_live_`
  （仍需 `fetch:streams` 抓到 `meta/info.json`）。
- 词频只统计消息正文，不含系统提示；主播操作通过 `chat.ownerChats`（`kind: "event"`）进入 `?view=words`，
  全部事件保留在 `chat.events`。
- 登录态每次运行从浏览器重新导出到 `~/yt-cookies.txt`，整轮复用；导出失败才退回旧缓存。
  浏览器会轮换 `__Secure-*PSIDTS`，旧 jar 会命中 YouTube bot 检查。`--no-cookies` 以匿名状态抓取
  （yt-dlp 也不会回退浏览器）。CI 用 `--cookies <文件>` 或 `YT_COOKIE`。

### 已结束场次的回放

watch 页 `liveChatRenderer.isReplay === true` 时，拿 `reloadContinuationData` 请求
`youtubei/v1/live_chat/get_live_chat_replay` 即可翻完整个回放（匿名可用）：

```bash
bun scripts/fetch-danmaku.ts --dataset <id> --video <videoId>   # 单场补弹幕
bun run fetch:live-chat --video <videoId>                       # 已结束时也自动走回放
```

- 续页只认 `liveChatReplayContinuationData`；`playerSeekContinuationData` 是跳转进度，不是下一页。
- 输出与实时采集同一套：`danmaku_<videoId>.jsonl`、`events_<videoId>.jsonl`、`emoji_<videoId>.json`；
  已有的 `danmaku_live_` 与旧 yt-dlp jsonl 会在收尾时合并（`rendererId` 优先，旧档缺 id 时按
  `timestampUs + 作者 + kind + text` 对齐）。
- 回放首屏的 `Live chat replay is on` 是播放器提示，不写入事件；中断状态在
  `work/replay-state.json`，重跑从断点续翻，`--force` 才从头重抓。
- 回放只覆盖 YouTube 当前可见的消息；被删除 / 封禁账号的历史消息只在 yt-dlp 字幕档里。
  需要历史完整档时对已有场次跑 `--force --engine yt-dlp`。

## 9. 直播日程（`scheduled_streams`）

未来场次单独存在 `scheduled_streams`，不写 `streams`。日历读取时再与已结束场次合并。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `dataset_id` | text | 成员 id，外键到 `datasets` |
| `event_key` | text | `yt:<videoId>` 或 `manual:<slug>`，与 `dataset_id` 组成主键 |
| `video_id` | text \| null | 已知的 YouTube video id；有值时主键用 `yt:` |
| `superseded_by` | text \| null | ingest 确认已有对应 `streams` 行时写入的 video id；读取时优先据此判定已结束 |
| `title` | text | 日程标题；空字符串表示「待定」 |
| `url` | text \| null | YouTube 链接 |
| `date` | date \| null | JST 自然日；只知道日期和时段时由管理端写入 |
| `slot` | text \| null | `early` / `mid` / `late`；有精确时间时派生 |
| `kind` | text \| null | `sing` / `event` / `talk` / `game`；空值时按标题推断 |
| `thumbnail_key` | text \| null | 预留列，当前不写入、不展示；正式封面仍从 `streams.thumbnail_key` 读取 |
| `scheduled_at` | timestamptz \| null | 精确开播时间；只有时段时为空 |
| `expected_minutes` | integer \| null | 预计时长；仅作管理端记录，不参与状态派生 |
| `cancelled_at` | timestamptz \| null | 非空表示已取消 |
| `availability` | text \| null | `public` / `subscriber_only` |
| `source` | text | `youtube`（频道自动同步）/ `manual`（管理端） |
| `note` | text \| null | 备注 |
| `last_seen_at` / `last_live_at` | timestamptz \| null | 频道检查时间；`last_live_at` 仅在缺少精确开播时间时作为 1 小时直播窗口的起点 |
| `created_at` / `updated_at` | timestamptz | 审计时间 |

索引：

- 主键 `(dataset_id, event_key)`，同步脚本按它 upsert。
- `(dataset_id, video_id)` 部分唯一索引，避免同一视频出现两条。
- `(dataset_id, date)` 与 `(scheduled_at)` 服务日期范围查询。

读取时按「成员 + JST 日期 + 时段」把没有 `video_id` 的手工行匹配到 `streams`；
命中后不再显示手工行，直接显示真实场次。匹配规则见 [schedule-admin.md](../engineering/schedule-admin.md) 第 3 节。

## 口径与限制

- **时间一律 JST（UTC+9）**。`video.startedAt` 取 `release_timestamp`（开播），不是 `timestamp`（公开）。
- **SC / 贴纸金额不换算汇率**，只按币种分组。币种取 `purchaseAmountText` 里第一个数字之前的前缀（`¥` / `HK$` / `MX$` / `SGD` / `₫` …），不维护白名单。页面上的币种占比按**笔数**画，金额单独列。
- **`vstats` 可能为 null**：会员限定、站点未收录、或早于收录起始日。相关图表会跳过/显示“—”。
- **评论区是抓取上限内的条数**，不等于视频总评论数；`video.snapshot.comments` 是 YouTube 侧的总数。
- **Top 列表有截断**：`topWords` 最多 40、`topAuthors` 最多 20，单场页直接用它们。
- **英文虚词与寒暄词不进词频**：`Intl.Segmenter` 会把英文句子切成完整单词，`said` / `hi` / `the` 这类不承载内容的 token 不该挤进高频词。分词与页面聚合共用 `src/lib/stopwords.ts` 的停用词表，旧 pack 里残留的这类词在展示时也会被过滤。
- **跨场精确聚合依赖 v2**：v2 pack 另存全量 `wordCounts` / `authors`，`ingest-db` 用 `aggregateDataset` 重算；v1 场次自动回退到该场的 Top 列表相加。`dataset_insights.aggregation` 标出 `full` / `partial` / `top-lists` 与覆盖率，页面文案随之切换。
- **频道专属表情靠频道字典补图**：`data/emoji-<dataset>.html` 覆盖该频道当前的表情，旧 pack 不需要重新归一化；字典里没有的历史表情退回占位。Unicode 表情不镜像，直接显示字符。
- **作者身份以 `authorId` 为准**：旧 jsonl 没有该字段（显示名会改、会重名），需要归档侧重跑归一化才能补齐；缺 ID 时只能按显示名匹配，重叠结果仅供参考。
- **会员里程碑 ≠ 入会人数**：只记录直播中出现的提示；领取赠礼同样只算直播里看到的领取，没被领走的赠礼只体现在 `paid.gifts` 的 `count` 里。
- **播放/点赞有两套时点**：`vstats` 是站点快照，`video.snapshot` 是 yt-dlp 抓取时点；差值方向不固定。
- **纯表情单列**：`chat.total` 含纯表情；正文条数 = `total - pureEmojiOnly` 的近似（还要扣掉 SC/贴纸/会员条目，页面按 `byKind` 分别展示）。

## 版本演进

- 当前 schema：`yumemita.stream-datapack/v1` / `/v2` 并存。
- **v2**：在 v1 上追加 `chat.authors` / `chat.wordCounts`，并给 `topAuthors` 增加可选 `authorId`。字段全部可选，v1 pack 与 v2 pack 可以同时存在。
- **赠送会员**：`chat.byKind.gift` 与 `paid.gifts` 同样是可选追加字段，旧 pack 缺失时按 0 处理；旧场次要重抓弹幕才会写入。
- 兼容策略是逐场混合：有全量字段的场次用全量，没有的用该场 Top 列表；`insights.totals.aggregation` 按覆盖场次数标 `full` / `partial` / `top-lists`，并给出 `coverage`。
- **加字段**：向后兼容，旧 datapack 缺失时用 `?? null`；更新 `src/types/datapack.ts` 与本文档。
- **改语义 / 删字段**：提升 schema 版本（如 `/v3`），在 `src/lib/aggregate.ts` 做兼容或迁移，不要静默改变旧数据含义。
- manifest schema：`yumemita.stream-datapack.batch/v1`；新增摘要字段同样按“可选 + 默认值”处理。

## 校验

```bash
bun run db:verify       # 数据库与 pack 字段级对账
bun run db:query        # 查询层冒烟
bun run validate:data   # pack 级 schema 校验（旧派生文件检查已停用）
```

`validate-data.mjs` 校验本地 pack；整站数据以 `db:verify` 为准：

- 每个 `data/<id>/<videoId>.datapack.json` 通过 `DatapackSchema`；
- `video.id` 与文件名一致；
- 每个 dataset 至少有一个 pack；
- 加 `--remote` 时逐条 HEAD `<base>/archive/<id>/<videoId>.datapack.json`。

datapack 的字段级校验（`schema`、`video.id === videoId`、`chat.total`、`density.perMinute` 等）
在 `ingest-db` / `validate:data` 读取 pack 时完成：`video.id` 与文件名不一致会拒绝入库 / 校验失败。

更严格的数据质量检查（时长、币种、JST 等）建议在生成 datapack 的 pipeline 侧完成。
