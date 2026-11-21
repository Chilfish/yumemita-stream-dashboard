# 官方账号场次

> 状态：🚧 POC（2026-11-21 起）。正式实现待 POC 验证后开工。
> 关联：`datasets.kind`、`streams.participants` 语义、`data update` 频道范围、`scheduled_streams`、日历、侧栏与组级口径。
> 相关文档：[data-model.md](../data/data-model.md)、[collaboration-streams.md](./collaboration-streams.md)、[live-calendar.md](./live-calendar.md)。

## 1. 问题

成员个人频道之外，官方账号也会开多人直播，例如：

| 链接 | 频道 | 性质 |
| --- | --- | --- |
| `u7f5p223ByA` | 夢限大みゅーたいぷ（`@BDP_yumemita`） | 团体官方号，整条频道都是本团内容 |
| `Eo8iRGa0neM` | バンドリちゃんねる☆（`@bang_dream_official`） | 企划母频道，只是其中部分场次有本团成员出演 |

这两个频道不能按同一种方式处理：

- 团体官方号 71 场里，标题全部是本团内容，整频道收录不会带进无关直播。
- 企划母频道 453 场里，306 集 TV LIVE 与本团相关与否只写在简介的「出演者」区块，标题里没有成员名。整频道收录会把 Roselia、MyGO 等其他乐队的节目一起拉进来。

成员频道里的联动场与本问题也不同：联动场的主场仍是某位成员的频道，指标天然属于他；官方场次的主场是团体或企划方。

### 实测（2026-11-21）

| 频道 | 直播总数 | 标题含成员名 | 标题含团名 | 备注 |
| --- | ---: | ---: | ---: | --- |
| `@BDP_yumemita` | 71 | 1 | 71 | 唯一命中成员名的是 `9b6h_hH3-Fc`（×NANIMONO） |
| `@bang_dream_official` | 453 | 0 | 2 | 306 集 TV LIVE；抽样 20 集有 14 集本团成员出演，出演信息只在简介 |

抽样结论：官方场次的参与者无法靠标题推断，只能整频道默认全员（团体号）或解析简介（母频道），其余走人工登记。

## 2. 口径决定

1. **官方场次单独计数，不并入任何成员的个人场次。** 成员页的场次数、汇总、趋势、相册、逐字稿索引都不因官方场次变化。
2. **官方场次的 `participants` 只表示在场成员，不参与成员维度聚合。** 它与成员频道联动场共用同一个字段，但语义由 owner 是否成员决定（第 3.3 节）。
3. **每日自动更新只覆盖配置里 `sync` 为 `channel` / `filtered` 的账号。** 目前是 5 位成员的频道加两个官方号。
4. **其他官方账号的场次用手动命令添加，参与者作为参数传入。** 例如某个活动只在第三方频道播一次。
5. **成员页不新增「出演的官方节目」区块。** 成员页保持现状。
6. **日历与全组相册都包含官方场次。** 两者回答的是「那天有什么直播」，不限成员个人频道；但日历按成员筛选时不带出官方场次。

这样划分的理由：成员页回答「这个人自己播了什么」，官方节目回答「团体或企划方播了什么」。两者的同接、弹幕、SC 属于不同主体，混在一起会让成员页的数字失去解释。

### 2.1 成员页 vs 组级页面

| 页面 | 含官方场次 | 说明 |
| --- | --- | --- |
| 成员页 / 成员场次列表 / 成员相册 / 成员趋势 | 否 | 只回答「这个人自己播了什么」 |
| 组首页（成员榜、出勤、联动矩阵、最近更新） | 否 | 全组口径只按成员 |
| 全组相册 `/gallery` | 是 | 一张封面墙回答「这天都有什么」；筛选数据源为成员 + 官方 |
| 全组日历 `/calendar`、今日 / 明日时间线 | 是 | 回答「什么时候有直播」，官方预告同样重要 |
| 官方账号页 `/{officialId}` | 只有它自己的 | 复用成员页模板，文案不写「成员」 |
| sitemap / llms.txt | 收录 | llms 成员段只列成员，官方账号放 `## Optional` |

## 3. 数据模型

### 3.1 `datasets.kind`

```sql
ALTER TABLE "datasets" ADD COLUMN "kind" text DEFAULT 'member' NOT NULL;
```

