# 联动场次：多人同一直播间

> 状态：✅ 已落地（2026-11-12）。
> 关联：`streams` / `scheduled_streams` 归属模型、日历、场次列表、成员页、单场页。
> 字段口径见 [data-model.md](../data/data-model.md) 的直播日程一节，日程接口见 [schedule-admin.md](../engineering/schedule-admin.md)。

## 1. 问题

改造前是「一场直播属于一个成员」：`streams.dataset_id`、`scheduled_streams.dataset_id` 都是单值列，查询也按它过滤。

联动场次因此有一半信息丢失。以 [fvSCCUPBzU0](https://youtube.com/live/fvSCCUPBzU0) 为例：

- 标题是「【#ぎたーグミ コラボ】弾き語り＆セッション！ののちゃんとギター弾いてみる！【峰月律/宮永ののか】」。
- 频道是峰月律，整场记在 `ritsu` 名下。
- 宮永ののか 的成员页、场次列表、日历、相册里都查不到这一场。

本地 pack 实测（2026-11-12，1,920 场）：按标题里的成员别名扫出 66 场疑似联动；**跨 dataset 重复 0 场**，每个 videoId 只在一份 pack 里。

第二点决定了改法：不能靠「复制一条记录给对方」，否则同一场会在全组列表、组首页、sitemap、计数里各出现两次。

## 2. 目标与非目标

### 目标

- 一场直播有一个**频道主**（owner，`dataset_id`）和若干**参与者**（`participants`）。
- 参与者的成员页、场次列表、日历里都能看到这场；点进去是同一份单场页。
- 全组口径不重复计数：组首页、全组相册、sitemap 仍按 videoId 唯一。
- 未登记参与者的历史数据行为不变，不需要一次性回填。

### 非目标

- 不做自动识别入库。标题别名有假阳性：`語りつつ` 命中 `りつ`，食物「あられ」命中 仲町あられ。匹配只作为候选提示。
- 不引入成员维表或多人主键。参与者是 owner 之外的附加关系，不做「无主多成员」的场次。
- 不改指标口径：一场的弹幕、SC、同接仍是一份，不按人数拆分或摊薄。

## 3. 数据模型

### 3.1 `text[]` 列

初版设计用 `stream_participants` 关系表，实施时改为两处各加一个数组列：

- 成员页是热路径，`text[]` + GIN 索引可以直接过滤，不需要 join。
- 参与场次只有几十条，主表不会因为多数空值显著变宽。
- 日程行数在几十条量级，数组字段在管理端一个控件里就能编辑。

| 表 | 字段 | 说明 |
| --- | --- | --- |
| `streams` | `participants text[] not null default '{}'` | owner 之外的成员 id，顺序即展示顺序 |
| `scheduled_streams` | `participants text[] not null default '{}'` | 同上，用于未来日程 |

- 索引：`streams_participants_idx`（GIN，`participants`）。
- **数组不含 owner 自己**：`dataset_id` 仍是唯一 owner，两个来源不重叠，所以「某成员的场次」可以直接并集且天然去重。
- 成员维度查询统一用 `involvesMember(datasetId)`（`src/db/queries/streams.ts`）：

```sql
dataset_id = $1 or $1::text = any(participants)
```

### 3.2 登记来源

pack 与 YouTube 都不提供结构化的共演信息，参与者只能人工确认后登记。权威来源是仓库内的 `content/collaborations.json`：

```json
{
  "schema": "yumemita.stream-collaborations/v1",
  "streams": {
    "fvSCCUPBzU0": ["nonoka"]
  }
}
```

- key 是 videoId，value 是 owner 之外的成员 id 数组。
- `ingest` 读取后写入 `streams.participants`，按登记全量替换，所以删掉成员后重跑也会生效。
- 校验按「单条失败跳过、不阻塞其余」：非法 videoId、非数组、未知成员、owner 冲突、重复登记都只记日志。
- 文件不存在时 participant 全为空，行为与改造前一致。

标题候选匹配在 `scripts/lib/collaborations.ts` 的 `suggestParticipants`，只做提示，不自动写入。

## 4. 读取

成员维度的查询把「owner = X」扩展成「owner = X 或参与者含 X」。

| 查询 | 改动 |
| --- | --- |
| `buildStreamListQuery` / `buildStreamNavQuery` / `buildStreamSummariesQuery` | 改用 `involvesMember` |
| `selectStreamQuery`（单场页） | 按 videoId + 成员归属查找，参与者也能打开 |
| `buildStreamPackQueries` / `getStreamPacks` / `getCompareDensities` | 同上，参与者页能取到 pack |
| `buildStreamQueries`（日历） | 同上 |
| `selectDatasetsQuery` | `streamCount` 改为 owner ∪ 参与者 |
| `computeDatasetPublicTotals` | 同上，成员汇总包含参与场次 |
| `buildMemberStatsQuery` / `buildDayStatsQuery` | 保持按 owner 聚合；参与场次由 `mergeParticipantStats` / `mergeParticipantDays` 在 JS 里补 |
| 组级查询（`buildGroupGalleryQuery`、`buildRecentStreamsQuery`、`buildOnThisDayQuery`） | 不改：本来就按 videoId 唯一 |

组级合计不能由成员汇总相加：联动场会同时计入两位成员。`assembleGroupSummary` 另外输出：

- `totals`：全组全期汇总，按 videoId 去重。
- `dayTotals`：全组按日桶（已去重），组首页的近 7 天 / 本月窗口用它。

成员出勤条仍用 `days`（按成员），那本来就是「每位成员各自的出勤」。

### 4.1 DTO

- `StreamSummary` 增加可选 `datasetId`（owner）与 `participants`。
- `GroupStreamSummary` 增加可选 `ownerDatasetId` 与 `participants`。
- `CalendarEventInput` 增加 `participantIds`；`CalendarEvent` 再增加 `participantLabels`。
- `AdminScheduleItem` 增加 `participants`。

### 4.2 链接与 SEO

- 场次行的链接统一指向**频道主**：`streamPath(row.datasetId ?? datasetId, videoId)`。参与者的 URL 也能打开同一页，但站内不生成它。
- 单场页用 `summary.datasetId` 取封面与表情资源，避免在参与者目录下找不存在的对象。

## 5. UI

| 位置 | 表现 |
| --- | --- |
| 日历行 / 时间线 / 分享卡片 | 成员名写成「峰月律 · 宮永ののか」 |
| 月格 chip | 只显示时间与标题；完整成员在当天详情里 |
| 成员页场次列表 | 联动场加「联动」标记，链接指向 owner |
| 单场页 | 页头显示「峰月律 × 宮永ののか」；封面与指标仍按 owner |
| 管理端表单 | 「同场成员」多选，排除当前 owner，最多 4 人 |
| 管理端列表 | 成员列显示全部成员 |

## 6. 计数口径

- **成员维度**：联动场同时计入每位参与成员的场次数与汇总。成员页数字包含它。
- **全组维度**：按 videoId 唯一，一场只算一次。所以「全组总数 ≠ 各成员之和」。
- 组首页的 `totals.streamCount`、`totals.chatTotal`、`dayTotals` 都用去重后的数字；成员卡上的数字按成员口径。
- 会员限定场：计入场次数，不计派生指标，与改造前一致。

## 7. 验证

已执行（2026-11-12，本地库 1,917 场）：

| 检查 | 结果 |
| --- | --- |
| `bun run check` | 0 errors，479 tests passed |
| `bun run build` | 通过 |
| `bun run db:query` | failures 0 |
| `bun run db:verify --dataset ritsu` | 0 problems |
| `bun run db:verify --dataset nonoka` | 0 problems（重跑 ingest 后） |
| 单场页 `/nonoka/stream/fvSCCUPBzU0` | 200，页头显示「峰月律 × 宮永ののか」 |
| `/nonoka/streams` | 该场出现，带「联动」标记 |
| `/calendar?month=2026-07&day=2026-07-25` | 该场显示为「峰月律 · 宮永ののか」 |
| `?members=nonoka` 筛选 | 该场仍可见 |
| 管理端 POST + 未来日程 + 日历筛选 | 参与者写入并在成员筛选下可见 |

`db:verify` 在 `arale` / `miyako` 上仍报「数据库缺少该场」，是仓库已有 pack 尚未入库的既有差异，与本次改造无关。

## 8. 后续

- `content/collaborations.json` 目前只登记了示例场。批量补齐需要先用 `suggestParticipants` 出候选，人工确认后写入，再按成员重跑 `db:ingest --dataset <id>`。
- 全量回填参与者后，各成员的 `dataset_insights` 需要重算，否则成员页汇总会落后于列表。
