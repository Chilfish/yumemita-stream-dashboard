# 直播日历需求与方案

> 状态：✅ 读取、月历 / 议程、自动同步、缓存、管理端写入与读取时关联已落地（2026-11-07）。ICS 暂缓。
> 手工日程改由 `/admin/schedule` 与 `/api/admin/schedule` 维护，接口说明见 [schedule-admin.md](../engineering/schedule-admin.md)。
> 目标：在现有只读归档站上增加一层「未来日程」，让访客知道接下来谁什么时候播；开播后由每日任务照常入库，日历自动从「预定」变成「已结束」。
> 关联需求：`FR-CAL-001` – `FR-CAL-012`，backlog `B14`。表结构与字段口径见 [data-model.md](../data/data-model.md) §9。

## 目录

1. 结论
2. 目标与非目标
3. 用户问题与场景
4. 功能需求与验收标准
5. 数据模型
6. 数据维护
7. UI 设计
8. 路由与导航
9. 缓存与失效
10. 实施阶段
11. 测试计划
12. 风险与待决
13. 参考

## 1. 结论

- **未来场次单独建表 `scheduled_streams`，不写 `streams`。** `streams` 在现有链路里被当作「已结束场次」使用：列表排序、最新一场、日历热力图、月度曲线、相册、组级 SQL 聚合、sitemap 都默认这一点。插入未开播的占位行会污染这些读取方，而 `db:verify` 只做「本地 pack ∩ 数据库」，查不出多出来的行。
- **开播后不反向改日程表。** 每日任务仍走原有 `newIds → ingest → streams`。日历在读取时用 `(dataset_id, video_id)` 关联两边，命中 `streams` 就显示「已结束」并链到单场页。状态不落库，避免出现永远停在 `scheduled` 的列。
- **两个薄页面共用一个视图。** 全组 `/calendar` 与成员 `/{datasetId}/calendar`，与现有 `/gallery` 和 `/{id}/gallery` 的结构一致。查询层只加一个轻量模块，不复用 `getDatasetPageData`。
- **月网格自绘，不用 `ui/calendar.tsx` 的 DayPicker。** DayPicker 的日期单元格是选择控件，不适合承载多事件布局、状态标记和随内容长高的格子；现有 `calendar-heatmap.tsx` 已经有一套日期计算方式，可以沿用。
- **命名分清两件事。** 成员首页现有的「更新日历」是历史热力图，建议改叫「开播热力图」；「日历」专指本方案的新页面。

### 当前实现（2026-11-04）

| 层 | 文件 | 状态 |
| --- | --- | --- |
| schema | `src/db/schema.ts`、`drizzle/0002_public_polaris.sql` | `scheduled_streams` 已建表 |
| 纯逻辑 | `src/lib/calendar.ts`、`src/lib/calendar-labels.ts` | 状态派生、月网格、URL 参数；16 + 5 条单测 |
| 查询 | `src/db/queries/calendar.ts` | 一次查 `streams` 与 `scheduled_streams`，不读 pack |
| 页面 | `src/pages/calendar.astro`、`src/pages/[datasetId]/calendar.astro` | 全组 / 成员两个入口 |
| 视图 | `src/components/dashboard/calendar/calendar-view.tsx`、`month-grid.tsx`、`agenda-list.tsx`、`calendar-event-row.tsx` | 月历 / 议程、当天 `Popover`、成员筛选 |
| 自动同步 | `scripts/lib/schedule-sync.ts`、`scripts/daily-update.ts` | `is_upcoming` 写日程，`is_live` 更新标记；planner 有单测 |
| 缓存 | `astro.config.mjs`、`scripts/purge-cache.ts` | `schedule` tag 与 routeRules |
| 管理端 | `src/pages/admin/schedule.astro`、`src/pages/api/admin/schedule.ts`、`src/lib/admin-auth.ts`、`src/middleware.ts` | 内部编辑页 + Basic / Cookie 鉴权 |
| 手工关联 | `src/lib/calendar.ts` 的 `matchSchedulesToStreams` | 按成员 + JST 日期 + 时段匹配真实场次 |
| 今日计划 | `getDayPlan` / `buildDayPlanFromRows`、`calendar/day-timeline.tsx` | 今天 + 明天，组首页与日历页 |
| 分享卡片 | `src/components/dashboard/calendar/share-card.tsx`、`share-button.tsx`、`public/share/bg_member_list.webp` | React + Tailwind 渲染，modern-screenshot 导出 PNG；设计见 [share-card.md](../archive/share-card.md) |
| 暂缓 | `FR-CAL-009` ICS | 订阅未做 |

与初版设计的偏差：

- 月格按用户要求列出当天全部场次，不使用 `+N` 折叠；格子随内容长高。
- 当天详情统一用 `Popover`，没有单独实现 `Drawer`。
- 悬停用原生 `title`，没有接 `PreviewCard`。
- 验证：`bun run check` 320 条测试通过、`bun run db:query` 0 failures、`bun run build` 通过；自动同步未在真实频道跑过，标「未验证」。

## 2. 目标与非目标

### 目标

- 访客在一个页面里回答三件事：今晚有没有人播、这周还有几场、某一天谁播了什么。
- 成员有一周到一个月的安排时，可以手写一份 JSON 入库，页面立即可见，不需要重新构建。
- 每日任务把频道列表里的未来场同步进日程表；开播结束后，日历自动显示为已结束，不需要人工改状态。
- 会员限定场次照常显示标题与时间，不显示派生指标。
- 日历、场次列表、单场页、组首页、搜索面板之间可以互相跳转。
- 桌面和移动端都能用，移动端默认给议程列表，不压缩月网格。

### 非目标

- 不做日视图、周视图、时间网格、拖拽改期。
- 不做用户订阅、提醒、推送、登录。
- 不做自然语言录入；手工维护走仓库里的 JSON 文件。
- 不在日历里展示未来场次的预测指标。
- 不在日历里直接播放或嵌入 YouTube。
- 不做实时直播中弹幕；直播状态只做展示。

## 3. 用户问题与场景