| `kind` | 含义 | 当前条目 |
| --- | --- | --- |
| `member` | 成员个人频道 | `nonoka` / `arale` / `ritsu` / `miyako` / `yuno` |
| `official` | 官方账号 | `yumemita` / `bangdream` / `other` |

- 默认值 `member`，所以现有 5 行不需要回填，迁移在任何时刻可执行。
- `kind` 只回答「是不是成员」，不回答「怎么抓」。抓取方式放 `data-sources.json`，见第 4 节。
- 只有两个值：一次性外部频道也归到 `official`，它和固定官方号的区别只在 `sync`。

### 3.2 `data-sources.json`

```jsonc
{
  "id": "other",
  "label": "其他联动",
  "kind": "official",
  "color": null,
  "avatar": null,
  "channelId": null,
  "manifest": "data/other/manifest.json",
  "datapackDir": "data/other",
  "subject": null,
  "scope": "其余官方账号里本团成员出演的直播；手动登记",
  "note": "聚合第三方账号的活动联动场次，参与者由手动命令指定。",
  "sync": "manual"
}
```

| 字段 | 取值 | 说明 |
| --- | --- | --- |
| `kind` | `member` / `official` | 缺省 `member` |
| `sync` | `channel` / `filtered` / `manual` | 缺省 `channel` |
| `channelId` | string / `null` | `other` 没有固定频道，可以省略 |
| `include.titlePattern` | 正则字符串 | 仅 `filtered` 使用，先按标题粗筛候选 |
| `include.descriptionCast` | boolean | 仅 `filtered` 使用，再按简介「出演者」确认成员 |

`sync` 的三种取值：

- `channel`：整频道差集同步，和现在成员频道一致。
- `filtered`：先按频道列表粗筛，再拉元信息确认；命中才进入候选。用于企划母频道。
- `manual`：`data update` 完全跳过，只能由 `data official` 手动添加。

### 3.2.1 三个官方账号

| id | 标签 | 频道 | `sync` | 内容 |
| --- | --- | --- | --- | --- |
| `yumemita` | 夢限大みゅーたいぷ | `UCxL_Vlnhfo46sN6vPHR_4hA` | `channel` | 团体官方号全部直播 |
| `bangdream` | バンドリちゃんねる☆ | `UCN-bFIdJM0gQlgX7h6LKcZA` | `filtered` | 母频道中本团成员出演的集数 |
| `other` | 其他联动 | — | `manual` | 其余第三方官方账号的联动，手动添加 |

`other` 没有固定频道，同一账号的场次可以来自任意频道。它的 `streams.dataset_id` 都是 `other`，来源频道保留在 pack 的 `video.channelId` / `channelName` 里。

### 3.3 `participants` 的语义分叉

`streams.participants` 与 `scheduled_streams.participants` 不改结构，含义按 owner 区分：

| owner | `participants` 含义 | 是否计入成员维度 |
| --- | --- | --- |
| `member` | 联动场里 guest 的其他成员 | 计入（现有行为） |
| `official` | 这场在场的成员 | 不计入，仅作展示与筛选 |

所以成员维度的查询要加一个前提：只有 **owner 是成员** 时，`participants` 才导流到成员页。

```sql
-- 现在的写法：官方场次的 participants 会被算进成员
dataset_id = $1 or $1::text = any(participants)

-- 新写法：participants 只在成员频道场次里生效
dataset_id = $1
  or (
    dataset_id in (select id from datasets where kind = 'member')
    and $1::text = any(participants)
  )
```

`selectDatasetsQuery` 的场次数使用同一规则。它的 streams 子查询需要带上 owner kind：

```sql
(select s.dataset_id, s.participants, s.source_generated_at, d.kind as owner_kind
   from streams s join datasets d on d.id = s.dataset_id) s
```

成员条件：`s.dataset_id = <id> or (s.owner_kind = 'member' and <id> = any(s.participants))`。

对官方 dataset 行，这个条件退化为 `s.dataset_id = <id>`，也就是「它自己频道的场次数」，天然正确。

### 3.4 路由与 canonical

- 官方场次的 URL 是 `/yumemita/stream/<videoId>`，owner 即官方账号。
- 参与成员的路径不打开该场：`/arale/stream/u7f5p223ByA` 返回 404。这保证一场只有一条 canonical。
- 现有代码用 `summary.datasetId`（owner）拼链接，已满足这一点，不需要额外改。

## 4. 渠道清单与同步模式

