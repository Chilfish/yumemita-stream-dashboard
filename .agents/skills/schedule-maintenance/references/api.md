# `/api/admin/schedule` 接口

所有请求用 HTTP Basic 认证，凭据来自仓库 `.dev.vars` 的 `ADMIN_USER` / `ADMIN_PASSWORD`。
目标地址本地用 `http://localhost:4321`，线上用 `.dev.vars` 的 `SITE_URL`。

```bash
BASE="http://localhost:4321"
AUTH="$ADMIN_USER:$ADMIN_PASSWORD"
```

## POST：新建日程

请求体字段：

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `datasetId` | 是 | 成员 id 或官方账号 id；目标库必须有这条 dataset |
| `date` | 二选一 | JST 自然日 `YYYY-MM-DD`；与 `slot` 搭配 |
| `slot` | 二选一 | `early` / `mid` / `late` |
| `scheduledAt` | 二选一 | 精确时间，带 `+09:00`；服务端据此派生 `date` / `slot` |
| `title` | 否 | 原样标题；省略表示「待定」 |
| `kind` | 否 | `sing` / `talk` / `game` / `event` |
| `url` | 否 | 具体视频链接 |
| `availability` | 否 | `public` / `subscriber_only`，默认 `public` |
| `expectedMinutes` | 否 | 15–720；仅已结束场次有 `duration` 时使用 |
| `participants` | 否 | 官方账号场次里在场的成员 id；成员个人频道留空 |
| `source` | 是 | 固定 `manual` |

最小请求：

```bash
curl -s -u "$AUTH" \
  -H "content-type: application/json" \
  -X POST "$BASE/api/admin/schedule" \
  -d '{"datasetId":"nonoka","date":"2026-11-08","slot":"late","source":"manual"}'
```

一次带全：

```bash
-d '{"datasetId":"ritsu","title":"【#歌枠 】リベンジ！！！！！歌枠【峰月律/ゆめみた】","scheduledAt":"2026-11-09T22:00:00+09:00","kind":"sing","url":"https://www.youtube.com/live/z0GRgSUrY0A","source":"manual"}'
```

主键规则：

- 自然键是 `manual:<date>-<slot>`；同一天同一时段第 N 场为 `manual:<date>-<slot>-N`（N≥2）。
- 请求体不要传 `videoId`。带链接只传 `url`，主键不变，自动同步会更新同一行。
- 要固定序号时才显式传 `id`，例如 `"id":"2026-11-08-late-2"`。
- 内容相同的重复 POST 是幂等的；确实有两场时再发一次即可。

## GET：查询

```bash
# 指定范围
curl -s -u "$AUTH" "$BASE/api/admin/schedule?from=2026-11-08&to=2026-11-09"

# 今天和明天
curl -s -u "$AUTH" "$BASE/api/admin/schedule?from=$(date +%F)&to=$(date -d tomorrow +%F)"

# 只看某个账号
curl -s -u "$AUTH" "$BASE/api/admin/schedule?from=2026-11-08&to=2026-11-09&datasetId=other"
```

返回 `{ ok, range, items[] }`。检查：

- `date` / `slot` 是否符合预告。
- 有 yt-dlp 元信息时，`title` 应等于视频完整标题，`timeTentative=false`；只有推文兜底才允许空标题。
- `matchedStream` 非空表示已关联到真实场次。
- `state`：`upcoming` / `live` / `done` / `cancelled` / `pending`。

## PATCH：修改

```bash
curl -s -u "$AUTH" -H "content-type: application/json" \
  -X PATCH "$BASE/api/admin/schedule" \
  -d '{"datasetId":"nonoka","eventKey":"manual:2026-11-08-late","title":"雑談"}'
```

- 改期传 `date` + `slot`（或 `scheduledAt`），自然键会跟着改名；目标时段已被另一场占用时返回 `409`。
- 取消传 `"cancelled": true`，恢复传 `false`；记录保留。
- 只补链接传 `"url"`；主键不变。

## DELETE：删除手工行

```bash
curl -s -u "$AUTH" -X DELETE \
  "$BASE/api/admin/schedule?datasetId=nonoka&eventKey=manual%3A2026-11-08-late"
```

`source = youtube` 的自动行不能删除（`409`），只能 PATCH 取消或等每日任务清理。
删除前先用 GET 确认 `eventKey`。