| 场景 | 用户问题 | 页面回答 |
| --- | --- | --- |
| 打开站点 | 最近谁播了？ | 组首页已有；日历补充今天 / 明天 |
| 今晚 | 今晚有人播吗？几点？ | 今天与明天时间线 + 当天高亮 |
| 明早 | 明天早上有朝活吗？ | 时间线的「明天」组 |
| 这周 | 这周还有几场？ | 月网格与议程视图 |
| 下个月 | 下个月有活动吗？ | 月份切换；手工填写的远期安排 |
| 某天没播 | 那天为什么空着？ | 空格即没有安排，不额外解释 |
| 开播后 | 昨天那场去哪看？ | 日历事件链到单场页 |
| 维护者 | 新安排怎么加？ | 打开 `/admin/schedule`，或调用 `/api/admin/schedule` |

## 4. 功能需求与验收标准

| FR ID | 优先级 | 描述 | 验收标准 | 状态 |
| --- | --- | --- | --- | --- |
| `FR-CAL-001` | P1 | 提供全组与成员日历页 | `AC-CAL-001`：`/calendar` 与 `/{datasetId}/calendar` 返回 200；侧栏、面包屑、移动端导航与现有页面一致；`?month=` / `?day=` / `?members=` / `?view=` 可分享、刷新与前进后退保持状态 | ✅ |
| `FR-CAL-002` | P1 | 展示未来场次与状态 | `AC-CAL-002`：未来场次来自 `scheduled_streams`；状态按 `now` 派生为预定 / 直播中 / 已结束 / 已取消 / 待补录；同 `video_id` 命中 `streams` 时显示已结束并链到单场页；不往 `streams` 写占位行 | ✅ |
| `FR-CAL-003` | P1 | 手工维护日程 | `AC-CAL-003`：`/admin/schedule` 与 `/api/admin/schedule` 可新增 / 编辑 / 取消 / 删除手工日程；重复提交同一自然键幂等；非法输入返回 400 与字段名 | ✅ |
| `FR-CAL-010` | P1 | 管理端鉴权 | `AC-CAL-010`：页面与接口未认证返回 401；页面用 Basic 登录后由 HttpOnly Cookie 维持；Agent 可直接带 Basic 头；写操作带 `Origin` 时校验同源 | ✅ |
| `FR-CAL-011` | P1 | 今日直播计划 | `AC-CAL-011`：组首页与日历页显示今天（JST）全部日程 / 场次；状态每 60 秒重算；空态说明「今天还没有排播」 | ✅ |
| `FR-CAL-013` | P2 | 日程分享卡片 | `AC-CAL-013`：时间线右上角有低调的分享按钮；用 React + Tailwind 渲染独立卡片并由 modern-screenshot 导出 PNG，使用官方背景、成员头像与类型图标；可下载、复制（手工 + 导出） | ✅ |
| `FR-CAL-012` | P1 | 手工日程与真实场次关联 | `AC-CAL-012`：读取时按成员 + JST 日期 + 时段匹配；跨午夜晚场归一；同日同时段取时间最近；命中后隐藏手工行并链到单场页；无匹配保持「待补录」 | ✅ |
| `FR-CAL-004` | P1 | 每日任务自动同步未来场 | `AC-CAL-004`：`daily-update` 读取频道列表后，把 `is_upcoming` 且能确定时间的场次 upsert 为 `source='youtube'`；同一轮重跑幂等；同步后 purge `schedule` tag | 🚧 已接入；未在真实频道跑过 |
| `FR-CAL-005` | P1 | 月历视图与议程视图 | `AC-CAL-005`：桌面默认月网格，列出当天全部场次，格子随内容长高；移动端默认议程列表；`view` 显式写入时固定；今天、选中日、非本月日期有明确区分 | ✅ |
| `FR-CAL-006` | P1 | 会员限定日程展示 | `AC-CAL-006`：会限场次显示标题、时间、成员与锁标记；不显示任何派生指标；锁标记有可访问名称；日历页不因 `?key=` 改变缓存策略 | ✅ |
| `FR-CAL-007` | P2 | 与现有页面联动 | `AC-CAL-007`：组首页显示「本周还有 N 场」并可跳到 `/calendar`；成员首页与成员场次页有「接下来」入口；单场页的相邻场次可以指向未来场（可选）；搜索面板可搜到日历页 | 🚧 侧栏与搜索面板已接；首页 / 场次页入口待做 |
| `FR-CAL-008` | P1 | 缓存与失效 | `AC-CAL-008`：`routeRules` 为两个日历路由设置 `maxAge: 60, swr: 300`；tag 为 `group` / `dataset-<id>` + `schedule`；`schedule:sync` 与 `daily-update` 完成后 purge；旧内容最多保留 60 秒 | ✅ |
| `FR-CAL-009` | P3 | ICS 订阅 | `AC-CAL-009`：`/calendar.ics` 与 `/{datasetId}/calendar.ics` 返回 `text/calendar`；只含未来 90 天、未取消的事件；会限事件标题前缀 `[会限]`；时区为 UTC 时间 | 📋 |

## 5. 数据模型

### 5.1 新表 `scheduled_streams`

```ts
// src/db/schema.ts（计划新增）
export const scheduledStreams = pgTable(
  "scheduled_streams",
  {
    datasetId: text("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    eventKey: text("event_key").notNull(),
    videoId: text("video_id"),
    title: text("title").notNull(),
    url: text("url"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    expectedMinutes: integer("expected_minutes"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    availability: text("availability"),
    source: text("source").notNull().default("manual"),
    note: text("note"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    lastLiveAt: timestamp("last_live_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  table => [
    primaryKey({ columns: [table.datasetId, table.eventKey] }),
    uniqueIndex("scheduled_streams_video_unique")
      .on(table.datasetId, table.videoId)
      .where(sql`${table.videoId} is not null`),
    index("scheduled_streams_at_idx").on(table.scheduledAt),
  ],
);
```

