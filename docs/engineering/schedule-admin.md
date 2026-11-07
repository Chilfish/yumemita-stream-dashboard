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
- 管理端只保留 `url` 输入，链接只作为外链展示，不参与 `eventKey` 和真实场次匹配；手工行仍按自然键或显式 `id` 写入。
- 官方预告常常没有标题，`title` 可以整个省略；返回与列表里的 `title` 为空字符串，页面显示「待定」。
- 知道精确时间时传 `scheduledAt`，服务端会派生 `date` 与 `slot`。
- 两者都传时以 `scheduledAt` 为准。

## 3. 数据关联

管理端只写 `scheduled_streams`，不写 `streams`。

手工日程默认没有 `videoId`。当天直播结束后，每日任务照常把真实场次写入 `streams`；
日历读取时按下面的规则自动匹配，命中后隐藏手工行，显示真实场次的标题、时长与站内链接：

1. 同一成员、同一 JST 日期、同一时段；
2. 同日同时段有多场时，取开播时间最近的一场；
3. `late` 跨午夜：23:30 与次日 00:30 视为同一晚；
4. 自动同步的 `youtube` 行优先于手工行；
5. 已取消的日程不参与匹配；
6. 匹配不到时保留手工行，状态显示「待补录」。

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
| `videoId` | 否 | 11 位 YouTube id；传了会合并到 `yt:<videoId>` 自动行 |
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
- 补 `videoId` 会把主键合并到 `yt:<videoId>`；如果该行已存在，当前手工行会被删除并返回已有行。
- 不允许修改 `datasetId`。

### `DELETE /api/admin/schedule?datasetId=&eventKey=`

```bash
curl -u "$ADMIN_USER:$ADMIN_PASSWORD" \
  -X DELETE "https://ymmt.chilfish.top/api/admin/schedule?datasetId=nonoka&eventKey=manual%3A2026-11-08-late"
```

- 只能删除手工创建的行（`source = manual`），有 `videoId` 的 `yt:*` 行也可以删。
- 删除自动同步行返回 `409`；自动行会由每日任务自己清理。

## 5. 幂等与主键

- 有 `videoId` → `eventKey = yt:<videoId>`。
- 没有 `videoId`、但传了 `eventKey` / `id` → 按该键 upsert。
- 都没传 → 按自然键 `datasetId + date + slot` 找未取消的手工行并更新；找不到才新建 `manual:<date>-<slot>`。
- 因此同一条预告重复 POST 不会产生多行。
- 同一成员同一天同一时段确实有两场时，显式传 `id`，例如 `id: "2026-11-08-late-2"`。

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

**直播前拿到链接**：PATCH 传 `url`，只作为外链展示；要让主键合并到 `yt:<videoId>` 才传 `videoId`。

**取消**：PATCH `{ "cancelled": true }`，不要 DELETE，保留取消记录。

**查某天**：`GET ?from=2026-11-08&to=2026-11-08`。