| `id` | 频道 | `kind` | `sync` | 过滤 |
| --- | --- | --- | --- | --- |
| `nonoka` … `yuno` | 5 个成员频道 | `member` | `channel` | — |
| `yumemita` | `@BDP_yumemita` | `official` | `channel` | — |
| `bangdream` | `@bang_dream_official` | `filtered` | 标题粗筛 + 简介 cast |
| `other` | 任意第三方官方账号 | `official` | `manual` | 手动命令 + 参与者参数 |

### 4.1 `filtered` 的两段过滤

1. 标题粗筛：`TV LIVE|ゆめ∞みた|Our Notes|ゆめみた|夢限大|むーたいぷ`。命中数远大于真实收录数，只是候选池。
2. 简介确认：拉 `-J` 元信息，取「出演者」区块，命中成员全名才收录。命中后写 `participants`。

成本：首次回填约 300 集需要拉元信息，但不需要弹幕 / 评论。之后每日只处理新出现的集数。

已知限制：

- 简介格式变了（「出演者」换成别的标题）会导致漏收。需要一条固定的解析失败计数，命中 0 也要上报。
- 拉取失败按「跳过 + 记录」处理，不写入「确认无成员」，下一轮重试。

### 4.2 手动添加外部频道

```bash
# 全员出演：all 展开为 5 位成员
bun run ymmt data official "https://www.youtube.com/watch?v=Jih2ArVViRo" --participants all

# 单人出演：只写参与的成员
bun run ymmt data official "https://www.youtube.com/watch?v=4l7mcDP7-ZY" --participants yuno

# /live/ 链接同样支持；先看计划不落盘
bun run ymmt data official "https://www.youtube.com/live/V2AJBNJGR8E" --participants all --dry-run

# 想按账号分开归档时，另建一个 official dataset
bun run ymmt data official <链接> --participants arale --dataset limista --no-online
```

命令做的事（`scripts/commands/data/official.ts`）：

1. 拉 yt-dlp 元信息，确认场次已结束（`is_upcoming` / `is_live` 直接拒绝），打印原频道名与 ID。
2. 解析参与者：`all` 或成员 id 列表；未知 id 报错，不做静默丢弃。
3. 确定归属：默认 `other`；`--dataset` 可指向任意 `kind=official` 的账号，指向成员频道会被拒绝。
4. 把 `videoId → participants` 写进 `content/collaborations.json`（已存在则覆盖，条目按 videoId 排序）。
5. `data fetch --ids` → 本地 ingest → 线上 ingest → verify → publish → purge。
6. `--no-online` 只改本地；`--dry-run` 只打印计划。

`participants` 是必填项：标题推断对官方场次无效（实测团体号 71 场命中 1 场，母频道 0 场）。

## 5. 数据链路改动

| 环节 | 改动 |
| --- | --- |
| `data update` | 只遍历 `sync !== 'manual'` 的账号；`filtered` 在 `planDataset` 前套用过滤；联动对账的已知成员集合排除官方账号 |
| `schedule-sync` | 使用与抓取同一套过滤，避免「预告进了日程、成片没入库」 |
| `db ingest` | 写 `datasets.kind`；官方场次照常写 streams / details，不参与成员汇总；参与者登记只接受成员 id |
| `dataset_insights` | 官方 dataset 照常算自己的 totals，不混入成员 |
| `publish` | 官方场次的封面 / archive 按自己的 dataset 前缀上传 |
| purge | 官方 ingest 后失效 `dataset-<id>` / `stream-<id>` / `schedule` / `sitemap` / `llms` / `gallery`；不失效 `group` 的成员口径 |
| 逐字稿 | 官方场次稿件放 `content/transcripts/<officialId>/`；`transcript import` 不再拒绝官方频道（后续项） |

## 6. 日历与直播预告

官方场次要进日历：团体周年、TV LIVE 出演这类场次正是「什么时候有直播」要回答的内容。但统计口径不含它。

| 位置 | 是否包含官方场次 | 说明 |
| --- | --- | --- |
| `/calendar`、`/{id}/calendar` | 包含 | 官方账号作为可筛选的一项，标签用频道名 |
| 组首页「今天 / 明天」 | 包含 | 和日历同一份数据 |
| 组首页成员榜、出勤条 | 不含 | 只按成员 |
| `/gallery` | 包含 | 封面墙回答「这天都有什么」；筛选数据源为成员 + 官方 |
| 官方账号页的相册 | 只含该账号 | `/{id}/gallery` |