| 字段 | 说明 |
| --- | --- |
| `dataset_id` | 成员，等于一个 dataset |
| `event_key` | `yt:<videoId>` 或 `manual:<id>`。有 `videoId` 时一律用前者，避免手工行与自动行重复 |
| `video_id` | 可空；未定或纯手工时为空 |
| `title` | 标题；管理端可省略，空字符串表示「待定」；自动来源取频道列表 |
| `url` | YouTube 链接，可空 |
| `scheduled_at` | 预定开播时刻，可空；为空时进「日期待定」 |
| `expected_minutes` | 预计时长，用于计算「直播中」窗口 |
| `cancelled_at` | 取消标记；非空即已取消 |
| `availability` | `public` / `subscriber_only`，与 `streams` 同口径 |
| `source` | `youtube` / `manual` |
| `note` | 备注，例如联动、延期 |
| `last_seen_at` | 最近一次在频道列表里看到的时刻，用于清理自动行 |
| `last_live_at` | 最近一次频道检查报告 `is_live` 的时刻，用于派生直播中 |

索引与约束：

- 主键 `(dataset_id, event_key)` 是同步脚本的幂等冲突键。
- `(dataset_id, video_id)` 的部分唯一索引防止手工行与自动行同时挂同一个视频。
- `scheduled_at` 单列索引服务月份范围查询。
- 不建 `date` 列。日期由 `scheduled_at` 按 JST 派生，避免两个日期字段漂移。

### 5.2 状态派生

状态在读取时计算，不落库。判定顺序从高到低：

| 顺序 | 条件 | 状态 | 说明 |
| --- | --- | --- | --- |
| 1 | `cancelled_at` 非空 | `cancelled` | 取消优先于一切 |
| 2 | 存在同 `(dataset_id, video_id)` 的 `streams` 行 | `done` | 已入库，链到单场页 |
| 3 | `last_live_at` 在 24 小时内 | `live` | 频道检查报告过 `is_live`；见 6.3 |
| 4 | `scheduled_at` 为空 | `undated` | 日期待定，不进月网格 |
| 5 | `now` 在 `[scheduled_at - 15 分钟, scheduled_at + 窗口]` 内 | `live` | 窗口 = `expected_minutes` 或 180 分钟，加 120 分钟宽限，上限 12 小时 |
| 6 | `now < scheduled_at` | `upcoming` | 预定 |
| 7 | 其余 | `pending` | 已过预定时间但没有入库，显示「待补录」 |

```ts
export type CalendarEventState =
  | "done"
  | "live"
  | "upcoming"
  | "cancelled"
  | "pending"
  | "undated";
```

`pending` 保留在页面上，让维护者看到「这场应该结束但还没入库」；直接隐藏会让排期看起来消失了。

### 5.3 DTO

```ts
export interface CalendarEventInput {
  key: string;                 // stream:<videoId> | schedule:<eventKey>
  datasetId: string;
  videoId: string | null;
  title: string;
  at: string | null;           // ISO，JST 派生
  endAt: string | null;        // 已结束场次
  expectedMinutes: number | null;
  cancelled: boolean;
  hasStream: boolean;          // 服务端判定
  lastLiveAt: string | null;   // 最近一次频道检查报告 is_live 的时刻
  memberOnly: boolean;
  source: "youtube" | "manual" | "stream";
  href: string | null;         // done 时指向单场页
}

export interface CalendarEvent extends CalendarEventInput {
  state: CalendarEventState;
  memberLabel: string;
  color: string;
}
```

`state` 由 `deriveCalendarEventState(event, now)` 计算。服务端渲染时算一次，客户端切换月份时用同一个纯函数重算，因此长时间停留的页面不会一直显示「直播中」。

### 5.4 查询

```ts
// src/db/queries/calendar.ts（计划新增）
export async function getCalendarEvents(
  db: Database,
  options: { from: string; to: string; datasetId?: string },
): Promise<CalendarEventInput[]>;
```

- `streams`：按 `date` 范围过滤，走 `(dataset_id, date desc)` 索引；取 `video_id`、`title`、`started_at`、`ended_at`、`duration_sec`、`availability`。`started_at` 为空时用 `date` 当天 00:00 JST 兜底；两者都为空的场次跳过，并在 `db:query` 冒烟里记录数量。
- `scheduled_streams`：按 `scheduled_at` 范围过滤，额外带上 `scheduled_at is null` 的行。
- `datasets`：单独取 5 行，在 JS 里按 `dataset_id` 映射标签与颜色。
- 一次页面两条主查询加一条成员查询，不读 pack，不碰 `dataset_insights`。
- 返回原始输入，合并与状态计算放在 `src/lib/calendar.ts`，便于单测。

查询预算：

| 页面 | 查询数 | 数据量 |
| --- | --- | --- |
| `/calendar` | 3 | 10 个月窗口内全部成员，约 300–800 行 |
| `/{id}/calendar` | 3 | 同窗口，约 60–160 行 |

### 5.5 与 `streams` 的关系

```text
/admin/schedule 或 API ──┐
                         ├─→ scheduled_streams（未来、预定、取消）
daily-update 频道列表 ───┘         │
                                   │ 读取时按 dataset + JST 日期 + 时段匹配
                                   ▼
                          日历状态：upcoming / live / pending
                                   │
开播结束 → daily-update → ingest ─→ streams（已结束）
                                   │
                                   ▼
                          日历状态：done，链到单场页
```

两条链路互不写入。`scheduled_streams` 只服务日历，不参与列表、聚合、相册、sitemap。
关联只发生在读取时，不写回 `video_id`。

## 6. 数据维护

### 6.1 管理端

维护者通过 `/admin/schedule` 或 `/api/admin/schedule` 写手工日程，不经过仓库文件。

- 页面只从 `/about` 链接，带 `noindex`，不进 sitemap。
- 页面用 HTTP Basic 登录，成功后由 HttpOnly Cookie 维持；Agent 直接带 Basic 头调接口。
- 字段、幂等规则、错误码与示例见 [schedule-admin.md](../engineering/schedule-admin.md)。

只填日期 + 时段时写 `date` 与 `slot`；知道精确时间时写 `scheduledAt`，服务端派生 `date` 与 `slot`。
保存成功后自动失效 `schedule` / `group` / `dataset-<id>` 缓存。

