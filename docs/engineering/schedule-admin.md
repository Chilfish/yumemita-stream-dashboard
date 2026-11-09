# 日程管理 API

> 内部接口，供维护者与 Agent 新增、修改、取消未来直播日程。
> Agent 可直接使用项目内的 [schedule-maintenance skill](../../.agents/skills/schedule-maintenance/SKILL.md)。
> 浏览器入口是 `/admin/schedule`（只从 `/about` 链接），接口前缀 `/api/admin/schedule`。
> 页面与接口都不进导航和 sitemap，并带 `noindex` 与 `no-store`。

## 1. 认证

接口使用 HTTP Basic 认证。用户名与密码由部署方单独提供，不要写进代码、仓库或公开文档。

```bash
curl -u "$ADMIN_USER:$ADMIN_PASSWORD" https://ymmt.chilfish.top/api/admin/schedule
```

- 认证失败返回 `401`，JSON 为 `{ "ok": false, "error": "未认证" }`。
- 浏览器首次打开 `/admin/schedule` 会弹原生登录；登录成功后由 HttpOnly Cookie 维持 7 天，页面内的写入请求不需要再带凭据。
- Agent 直连时只带 Basic 头即可。写请求如果带 `Origin`，必须与站点同源。

## 2. 时间与时段

所有日期与时间按 **JST（UTC+9）** 解释。

| 字段 | 格式 | 说明 |
| --- | --- | --- |
| `date` | `YYYY-MM-DD` | JST 自然日 |
| `scheduledAt` | 带时区的 ISO 8601 | 精确开播时间，例如 `2026-11-08T21:00:00+09:00` |
| `slot` | `early` / `mid` / `late` | 大时段 |

时段划分：

| slot | 页面文案 | JST 范围 |
| --- | --- | --- |
| `early` | 早上 | 05:00–11:59 |
| `mid` | 中午 | 12:00–17:59 |
| `late` | 晚上 | 18:00–次日 04:59 |

- 只知道「某天晚上」时，传 `date + slot`，不要编造 `scheduledAt`。
- 管理端的「精确时间」用 `TimeInput`：可以直接写 `9:30`、`930`、`下午3点`，失焦或按 `Enter` 后规范化为 `HH:mm`，提交时拼成 `scheduledAt`。规则见 [time-input.md](../ui-design/time-input.md)。
- 管理端只保留 `url` 输入；链接只作为外链与匹配线索，不改变主键。已知日期 + 时段时主键固定为 `manual:<date>-<slot>`，`yt:<videoId>` 只用于时间未知的自动同步行。链接与显式 `videoId` 冲突时返回 400。
- 官方预告常常没有标题，`title` 可以整个省略；返回与列表里的 `title` 为空字符串，页面显示「待定」。
- 知道精确时间时传 `scheduledAt`，服务端会派生 `date` 与 `slot`。
- 两者都传时以 `scheduledAt` 为准。

## 3. 数据关联

管理端只写 `scheduled_streams`，不写 `streams`。

这张表只保留还没入库的未来场。每日任务把真实场次写入 `streams` 后，会同步删除对应日程：

1. `videoId` 命中 `streams.video_id`；
2. 手工行的 `url` 能解析出 video id 且命中 `streams`；
3. 没有 `videoId` 也没有链接时，按「成员 + JST 日期 + 时段」匹配，规则与读取期一致：
   - 同一成员、同一 JST 日期、同一时段；
   - 同日同时段有多场时，取开播时间最近的一场；
   - `late` 跨午夜：23:30 与次日 00:30 视为同一晚；
   - 已取消的日程不参与自然键匹配，但 video id / 链接命中时照常删除。

标题不参与匹配：预告阶段的标题经常缺失或只是「ゲーム」「朝活」这类占位词，按标题删容易误伤。
链接能解析出 video id 时只认链接，不会因为时间相近去认领另一场。