日历按成员筛选时只认 `dataset_id`，不因官方场次的 `participants` 命中：官方场次的 `participants` 是「在场的成员」，不代表那场属于他们。实现上 `CalendarEvent.memberKind` 标记 owner 类型，筛选分支对 `official` 跳过参与者匹配。

自动同步必须与抓取同源：如果母频道某集在标题粗筛里进了日程，但简介还没公布出演者，它会在日历上停在「待补录」。处理方式：

- 日程同步只写 `filtered` 账号确认命中的场次；未确认的候选不写日程。
- 已经写进日程、后来确认没有成员出演的场次，按 `source='youtube'` 的过期清理规则删除。
- 手动添加的外部频道不参与自动同步；它的预告走 `/admin/schedule`。

## 7. 页面与导航

| 位置 | 改动 |
| --- | --- |
| 侧栏 | 「成员」组只列 `kind=member`；新增「官方」组，列 `kind=official` |
| 组首页 | 成员数、成员榜、联动矩阵只按成员；不放官方统计 |
| 官方账号页 | 复用成员页模板：规模指标、最近一场、场次列表、相册、日历、逐字稿 |
| `memberCount`（SEO / 页头） | 只数 `kind=member` |
| 全员对比默认成员 | 只取 `kind=member` |
| 搜索面板 | 官方账号可搜索，标「官方」 |
| sitemap | 收录官方账号页与它的单场 |
| `llms.txt` | 成员段只列成员；官方账号放 `## Optional` |
| 管理端日程表单 | 成员选择器包含官方账号，用于手动排官方预告 |

官方账号页的文案不能出现「成员」字样。规模指标按它自己的场次计算，统计口径与成员页一致。

## 8. 影响面清单

改动集中在「取成员集合」与「成员维度聚合」两类位置：

| 文件 | 改动 |
| --- | --- |
| `src/db/schema.ts` | `datasets.kind` |
| `drizzle/0012_*.sql` | 加列（默认 `member`） |
| `scripts/commands/db/ingest.ts` | 写入 `kind`；参与者登记只接受成员 id |
| `src/db/queries/datasets.ts` | 场次数带 owner kind 判断；`selectMembersQuery`；成员优先排序 |
| `src/db/queries/streams.ts` | `involvesMember` 加成员 owner 前提 |
| `src/db/queries/group.ts` | 组级查询限定成员；全组相册与「那年今日」包含官方 |
| `src/db/queries/group-compare.ts` | 对比桶只取成员场次 |
| `src/lib/group.ts` | `memberRows` / `galleryMembers` / `officialMembers` |
| `src/lib/dataset-kind.ts` | `countMembers` / `isOfficialDataset` |
| `src/lib/compare-params.ts`、`src/lib/compare.ts` | 默认成员集合过滤 |
| `src/lib/agent-llms.ts` | 成员段只列成员，官方账号放 `Optional` |
| `src/types/db.ts`、`src/types/dataset.ts`、`src/types/calendar.ts` | `kind` / `memberKind` |
| `src/components/dashboard/shell/app-sidebar.tsx` | 成员 / 官方分组 |
| `src/components/dashboard/shell/member-sheet.tsx` | 同上 |
| `src/components/dashboard/calendar/calendar-view.tsx` | 成员筛选跳过官方场次的参与者 |
| `src/components/pages/group-gallery-page.tsx` | 相册筛选数据源含官方 |
| `src/pages/*.astro` 的 `memberCount` | 取成员数 |
| `src/pages/llms.txt.ts` | 传 `kind` |
| `scripts/commands/data/update.ts` | 跳过 `sync=manual`；联动已知成员集合排除官方 |
| `scripts/commands/data/fetch.ts` | 无 `channelId` 时允许 `--ids` / `--force` |
| `scripts/commands/data/official.ts` | 手动添加命令 |
| `scripts/lib/official-stage.ts` | 参与者与归属解析（纯函数） |
| `scripts/lib/schedule-sync.ts` | 同一过滤（待 `filtered` 落地） |
| `data-sources.json` | 3 个 official 条目 |
| `content/collaborations.json` | 官方场次的参与者登记 |