### 6.2 手工行与真实场次的关联

手工行默认 `video_id = null`。开播结束、`daily-update` 把回放 ingest 进 `streams` 后，
日历读取时由 `matchSchedulesToStreams` 按下列规则匹配：

1. 同一成员、同一 JST 日期、同一时段；
2. 同日同时段有多场时取开播时间最近的一场；
3. `late` 跨午夜，23:30 与次日 00:30 视为同一晚；
4. `stream` 优先于 `youtube`，`youtube` 优先于 `manual`；
5. 已取消的日程不参与匹配；
6. 匹配不到时保留手工行，状态为「待补录」。

命中后手工行不再显示，日历直接展示真实场次的标题、时长与单场链接。
关联只发生在读取时，不写回数据库，因此没有主键冲突，也不需要迁移后的回填任务。

### 6.3 每日任务自动同步

在 `scripts/daily-update.ts` 的 `readChannelEntries()` 之后、`planDataset()` 之前加一步：

```ts
await syncScheduleFromChannel(db, datasetId, entries);
```

- 输入：`entries` 里的 `id / title / durationSec / liveStatus`，以及能拿到的 `release_timestamp`。
- `is_upcoming` 且有确定时间 → upsert `yt:<videoId>`，`source='youtube'`，`scheduled_at` 取时间。
- `is_upcoming` 但没有确定时间 → upsert，`scheduled_at = null`，进「日期待定」。
- `is_live` → 更新 `last_seen_at` 与 `last_live_at = now()`；不新建行（如果之前没有排期，这场会在结束后由 ingest 进 `streams`）。
- 每次同步更新 `last_seen_at = now()`。
- 精确到分钟的开播时间可以复用 `scripts/lib/innertube-live.ts` 的 `scheduledStart`，拿不到就用频道列表的时间。
- 结束时把 `schedule` 加进本次 purge tag；安静日没有未来场变化时不 purge。

已知限制：

- `yt-dlp --flat-playlist` 有时只给日期不给时刻。这类行进「日期待定」，由手工文件补精确时间。
- 每日任务一天跑一次，`live` 状态可能滞后。页面在客户端用 `now` 重算，缓解一部分。

### 6.4 状态收敛

```text
T-7d   手工或自动写入 scheduled_streams
T-0    scheduled_at 到达，页面派生 live
T+2h   预计结束；若仍未入库，派生 pending（待补录）
T+1d   daily-update 抓到回放 → ingest → streams
T+1d   日历读取时命中 streams → done，链到单场页
```

没有任何一步需要「把状态字段改掉」。`pending` 最多保留到下一轮 `schedule:sync --prune`。

### 6.5 CI

新增 `.github/workflows/schedule.yml`：

- 触发：`push` 命中 `content/schedule/**`、`workflow_dispatch`。
- 步骤：安装 Bun → `bun install --frozen-lockfile` → `bun run schedule:check` → `bun run schedule:sync` → 调 purge 端点（`schedule`）。
- 不安装 yt-dlp、不跑抓取，几十秒内完成。
- 每日 `data.yml` 里在 `daily-update` 前也跑一次 `schedule:sync`，处理自动同步失败或手工文件漏同步的情况。
- 失败开 issue 的规则沿用 `data.yml`。

## 7. UI 设计

### 7.1 设计原则

按 Apple 公开的三条原则推演：清晰（Clarity）、让内容优先（Deference）、层次（Depth）。落到这个页面：

1. **先回答，再浏览。** 页面顶部先给今天 + 明天的具体场次（跨天朝活也在内），月网格负责探索。不让用户先读一整个月才知道今晚有没有播。
2. **内容优先，减少容器。** 事件用「色条 + 时间 + 标题」，不套卡片、不加阴影。网格线用 hairline，靠留白和字重分层。
3. **渐进披露。** 月 → 日 → 事件详情。月格直接列出当天全部场次；点日期展开带完整标题与链接的列表。
4. **窄屏换排布。** 1024px 以下直接换成议程列表，不压缩月网格。桌面月网格与移动议程是同一份数据的两种排布。
5. **状态用形状和文字，不只靠颜色。** 实心 = 已结束，空心 = 预定，呼吸点 = 直播中，删除线 = 已取消。色弱和灰度打印下仍然可读。
6. **成员色只做细色条。** 不用成员色当文字色或整块背景。标题保持前景色，保证对比度。
7. **时间优先于标题。** chip 里先放 `20:00`，再放标题；生日、活动这类信息不抢时间的位置。
8. **今天安静但可达。** 今天的日期数字加一个圆形底，不给整格上色；「今天」按钮始终在工具栏。
9. **空是信息。** 没有安排的日期保留空白格子，不用「暂无数据」占位；整月为空时只在页脚说明。
10. **可访问性是硬性约束。** 触控目标不小于 44×44，事件有完整可访问名称，动画尊重 `prefers-reduced-motion`。

### 7.2 同类产品对照

| 产品 | 月视图的处理 | 可借鉴 | 不照搬 |
| --- | --- | --- | --- |
| Apple Calendar | 月份大标题、事件条、今日圆点；点日期展开当天列表；移动端月视图只留圆点 | 少边框、点按展开、今天的位置固定、月份翻页有连续性 | 不做日 / 周 / 年视图，不做拖拽改期 |
| Google Calendar | chip + `+N more` 弹层；多日历颜色开关 | `+N` 折叠、跨天条、颜色作为身份 | 不做多日历图层开关 |
| Notion Calendar / Cron | 键盘优先、密度克制、时区清楚 | `←/→` 切月、紧凑排版、时区说明 | 不做时间网格与拖拽 |
| Fantastical | 列表与日历并重，强调「接下来」 | 议程视图作为主视图之一 | 不做自然语言录入 |
| Linear | 去边框、状态用形状与文字、信息密度高 | 状态不只靠颜色、行内信息紧凑 | 不做 issue 式交互 |

共同点：月视图只回答「哪一天有东西」，详情放在点按之后。

### 7.3 布局

桌面（≥1024px）：