还没入库时，日历读取仍会把手工行按同样规则匹配到临时事件，命中后隐藏手工行；
自动同步行优先于手工行展示。

同一条未来场被手工行与自动行同时记录时，合并为日期 + 时段的自然键一行：保留手工行的 `date` / `slot` / `scheduledAt` / `expectedMinutes`，
自动行补上 `videoId`、标题与链接。`yt:` 行后来拿到日期/时段时，会直接改名为 `manual:<date>-<slot>`。

`GET` 返回的 `matchedStream` 可以用来确认某条日程已经关联到哪一场。

## 4. 端点

### `GET /api/admin/schedule`

查询参数：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `from` | 今天 − 7 天 | JST 日期，闭区间 |
| `to` | 今天 + 60 天 | JST 日期，闭区间 |
| `datasetId` | 全部成员 | 只看某个成员 |
| `includeCancelled` | `true` | 传 `false` 时过滤已取消 |
| `includeUndated` | `false` | 传 `true` 时额外返回没有日期也没有时间的旧行 |

```bash
curl -u "$ADMIN_USER:$ADMIN_PASSWORD" \
  "https://ymmt.chilfish.top/api/admin/schedule?from=2026-11-01&to=2026-11-30&datasetId=nonoka"
```

响应：

```json
{
  "ok": true,
  "range": { "from": "2026-11-01", "to": "2026-11-30" },
  "items": [
    {
      "datasetId": "nonoka",
      "eventKey": "manual:2026-11-08-late",
      "videoId": null,
      "title": "雑談",
      "url": null,
      "date": "2026-11-08",
      "slot": "late",
      "scheduledAt": null,
      "timeTentative": true,
      "expectedMinutes": 120,
      "availability": "public",
      "cancelled": false,
      "note": null,
      "source": "manual",
      "state": "upcoming",
      "matchedStream": null,
      "updatedAt": "2026-11-07T05:00:00.000Z"
    }
  ]
}
```

`state` 取值：`upcoming` / `live` / `done` / `cancelled` / `pending` / `undated`。

### `POST /api/admin/schedule`

新增或覆盖一条日程。返回 `201`（新建）或 `200`（更新）。

```bash
curl -u "$ADMIN_USER:$ADMIN_PASSWORD" \
  -H 'content-type: application/json' \
  -X POST https://ymmt.chilfish.top/api/admin/schedule \
  -d '{
    "datasetId": "nonoka",
    "date": "2026-11-08",
    "slot": "late",
    "expectedMinutes": 120
  }'
```

字段：

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `datasetId` | 是 | 成员 id |
| `title` | 否 | ≤200 字；预告里没有标题时可以省略，日历显示「待定」 |
| `date` | 条件 | 只给日期时还需 `slot` |
| `slot` | 条件 | 没有 `scheduledAt` 时需要 |
| `scheduledAt` | 否 | 带时区 ISO 8601 |
| `kind` | 否 | `sing` / `event` / `talk` / `game`；省略时按标题推断，标题也为空则留空 |
| `expectedMinutes` | 否 | 15–720 |
| `availability` | 否 | `public`（默认）/ `subscriber_only` |
| `cancelled` | 否 | 默认 `false` |
| `source` | 否 | 只允许 `manual`（默认）；管理端不会创建自动同步行 |
| `note` | 否 | ≤500 字 |
| `url` | 否 | http(s) 链接，只作为外链展示 |
| `videoId` | 否 | 11 位 YouTube id；只记录关联视频，不改变主键 |
| `id` | 否 | slug，拼成 `manual:<id>` |
| `eventKey` | 否 | 直接指定已有行的主键 |

### `PATCH /api/admin/schedule`

部分更新。必须带 `datasetId` 与 `eventKey`，其余字段按需传。

```bash
curl -u "$ADMIN_USER:$ADMIN_PASSWORD" \
  -H 'content-type: application/json' \
  -X PATCH https://ymmt.chilfish.top/api/admin/schedule \
  -d '{
    "datasetId": "nonoka",
    "eventKey": "manual:2026-11-08-late",
    "cancelled": true
  }'
```