`src/db/queries/group.ts` 的组级 SQL 现在按 `streams` 全表聚合。如果官方场次入库，组级 `totals`、`recent`、`gallery` 会把它算进去。POC 要在这些查询上加 `join datasets` 并限定 `kind='member'`，否则口径会漏。

## 9. POC 计划

目标：用本地库验证「官方场次入独立 dataset、不污染成员口径」是否成立，以及页面与查询是否需要更大改动。

### 9.1 步骤

1. 迁移：`datasets.kind`（默认 `member`）。
2. `src/db/schema.ts` 与 ingest 写入 `kind`。
3. 查询层：`involvesMember`、`selectDatasetsQuery`、组级查询加成员前提。
4. 本地库插入两个官方 dataset 与若干场次（真实 pack 或合成行）。
5. 页面走查：成员页数字不变；官方页出现；组级数字不变；`/arale/stream/<官方场次>` 404。
6. 按结果回写本文档。

### 9.2 验收用例

| 用例 | 操作 | 预期 |
| --- | --- | --- |
| C1 | 插入 `yumemita`（kind=official）与 3 场官方场次，`participants` 为全员 | `/nonoka` 的场次数与汇总不变 |
| C2 | 同上 | `/yumemita` 显示 3 场，指标按自身场次 |
| C3 | 访问 `/nonoka/stream/<官方场次>` | 404 |
| C4 | 组首页成员数字与「全组最近场次」 | 与改造前一致，不含官方场次 |
| C5 | `/gallery` | 不含官方场次 |
| C6 | `/calendar` 与组首页今天 / 明天 | 含官方场次，可筛到官方账号 |
| C7 | 成员频道联动场（现有数据） | 仍计入参与者，行为不变 |
| C8 | `db query` 冒烟 | 0 failures |
| C9 | `bun run check` / `bun run build` | 通过 |
| C10 | 清除 POC 数据 | 恢复原始行数与口径 |

### 9.3 POC 执行记录（2026-11-21，本地库）

实现范围：`datasets.kind` 迁移、查询层成员前提、侧栏 / 成员面板分组、全组相册与日历口径、`data official` 命令、`data update` 范围。未接 `filtered` 的简介解析。

数据：本地库插入 3 个官方 dataset（`yumemita` 3 场、`bangdream` 2 场、`other` 3 场）+ 2 条官方未来日程。场次为合成行，不涉及 pack 与对象存储。

| 组 | 用例 | 结果 |
| --- | --- | --- |
| 查询 | C0 成员数只算 member（5 成员 / 3 官方） | ✅ |
| 查询 | C1 成员场次列表不含官方场次（5 人 × 0） | ✅ |
| 查询 | C2 官方 dataset 只统计自己的场次 | ✅ |
| 查询 | C3 官方场次仅官方路径可打开，成员路径 404 | ✅ 5/5 |
| 查询 | C4 组级最近 / 最新 / 成员集合不含官方 | ✅ |
| 查询 | C5 全组相册包含官方场次 | ✅ 1952 行 / 5 条官方 |
| 查询 | C7 成员频道联动场仍计入参与者 | ✅ |
| 查询 | C8 官方场次不挂到成员名下 | ✅ |
| 查询 | 组级 `totals.streamCount` | 1944（未因官方场次变化） |
| 日程 | S1–S4 官方预定场进日历、状态 `upcoming`、标签为频道名、带来源链接 | ✅ |
| 日程 | S5 过了开播时间未入库 → `pending` | ✅ |
| 日程 | S6 今日 / 明日时间线包含官方预定场 | ✅ |
| 日程 | S7 按成员筛选不带出官方场次 | ✅ |
| 日程 | S8 按官方账号筛选能看到自己的场次 | ✅ |
| 页面 | P1 SEO 描述仍为「5 位成员」 | ✅ |
| 页面 | P4 侧栏出现「官方」分组 | ✅ |
| 页面 | P5–P6 全组相册含官方场次，筛选中官方排在成员之后 | ✅ |
| 页面 | P7–P8 日历含官方场次与官方预定 | ✅ |
| 页面 | P9 成员页不含官方场次 | ✅ |
| 页面 | P10 聚合账号页可访问且有自己的场次 | ✅ |
| 页面 | P12–P13 llms 成员段不含官方，Optional 列 3 个 | ✅ |
| 页面 | P14 sitemap 收录三个官方账号 | ✅ |
| 门禁 | `bunx tsc --noEmit`（src 无错误） | ✅ |
| 门禁 | `vitest run` | ✅ 557 passed（新增 9 条） |
| 门禁 | `bun run build` | ✅ |