```text
┌ 日历 ─────────────────────────────── [月 | 列表]  [今天] [‹] [›] ┐
│ 今天与明天                                                       │
│ [今天 20:00 雑談 · ののか] [明天 06:00 朝活 · りつ]               │
├──────────────────────────────────────────────────────────────────┤
│ 日      月      火      水      木      金      土                │
├──────────────────────────────────────────────────────────────────┤
│ 26      27      28      29      30      31      1                 │
│ ·       ·       ·       ·       ·       ·       ▎20:00 雑談      │
│                                                 [锁]22:00 歌枠    │
├──────────────────────────────────────────────────────────────────┤
│ 2       3       4       5       6       7       8                 │
│ …                                                               │
└──────────────────────────────────────────────────────────────────┘
```

移动（<1024px，默认议程）：

```text
日历                         [月 | 列表]
‹   2026 年 11 月   ›   今天
────────────────────────────────────
今天 · 11 月 8 日 周六
  20:00  ● ののか   雑談            预定
  22:00  ○ りつ     歌枠      [锁]   会员限定
────────────────────────────────────
明天 · 11 月 9 日 周日
  21:00  ● みやこ   歌枠            预定
────────────────────────────────────
```

页面结构：

1. `PageHeader`：标题「日历」，`facts` 两项为「本月 N 场」「今天与明天 N 场」。
2. 「今天与明天」时间线：按 JST 自然日分组，跨天朝活放在「明天」；不再使用「接下来 · 7 天」横条。
3. 视图切换：`SegmentedControl` 月 / 列表。
4. 月网格或议程列表。
5. 页脚 `PanelNote`：图例与口径说明。

### 7.4 月网格规格

| 项 | 值 | 说明 |
| --- | --- | --- |
| 周起始 | 周日 | 中文与日本日历的常见习惯；现有 GitHub 风格热力图保持周一，不受影响 |
| 列数 | 7 | 固定 |
| 行数 | 5–6 | 按当月跨度，始终补齐整周 |
| 单元格高度 | `min-h-24`（96px） | 6 行约 576px，加页头在一屏内 |
| 单元格边框 | `border-hairline` | 只画分隔线，不做卡片 |
| 日期数字 | `text-footnote tabular-nums` | 左上角，距边 6px |
| 今天 | 数字外加 `size-6 rounded-full bg-foreground text-background` | 不上整格背景 |
| 选中日 | 整格 `bg-muted/60`，日期数字 `text-foreground` | 不加粗边框 |
| 非本月 | 日期与事件 `opacity-45` | 保留事件，便于跨月阅读 |
| 周末 | 不加颜色 | 避免与成员色冲突 |
| 每格事件 | 全部列出 | 不折叠，格子随内容长高；整格可点开当天详情 |
| chip 高度 | 17px 行高 + 3px 间距 | 单行「时间 + 标题」，标题过长省略 |
| chip 结构 | 2px 圆角色条 + `HH:mm` + 标题 | 色条 `self-stretch`，标题 `truncate` |
| chip 间距 | 3px | 紧凑但不粘连 |

字号与颜色全部走现有 Token：

```text
月份标题      text-xl font-semibold tracking-tight
星期行        text-caption text-ink-3
日期数字      text-footnote tabular-nums
chip 时间     text-caption tabular-nums text-ink-3
chip 标题     text-footnote text-foreground
页脚说明      text-caption text-ink-3
```

不用 `dark:` 覆盖颜色，不写十六进制色值；成员色通过 `var(--member-color)` 或 dataset 的 `color` 字段以 inline style 注入，与现有组件一致。

### 7.5 状态视觉

| 状态 | 色条 | 辅助标记 | 文字 | 可点 |
| --- | --- | --- | --- | --- |
| `done` | 实心成员色，2px | 无 | 正常 | 跳到单场页 |
| `live` | 实心成员色 + 呼吸圆点 | `Badge variant="error"` 直播中 | 正常 | 打开详情；可外链 YouTube |
| `upcoming` | 1px 描边，透明底 | 无 | 正常 | 打开详情 |
| `cancelled` | 灰色虚线 | 无 | 删除线、`text-muted-foreground` | 只读 |
| `pending` | 灰色虚线 | 无 | `待补录` | 打开详情 |
| `undated` | 不进入月网格 | 无 | 在「日期待定」区块列出 | 打开详情 |

会员限定在 chip 末尾加 `Lock` 图标（12px），`aria-label="会员限定"`。标题里不重复写「会限」。

图例放页脚，一行：`实心 已结束 · 空心 预定 · 圆点 直播中 · 锁 会员限定`。

### 7.6 组件映射

| 需求 | 组件 | 说明 |
| --- | --- | --- |
| 页面外壳 | `Panel` / `PanelHead` / `PanelBody` / `PanelNote` | 与现有 dashboard 一致；`PanelBody` 用 `flush` 去掉内边距，让网格贴边 |
| 页头 | `PageHeader` | 标题、facts、操作区 |
| 视图切换 | `SegmentedControl` | 月 / 列表 |
| 月份切换 | `Button variant="ghost" size="icon-sm"` | `ChevronLeft` / `ChevronRight`，带 `aria-label` |
| 回到今天 | `Button variant="outline" size="sm"` | 文案「今天」 |
| 成员筛选 | `ToggleGroup` 多选 + `MemberAvatar` / `MemberDot` | 选中状态写 `?members=`；窄屏收进 `Popover` |
| 月网格 | 自绘 `MonthGrid` | 纯 React + CSS Grid；日期计算放 `src/lib/calendar.ts` |
| 事件 chip | 月网格内联 `EventLine` | 复用成员色与 `cn()`；不引入新依赖 |
| 当天详情（桌面） | `Popover` + `PopoverPopup` | 锚定到日期格；整格触发 |
| 当天详情（移动） | 同一个 `Popover` | 位置自适应；不额外维护一套抽屉 |
| 事件悬停预览 | 原生 `title` | 先给完整标题；详情在当天 `Popover` |
| 状态 | `Badge` | `error` / `outline` / `secondary` |
| 空态 | `Empty` | 议程为空时使用 |
| 图标 | `lucide-react` | `CalendarDays`、`ChevronLeft/Right`、`Lock`、`List`、`LayoutGrid` |
| 成员头像 | `MemberAvatar` | 现有组件 |
| 议程行 | 参考 `StreamList` 的两行结构 | 不再造一套列表样式 |

