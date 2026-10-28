# 数据模型

页面消费四层 JSON：**dataset 索引 → manifest → insights → datapack**。四层都是纯 JSON，没有数据库；列表页只读前两层加 insights，单场/对比再按需读 datapack。

## 1. dataset 索引

`public/data/index.json` 由 `scripts/sync-data.mjs` 生成，页面启动时先读它。

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
| `count` | 成功同步的 datapack 数 |
| `generatedAt` | 源 manifest 的生成时间 |
| `manifest` | manifest 的相对路径 |
| `insights` | 预聚合摘要的相对路径 |

## 2. manifest

`data/<dataset>/manifest.json` 是一场批次的索引。最初 30 场来自 `batch30_manifest.json`，
后续由 `scripts/stream-datapack.ts` 增量 upsert。

```json
{
  "schema": "yumemita.stream-datapack.batch/v1",
  "generatedAt": "2026-10-28T03:24:04+09:00",
  "subject": "宮永ののか",
  "channelId": "UCGeCnpimiSN5rgiKbJzHd3A",
  "scope": "按频道顺序补齐的历史场次（48/262；同名去重，保留正片）",
  "count": 48,
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
| `sessionDir` | string | 原始会话目录（归档侧） |
| `datapack` | string | 归档侧相对路径 |

> manifest 是**摘要**，页面图表需要的逐分钟序列、SC 明细、Top 列表在 datapack 里。

## 3. insights

`public/data/<dataset>/insights.json` 由 `sync-data.mjs` 在同步时用 `aggregateDataset` 预聚合，schema `yumemita.dashboard.insights/v1`。

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
    "bestByAvg": null,
    "peakChatMinute": null
  }
}
```

- `totals` 的结构与 `src/lib/aggregate.ts` 的 `DatasetTotals` 一致：KPI、币种、Top 词/发言者、最佳场次、峰值分钟、典型节奏等。
- **生成物，不要手改**；数据更新后重新 `bun run sync:data`。
- 列表页依赖它渲染总览；缺失时页面会提示重新同步。

## 4. datapack

`data/<dataset>/<videoId>.datapack.json`，schema `yumemita.stream-datapack/v1`。

### 顶层

| 字段 | 说明 |
| --- | --- |
| `schema` | 固定 `yumemita.stream-datapack/v1` |
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
| `topAuthors` | 发言数 Top 20（含 SC / 贴纸 / 会员次数） |
| `topWords` | 分词词频（≥3 次、最多 40 个） |
| `hashtags` | `#` / `＃` 标签计数 |
| `emojiKinds` | 表情种类数 + Top 15 |

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

## 口径与限制

- **时间一律 JST（UTC+9）**。`video.startedAt` 取 `release_timestamp`（开播），不是 `timestamp`（公开）。
- **SC / 贴纸金额不换算汇率**，只按币种分组。页面上的币种占比按**笔数**画，金额单独列。
- **`vstats` 可能为 null**：会员限定、站点未收录、或早于收录起始日。相关图表会跳过/显示“—”。
- **评论区是抓取上限内的条数**，不等于视频总评论数；`video.snapshot.comments` 是 YouTube 侧的总数。
- **Top 列表有截断**：`topWords` 最多 40、`topAuthors` 最多 20。跨场聚合是“榜单相加”，不是全量重扫。
- **会员里程碑 ≠ 入会人数**：只记录直播中出现的提示。
- **播放/点赞有两套时点**：`vstats` 是站点快照，`video.snapshot` 是 yt-dlp 抓取时点；差值方向不固定。
- **纯表情单列**：`chat.total` 含纯表情；正文条数 = `total - pureEmojiOnly` 的近似（还要扣掉 SC/贴纸/会员条目，页面按 `byKind` 分别展示）。

## 版本演进

- 当前 schema：`yumemita.stream-datapack/v1`。
- **加字段**：向后兼容，旧 datapack 缺失时用 `?? null`；更新 `src/types/datapack.ts` 与本文档。
- **改语义 / 删字段**：提升 schema 版本（如 `/v2`），在 `src/lib/data.ts` 做兼容或迁移，不要静默改变旧数据含义。
- manifest schema：`yumemita.stream-datapack.batch/v1`；新增摘要字段同样按“可选 + 默认值”处理。

## 校验

```bash
bun run sync:data
bun run validate:data
```

`validate-data.mjs` 检查：

- `index.json` 存在且有 dataset；
- 每个 manifest 有 `streams`；
- 每个 dataset 的 `insights.json` 存在且有 `totals`；
- 每个 `streams[].videoId` 对应的 datapack 存在且能解析；
- `pack.schema` 正确；
- `pack.video.id === videoId`；
- `chat.total` 是数字；
- `chat.density.perMinute` 是数组。

更严格的数据质量检查（时长、币种、JST 等）建议在生成 datapack 的 pipeline 侧完成。
