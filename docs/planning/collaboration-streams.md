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

### 回填验证（2026-11-14，本地库）

| 检查 | 结果 |
| --- | --- |
| `bun run db:query` | failures 0 |
| `bun run db:verify --dataset <成员>`（5 人） | 0 problems |
| `bun run check` / `bun run build` / `bun run validate:data` | 通过 |
| `/nonoka/streams`、`/yuno/streams` | 联动标记按预期出现 |
| `/calendar?month=2024-06&day=2024-06-11` | 显示「宮永ののか · 峰月律 · 千石ユノ」 |
| 单场页 `/arale/stream/It1RXfOPVYU` | 页头「仲町あられ × 宮永ののか × 峰月律」 |
| 成员页场次数（owner ∪ 参与者） | 2026-11-14 回填后：arale 533 / nonoka 322 / miyako 337 / ritsu 355 / yuno 468（随后仍会随新场次变化） |

## 8. 回填与后续

`content/collaborations.json` 已回填（2026-11-14，80 场）：

- 候选来自 `scripts/suggest-collaborations.ts`：扫本地 manifest 标题里的成员别名与组合名 tag，输出候选表，不改数据。
- 第二轮回填补了组合名 tag：标题只写「ユノりつ」「ののユノ」这类组合名的场次，成员全名别名命中不到。10 对 tag 同时写进 `scripts/lib/collaborations.ts` 的 `PAIR_TAGS`，以后再扫会自动带上。
- 标题与 tag 都没写的场次用 X 确认，例如 [ritsu 2023-11-30](https://x.com/ritsu_yumemita/status/1730214221089300875) 的 `#りつみやコラボ` 对应本地 `atfD1eiEa_o`（おえかきの森）。
- 标题漏掉参与的场次按描述里的「コラボ相手」补齐；画あられ/律的绘回、同时视听、只是提到成员名字的场次不计入。「同時視聴」是两人各自看同一场录播，不共用直播间。
- 写入后按成员跑 `db:ingest --dataset <id> --ids <文件> --force`，再用 `scripts/refresh-public-totals.ts` 统一重算 `public_totals`。分批 ingest 时先跑的成员看不到后写入的参与者，必须最后统一 refresh。
- 已部署环境不重跑 ingest：`bun scripts/apply-collaborations.ts` 先补迁移，再按 videoId 定向写 `streams.participants` 并刷新 `public_totals`；`--dry-run` 会列出库里缺失的场次。见 [adding-data.md](../data/adding-data.md#联动参与者补到已部署环境)。
- 新发现的联动场继续走同一流程；同名同日两段配信（如 2026-07-12 两场「コラボ歌枠」）按两个 videoId 各算一场。

| 成员对 | 组合名 / tag |
| --- | --- |
| 仲町あられ × 宮永ののか | ふわキラゆめみ隊、ふわキラ |
| 仲町あられ × 峰月律 | りつとあられ |
| 仲町あられ × 藤都子 | 健全シスターズ |
| 仲町あられ × 千石ユノ | 甘辛豆腐メンタル、あらユノ |
| 宮永ののか × 峰月律 | ぎたーグミ、ギターぐみ |
| 宮永ののか × 藤都子 | ミルミルグッズ化推進委員会、ののかみやこ、ののみや |
| 宮永ののか × 千石ユノ | ののゆの、ののユノ |
| 峰月律 × 藤都子 | りつみやコラボ |
| 峰月律 × 千石ユノ | ユノ食べろ律食べるな、ユノりつ |
| 藤都子 × 千石ユノ | 納期シスターズ |

联动关系视图的前置条件已满足。

## 9. 联动关系视图

状态：✅ 已落地（2026-11-14）。前置条件已满足（`content/collaborations.json` 已回填）。

### 9.1 问题

回答「这个人常和谁一起播」「我和谁合作最多」。这是双向的：看某位成员时关心他与其他人的次数，看全组时关心哪几对最频繁。

### 9.2 不用节点连线图

成员只有 5 个，两两组合 10 对，而实际数据里 10 对都存在。力导向布局会排成正五边形，拓扑上没有任何结构可读；节点大小编码次数在 N=5 时面积差异无法分辨。图能提供的信息量只有边的粗细，用表格表达更准确，也不用引入图形库和交互。

节点图适合 N 在几十以上的场景（backlog B5 的观众重叠就是），不适合 5 位成员。

### 9.3 用矩阵

组级视图用 5×5 矩阵：行读本人，列读对方，单元格填同场次数并用背景深浅编码。对称矩阵只填一半也有信息，但全填更便于按行或按列扫。

成员页用面板而不复制整张矩阵：列出「对方 · 同场次数 · 最近一次 · 占本人场次比例」，按次数降序，最多 4 行（成员总数减一）。

排序与呈现规则：

- 主数字是同场次数，单一口径，不在同一格塞第二个数字。
- 颜色只做深浅编码，具体数值始终以文字写出，灰度与色弱下可读。
- 0 次的组合不画成空格，显式写 `—`，与「无数据」区分。

### 9.4 口径

**单元格 = 这两人同场出现过的场次数，包含三人以上的场次。**

- 三人场 `A × B × C` 拆成 A-B、A-C、B-C 三对各 +1。主视图只给这一个数字，避免「双人 12 次」和「同场 15 次」两种口径同时出现、互相矛盾。
- 需要区分时走明细：点开某一对，列出这些场次并标出每场是几人场。主矩阵不承担这个区分。
- 对称量：A 与 B 的同场次数等于 B 与 A 的同场次数，不存在方向性。
- 会员限定场计入次数：它的标题与时间本来公开，和成员场次数的口径一致；不展示该场的派生指标。
- 数字是「同场」，不是「互动强度」。数据里只有同场信息，文档与界面都按同场表述。

### 9.5 数据来源

不新增派生文件，请求期直接查库：

1. 取 `participants` 非空的场次（规模在几十条量级），只读 `dataset_id` / `participants` / `started_at` / `video_id` / `availability`。
2. 在 JS 里把每场的成员集合 `{owner} ∪ participants` 展开成两两组合并累加。
3. 成员页面板直接从同一份结果里筛出该成员那一行。

不为了 10 个格子做 SQL 侧的组合生成，也不把结果写进 `dataset_insights`：数据量小，缓存走页面 tag 即可。

### 9.6 验收标准

- 成员页显示联动面板，按次数降序，0 次显示 `—`，不出现重复行。
- 组级矩阵只出现有场次的成员对，数字等于按 videoId 去重的同场次数。
- 三人场在 3 个格子里各计 1 次，点开任一对能看到原始场次并标出人数。
- 390 / 320px 仍保留矩阵：列宽压到约 40px，列头换行、首列吸顶；页面不横向溢出。
- 只有 1 场登记时页面给出空态说明，不显示误导性的满格矩阵。

### 9.7 实现（2026-11-14）

| 位置 | 内容 |
| --- | --- |
| `src/lib/collaboration.ts` | `buildCollaborationPairs` 把每场展开成两两组合；`collaborationPartners` 补 0 次组合、按次数排序 |
| `src/db/queries/group.ts` | `buildCollaborationStreamsQuery`：只取 `participants` 非空的场次，会员限定场也计入 |
| `src/components/dashboard/group/group-collaboration-matrix.tsx` | 组首页矩阵：左侧紧凑表格、右侧当前组合的场次；窄屏保留表格，只压列宽与字号 |
| `src/components/dashboard/home/home-co-members.tsx` | 成员页「同场成员」：对方 · 同场次数 · 最近一次 · 占本人场次比例；0 次写 `—` |

- 成员页直接用已有的 `rows`（已包含参与场次）在客户端聚合，不新增请求；组首页多一条窄查询，只传 `videoId / owner / participants / date / title`。
- 矩阵颜色只用 `foreground` 透明度做深浅编码（最深 12%），数值始终写出来；行/列十字高亮，点击任一格在右侧（窄屏在下方）显示明细。
- 桌面左侧矩阵约 440px、右侧明细；窄屏矩阵压到 320px 内，列头换行，首列吸顶，页面不横向溢出。
- 组首页顺序：今日计划 → 全组主视觉 → 那年今日 → 成员榜与出勤 → 联动关系。

验证（2026-11-14，本地库）：

- `bun run check`：0 errors，487 tests passed（新增 `collaboration.test.ts` 9 条）。
- `bun run build`：通过。
- `bun run db:query`：failures 0。
- 组首页矩阵数字与 SQL 聚合一致：arale×nonoka 27、nonoka×yuno 14、arale×yuno 12、nonoka×ritsu 12、arale×miyako 11、ritsu×yuno 10、arale×ritsu 7、miyako×nonoka 4、miyako×yuno 3、miyako×ritsu 1，10 对全部有数据。
- 点击「仲町あられ × 宮永ののか」展开 27 场明细，三人场标「3 人」。
- 390 / 320px 保留表格：320px 下表格收进 320px，无横向溢出；成员页无溢出。