不使用 `ui/calendar.tsx`（DayPicker）作为主网格。原因：它的日期按钮为选择场景设计，多事件布局、`+N` 折叠、状态色条都要绕过默认结构；自绘 7×N 网格更直接，也能复用 `calendar-heatmap.tsx` 的日期算术。`Popover`、`Drawer`、`SegmentedControl` 等交互件仍用 coss。

### 7.7 交互

- **月份切换**：`‹` / `›` 按钮、`←` / `→` 键（焦点不在输入框时）、触屏左右滑（可选）。翻页动画 180ms 横向位移，`prefers-reduced-motion` 下关闭。
- **回到今天**：`T` 键或「今天」按钮；回到当前月并把选中日设为今天。
- **点日期 / 整格**：打开当天详情的 `Popover`；URL 写入 `?day=YYYY-MM-DD`。
- **点当天详情里的事件**：`done` 跳到单场页；未来场有 YouTube 链接时外链。
- **悬停 chip**：原生 `title` 先给完整标题；完整信息在当天 `Popover`。
- **成员筛选**：多选；至少保留一个或允许全不选（全不选等于全部）。写入 `?members=nonoka,ritsu`，默认不写。
- **URL 状态**：`month`、`day`、`members`、`view`；默认值不写。月份与成员切换用 `history.replaceState`，不触发服务端请求；只有超出预取窗口时才跳转。
- **数据窗口**：SSR 预取「当前月前 6 个月到后 3 个月」，客户端在这个窗口内切月不请求。`?month=` 超出窗口时由 SSR 以该月为中心重新取数。
- **键盘顺序**：`‹` → `›` → 「今天」→ 视图切换 → 成员筛选 → 网格。网格内用方向键在日期之间移动，`Enter` 打开详情。
- **滚动**：桌面网格不内部滚动，整页滚动；移动议程整页滚动，日期头随卡片滚动，不用 `sticky`，避免遮住第一条事件。

### 7.8 三态

| 状态 | 表现 | 下一步 |
| --- | --- | --- |
| 加载 | 首屏由 SSR 输出，没有骨架；跨窗口切月走 ClientRouter 导航，显示全局进度条 | 等待，或点「今天」 |
| 空 | 月网格保留，整月无事件时页脚写「这个月还没有安排」；议程视图显示 `Empty` | 「看下个月」或「查看场次」 |
| 错误 | 页面级错误块，说明「日程读取失败」 | 「重试」和「查看现有场次」 |
| 完全没有数据 | 月网格仍显示日期；页脚写「还没有可用的直播记录」 | 链到 `/about` 与成员频道 |

不写「暂无数据」四个字。空状态说明这里是什么、为什么空、下一步去哪。

### 7.9 移动端

- 默认议程视图，按 JST 自然日分组；日期头在卡片内，不 `sticky`。标题最多两行，不单行截断。
- 每日标题：`11 月 8 日 · 周六`；今天写「今天 · 11 月 8 日 周六」。
- 每条：时间、成员色点、成员名、状态一行；标题最多两行，时长在下方。
- 月视图仍可通过 `SegmentedControl` 打开，但格子只显示日期数字和小圆点，不显示标题；点日期打开当天 `Popover`。
- 触控目标：整行可点，高度不小于 44px。
- 全组底部标签栏加入「日历」（组首页 / 日历 / 相册 / 对比 / 成员）；成员端仍是 5 项，不额外加日历。

### 7.10 无障碍

- 每天的可访问名称写成一句话：`11 月 8 日，星期六，2 场：20:00 宫永ののか 雑談；22:00 筑紫りつ 歌枠，会员限定`。
- 整格的可访问名称列出当天全部场次，例如「11 月 8 日，星期六，2 场：20:00 …；22:00 …」。
- 状态不只靠颜色：chip 的空心 / 实心、删除线、锁图标和 `Badge` 文字共同表达。
- 图标按钮全部有 `aria-label`；`Lock` 不作为唯一的信息来源。
- 键盘可达：网格日期、月份按钮、视图切换都在 Tab 顺序内；焦点环使用现有 Token。
- 颜色对比：成员色只做 2px 色条，不承担文字可读性；文字用 `foreground` / `muted-foreground`。
- 200% 缩放：月网格在 1024px 以下切议程，避免格子被压到不可读；320px 无横向滚动。

### 7.11 文案

| 位置 | 文案 |
| --- | --- |
| 页面标题 | `日历` |
| 视图切换 | `月` / `列表` |
| 今天 | `今天` |
| 接下来 | `接下来 · 7 天` |
| 日期待定 | `日期待定` |
| 状态 | `预定` / `直播中` / `已结束` / `已取消` / `待补录` |
| 会员限定 | `会员限定`（图标 + 可访问名称，不在标题里重复） |
| 整月为空 | `这个月还没有安排` |
| 完全没有记录 | `还没有可用的直播记录` |
| 错误 | `日程读取失败` + `重试` |
| 页脚口径 | `时间一律 JST。会员限定场次只显示标题与时间，指标在解锁后可见。` |

## 8. 路由与导航