POC 中发现并修掉的问题：

1. **官方 dataset 没有 `dataset_insights` 行时页面报错。** 成员页模板在 `totals` 为 null 时不挂 Provider，`useDatasetView` 抛错。正式实现必须让 ingest 为官方 dataset 生成 insights。
2. **`llms.txt` 把官方账号列进成员段。** 调用方没传 `kind`；已补。
3. **SEO / 页头人数把官方账号算进去。** 抽出 `countMembers()` 统一。
4. **相册筛选按 id 排序，官方账号夹在成员之间。** 改成 `kind` 优先、再按 id。
5. **日历按成员筛选会带出官方场次。** 官方场次的 `participants` 被当成联动；改为 `memberKind === 'official'` 时跳过参与者匹配。
6. **`data fetch` 强制要求 `channelId`。** `other` 没有固定频道；改为只在需要拉频道列表时要求。

遗留：

- `filtered` 的简介「出演者」解析尚未实现，`bangdream` 的自动同步还不可用。
- 官方 dataset 的 insights 目前靠手工补行；正式实现要并进 ingest。
- 全组相册包含官方场次后，页头「N 场」仍是成员口径，与实际渲染行数不同；正式实现需要决定是否在页头注明。

## 10. 验收标准

| ID | 描述 | 验收 |
| --- | --- | --- |
| `FR-OFFICIAL-001` | 官方场次独立归属 | 官方场次 owner 为官方 dataset；成员页场次数与汇总不因官方场次变化（C1） |
| `FR-OFFICIAL-002` | 成员页不并入官方场次 | 成员列表、相册、趋势、逐字稿索引均不含官方场次（C1） |
| `FR-OFFICIAL-003` | 官方账号有独立页面 | `/{officialId}` 及其场次列表、单场、相册可访问（C2） |
| `FR-OFFICIAL-004` | 单一 canonical | 官方场次只从官方账号路径打开，成员路径 404（C3） |
| `FR-OFFICIAL-005` | 组级成员口径不变 | 组首页成员榜、出勤、联动矩阵、最近更新不含官方场次（C4） |
| `FR-OFFICIAL-006` | 日历与全组相册包含官方场次 | `/calendar`、今日 / 明日时间线、`/gallery` 显示官方场次；日历按成员筛选不带出官方（C5/C6/S7） |
| `FR-OFFICIAL-007` | 每日只同步配置账号 | `data update` 跳过 `sync=manual`；`filtered` 按标题 + cast 过滤（脚本测试） |
| `FR-OFFICIAL-008` | 手动添加外部场次 | `data official <url> --participants` 完成登记、落库与发布；未知成员与成员频道报错（单测 + 脚本） |
| `FR-OFFICIAL-009` | 日程与抓取同源 | 未确认出演的候选不写日程；确认无出演的自动日程会被清理（S1–S5） |
| `FR-OFFICIAL-010` | 现有联动场不受影响 | 成员频道联动场仍计入参与者（C7） |
| `FR-OFFICIAL-011` | 官方 dataset 有汇总 | 官方账号页正常渲染，不因缺 `dataset_insights` 报错（P10） |

## 11. 风险

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 组级 SQL 漏加成员前提 | 全组数字被官方场次抬高 | POC 用真实数据对账前后总数 |
| 简介格式变化 | 母频道漏收 | 固定解析失败计数；命中 0 也上报 |
| 首次回填 300 集元信息 | 一次性耗时 | 只拉元信息，不拉弹幕；分批执行 |
| 官方 dataset 混入对比 / 矩阵 | 出现无意义组合 | 所有成员集合入口统一过滤 |
| 一次外部频道只 1 场 | 页面内容偏少 | 接受；官方页有场次即成立 |
| 手动命令写 `data-sources.json` | 配置文件格式漂移 | 确定性重写，2 空格缩进；打印 diff；可 `--dry-run` |
| 已有 `scheduled_streams` 混入母频道无关场次 | 日历噪声 | 按第 6 节清理规则处理 |

## 12. 后续（不在 POC）

- 官方场次逐字稿导入（`content/transcripts/<officialId>/`）。
- 官方账号频道头像。
- 母频道 cast 解析的单元测试与失败上报。
- 外部频道的 CSV 批量登记。