- 传 `cancelled: true` 标记取消；传 `false` 恢复。
- 补 `videoId` 只更新关联视频，不会把主键改成 `yt:`。
- 不允许修改 `datasetId`。

### `DELETE /api/admin/schedule?datasetId=&eventKey=`

```bash
curl -u "$ADMIN_USER:$ADMIN_PASSWORD" \
  -X DELETE "https://ymmt.chilfish.top/api/admin/schedule?datasetId=nonoka&eventKey=manual%3A2026-11-08-late"
```

- 只能删除手工创建的行（`source = manual`），有 `videoId` 的 `yt:*` 行也可以删。
- 删除自动同步行返回 `409`；自动行会由每日任务自己清理。

## 5. 幂等与主键

- 一行由 `dataset_id + event_key` 唯一确定；不同成员可以有相同的 `eventKey`（例如同一天同一时段的 `manual:2026-11-08-late`），所以 PATCH / DELETE 必须同时带 `datasetId`，前端也不能只用 `eventKey` 定位行。
- 显式 `eventKey` / `id` → 按该键写入。
- 已知日期 + 时段 → `eventKey = manual:<date>-<slot>`；改期时自然键跟着改，显式 `id` 的行保持原键。
- 只有时间未知、且没有自然键时才用 `yt:<videoId>`。
- 同一成员同一天同一时段确实有两场时，显式传 `id`，例如 `id: "2026-11-08-late-2"`。
- 链接只填 `url`，不参与主键；已有自动同步行会更新同一行，而不是另建一条。

## 6. 错误

统一返回：

```json
{ "ok": false, "error": "说明", "field": "可选字段名" }
```

| 状态 | 场景 |
| --- | --- |
| 400 | 字段校验失败、日期与时段组合非法 |
| 401 | 未认证 |
| 404 | 日程或成员不存在 |
| 409 | 删除自动同步行 |
| 503 | 管理端未配置 |

## 7. 缓存

写入成功后服务端会自行失效 `schedule`、`group` 与 `dataset-<id>` 缓存，不需要调用 purge 端点。
日历页最多 60 秒 TTL，首页 1 小时 TTL；失效后下一次请求会重新渲染。

## 8. 常见操作

**新增一周预告**：对每条安排各发一次 POST，`date + slot` 即可。

**只知道日期、时段待定**：至少传 `date`；但日历需要时段才能定位，建议先按时段录入，确定后再 PATCH 补 `scheduledAt`。

**直播前拿到链接**：PATCH 传 `url` 即可，主键保持 `manual:<date>-<slot>`；自动同步会用同一把自然键更新标题与链接。

**取消**：PATCH `{ "cancelled": true }`，不要 DELETE，保留取消记录。

**查某天**：`GET ?from=2026-11-08&to=2026-11-08`。

## 9. 清理与对账

正常情况下 `ingest` 与每日任务会自己清掉已入库的日程、合并重复行。需要手工核对或一次补齐时：

```bash
bun run schedule:prune                     # dry-run，列出会删除 / 会合并的行
bun run schedule:prune --apply             # 写库
bun run schedule:prune --apply --dataset miyako
LOCAL=0 bun run schedule:prune --apply     # 线上，使用 .dev.vars 的 DATABASE_URL_ONLINE
```

- 默认 dry-run；输出里 `-` 是删除、`~` 是合并，并注明命中原因（`video_id` / `链接` / `日期+时段`）。
- 只处理已能在 `streams` 找到对应场次的行；还没入库的「待补录」不会动。
- 未来场里手工行与自动行重复时，补齐 `date` / `slot` / `scheduledAt` / `expectedMinutes` 后删除手工行。
- 环境由 `LOCAL` 统一决定：`LOCAL=1` 本机库，`LOCAL=0` 线上库。