| 文件 | 改动 |
| --- | --- |
| `src/lib/routes.ts` | `VIEWS` 末尾追加 `calendar`；新增 `calendarPath(id)`、`groupCalendarPath()`；`viewPath` 加 case；`sectionFromPathname` 识别 `calendar` |
| `src/pages/calendar.astro` | 新增。`prerender = false`，查日历数据，`pageSeo`，`Astro.cache.set`，渲染 `<GroupPage view="calendar">` |
| `src/pages/[datasetId]/calendar.astro` | 新增。同上，渲染 `<DatasetPage view="calendar">` |
| `src/components/app/group-page.tsx` | `GroupView` 加 `calendar`，switch 分支到 `GroupCalendarPage` |
| `src/components/app/dataset-page.tsx` | `DatasetView` 加 `calendar`，switch 分支到 `CalendarPage` |
| `src/components/pages/calendar-page.tsx` | 新增薄壳：`useDatasetView()` → `CalendarView` |
| `src/components/pages/group-calendar-page.tsx` | 新增薄壳：`useGroupDataContext()` 或页面 props → `CalendarView` |
| `src/components/dashboard/calendar-view.tsx` | 新增，真正实现 |
| `src/components/dashboard/month-grid.tsx` | 新增，月网格 |
| `src/components/dashboard/agenda-list.tsx` | 新增，议程列表 |
| `src/components/dashboard/app-sidebar.tsx` | 组级 `GROUP_NAV_ITEMS` 加「日历」；成员 `NAV_ITEMS` 加 `calendar` |
| `src/components/dashboard/app-header.tsx` | `SECTION_LABELS` 加 `calendar: "日历"` |
| `src/components/dashboard/command-palette.tsx` | 加「日历」入口 |
| `src/hooks/use-keyboard-shortcuts.ts` | `VIEWS` 追加在末尾，避免 `1..5` 映射错位；`←/→`、`T` 在日历页生效 |
| `src/lib/seo.ts` | `sectionCopy()` 加 `calendar` 文案 |
| `astro.config.mjs` | `routeRules` 加两个日历路由 |
| `src/pages/sitemap.xml.ts` | 收录 `/calendar` 与 `/{id}/calendar`，canonical 不带 query |
| `scripts/purge-cache.ts` | `--all` 加 `schedule` tag |
| `src/pages/calendar.ics.ts`、`src/pages/[datasetId]/calendar.ics.ts` | `FR-CAL-009` 时新增 |
| `src/components/dashboard/home-calendar.tsx` | 面板标题改为「开播热力图」，与新页面区分 |
| `docs/README.md`、`docs/planning/README.md` | 加入本文索引 |

移动端 `mobile-tab-bar.tsx`：全组 5 项含日历；成员端保持 5 项。

## 9. 缓存与失效

| 路由 | maxAge | swr | tags |
| --- | ---: | ---: | --- |
| `/calendar` | 60 | 300 | `group`, `schedule` |
| `/{datasetId}/calendar` | 60 | 300 | `dataset-<id>`, `schedule` |
| `/calendar.ics`、`/{datasetId}/calendar.ics` | 300 | 600 | `schedule` |

- `schedule` 是新 tag，需要同时加进 `scripts/purge-cache.ts` 的 `--all` 和 `daily-update` 的 purge 列表。
- `schedule:sync` 成功后调用 `POST /api/internal/cache/purge`，tags 为 `schedule`，组级页面再加 `group`，成员页加 `dataset-<id>`。
- `daily-update` 在日程有变化或新场次入库时 purge；安静日不调用。
- 日历页不读 `?key=`，缓存策略不随访问参数变化。会员限定只影响链出去的单场页。

## 10. 实施阶段

### 阶段 0：数据与骨架

1. `src/db/schema.ts` 加 `scheduled_streams`；`bun run db:generate` + `bun run db:migrate`。
2. `src/types/calendar.ts` 定义 DTO 与状态类型。
3. `content/schedule/` 建目录，先放 1 个成员的 2–3 条示例。
4. `scripts/lib/schedule-schema.ts` 用 valibot 校验文件格式。
5. `scripts/sync-schedule.ts` 与 `package.json` 的 `schedule:check` / `schedule:sync`。

验收：

- 迁移可在空库和现有库上执行。
- `schedule:check` 对合法文件返回 0，对缺字段 / 错误时区返回非 0 并指出位置。
- `schedule:sync` 连跑两次，第二次新增 0、更新 0、删除 0。

### 阶段 1：读取路径

1. `src/db/queries/calendar.ts`。
2. `src/lib/calendar.ts`：`buildCalendarEvents`、`deriveCalendarEventState`、`buildMonthGrid`、`groupEventsByDay`。
3. `src/lib/calendar-params.ts`：`parseCalendarParams` / `writeCalendarParams`。
4. `src/lib/calendar.test.ts`、`calendar-params.test.ts`。
5. `src/pages/calendar.astro`、`src/pages/[datasetId]/calendar.astro`。
6. `CalendarView`、`MonthGrid`、`AgendaList`、`CalendarEventChip`。
7. 路由、侧栏、页头、面包屑、搜索面板。

验收：

- `/calendar` 与 `/{id}/calendar` 在 preview 下返回 200。
- 月网格按周日开始，今天有圆点，非本月日期淡化。
- 点日期弹出详情，`?day=` 刷新后仍然打开。
- 会员限定出现锁标记，标题与时间正常显示。
- 状态单测覆盖 done / live / upcoming / cancelled / pending / undated 六种分支。

### 阶段 2：写入路径与联动

1. `syncScheduleFromChannel` 接入 `daily-update`。
2. `.github/workflows/schedule.yml`。
3. `schedule` tag 接入 `purge-cache.ts` 与 `daily-update`。
4. 组首页「本周还有 N 场」、成员首页「接下来」入口、场次页提示。
5. 成员首页热力图改名「开播热力图」。

验收：

- 频道出现未来场后，`daily-update --dry-run` 能打印将写入的日程条数；实跑后日历可见。
- 未来场开播并入库后，日历显示已结束并链到单场页，无需手动改状态。
- 修改 `content/schedule` 并推送，`schedule.yml` 完成后线上日历在 60 秒内更新。
- 安静日 `daily-update` 不产生 purge 请求。

### 阶段 3：打磨

1. 「接下来」横条与相对日期（今天 / 明天 / 3 天后）。
2. `PreviewCard` 悬停、`Drawer` 移动端详情。
3. 键盘：`←/→`、`T`、网格内方向键。
4. 无障碍走查与文案调整。
5. 日期待定区块。
6. 可选：`FR-CAL-009` ICS。

验收：

- 1440 / 1280 / 1024 / 390 / 320px 五档走查，无横向溢出。
- 键盘可完成切月、选日、打开详情、跳转。
- axe 检查 0 violations（至少桌面与移动各一次）。
- 深色 / 浅色都使用 Token，无硬编码颜色。

### 阶段 4：文档收尾

1. `docs/data/data-model.md` 增加 `scheduled_streams` 的当前表结构。
2. `docs/engineering/deployment.md` 增加 `schedule.yml` 与 purge tag。
3. `docs/requirements/requirements-spec.md` 更新 FR 状态。
4. `docs/planning/backlog.md` 关闭 B14。
5. `docs/development-log/` 记录当日实现与验证结果。

## 11. 测试计划

### 单元测试

| 文件 | 用例 | 失败条件（故意改坏时应变红） |
| --- | --- | --- |
| `calendar.test.ts` | 同 `video_id` 同时存在日程与场次 → `done` | 把 `hasStream` 判断去掉 |
| | `cancelled_at` 非空且已入库 → `cancelled` | 把取消判断放到 `done` 之后 |
| | `scheduled_at` 为空 → `undated` | 让空时间落进 `upcoming` |
| | 预计 120 分钟，`now = scheduled + 100 分钟` → `live` | 把窗口算成 0 |
| | 过窗口且未入库 → `pending` | 返回 `done` |
| | 23:59 JST 的事件归到当天，不是 UTC 次日 | 用 `toISOString().slice(0,10)` 分组 |
| | 月网格从周日开始，补齐前后整周 | 从周一开始 |
| | 一天 5 场 → 5 条全部渲染 | 截断成 2 条或加回 `+N` 折叠 |
| `calendar-params.test.ts` | 默认参数不写 URL | 把默认值写进 query |
| | `members=a,b` 解析为数组并去重 | 解析成单字符串 |
| `schedule-schema.test.ts` | 缺 `title`、`at` 无时区、`videoId` 长度错误 → 报错 | 放过非法输入 |

### 查询与冒烟

- `bun run db:query` 增加日历查询的冒烟：10 个月窗口返回行数、时间字段是 ISO、`null` 不变成 0。
- `bun run test:smoke` 增加 `/calendar`、`/nonoka/calendar`、`?month=2026-11`、`?day=2026-11-08`、`?members=nonoka`。
- 新增 `schedule:sync` 的幂等检查脚本，可在 CI 重跑两次对比计数。

### 手工走查

| 路径 | 预期 |
| --- | --- |
| `/calendar` | 月网格、今天圆点、「接下来」条、成员筛选正常 |
| `?month=2025-12` | 显示对应月份；跨窗口时由 SSR 重新取数，导航期间显示全局进度条 |
| `?day=2026-11-08` | 刷新后当天详情自动打开 |
| `?members=nonoka,ritsu` | 只显示两位成员；刷新保持 |
| `/nonoka/calendar` | 侧栏高亮「日历」，面包屑为「ののか / 日历」 |
| 会员限定场次 | 锁标记、标题与时间可见、无指标 |
| 未来场开播并入库后 | 同一事件变为已结束，点击进入单场页 |
| 390 / 320px | 默认议程、无横向滚动、触控目标 ≥44px |
| 深色模式 | 所有颜色来自 Token，无黑块或低对比 |
| 200% 缩放 | 不溢出，网格在窄宽度切议程 |

## 12. 风险与待决

| 风险 / 待决 | 影响 | 处理 |
| --- | --- | --- |
| 频道列表缺少精确开播时间 | 只能显示日期 | 进「日期待定」；手工补 `at` |
| 每日任务一天一次 | `live` 状态滞后 | 客户端用 `now` 重算；必要时下一阶段加短轮询 |
| `started_at` 可空 | 已结束场次可能没有时刻 | 用 `date` 当天 00:00 JST 兜底，并在页脚说明 |
| 预取 10 个月的数据量 | 岛屿 props 变大 | 当前规模约 300–800 行；超过 1500 行时改为按月请求 |
| 两个「日历」命名冲突 | 用户混淆 | 旧热力图改名「开播热力图」；侧栏只保留一个「日历」 |
| 手工文件与自动行重复 | 同场出现两条 | 有 `videoId` 时统一 `event_key = yt:*`，部分唯一索引兜底 |
| 自动行残留 | 频道删档后仍显示 | `--prune` 清理过期且未入库的自动行 |
| 状态边界（跨午夜、超长直播） | 显示错误 | 单测覆盖 23:59 JST 与 12 小时上限 |
| 会员限定范围 | 误公开指标 | 日历只读元数据；指标字段不进入 DTO |
| `VIEWS` 插入位置 | 数字快捷键错位 | 只追加在末尾 |
| 缓存残留 | 改完日程 60 秒后才可见 | 文档写明；purge 走 `schedule` tag |

需要先拍板：

1. 周起始用周日（建议）还是周一。
2. 历史月份是否需要在日历里无限回看，还是超过 6 个月引导到场次 / 相册。
3. `pending`（待补录）是否对访客可见，还是只给维护者。
4. 是否在 `FR-CAL-007` 里把单场页「下一场」扩展到未来场。
5. ICS 是否进第一版。
6. 自动同步是否写入没有精确时间的场次。

## 13. 参考

- 需求入口：[requirements-spec.md](../requirements/requirements-spec.md)、[user-stories.md](../requirements/user-stories.md)
- 数据模型与口径：[data-model.md](../data/data-model.md)
- 现有日历热力图：[calendar-heatmap.tsx](../../src/components/charts/calendar-heatmap.tsx)、[home-calendar.tsx](../../src/components/dashboard/home/home-calendar.tsx)
- 每日任务：[daily-update.ts](../../scripts/daily-update.ts)、[update-plan.ts](../../scripts/lib/update-plan.ts)
- 会员限定口径：[visibility.ts](../../src/lib/visibility.ts)
- Apple Human Interface Guidelines：Clarity、Deference、Depth 三条原则；日历与列表的渐进披露模式
- 对照产品：Apple Calendar、Google Calendar、Notion Calendar、Fantastical、Linear（只借排版与状态表达，不照搬功能）
