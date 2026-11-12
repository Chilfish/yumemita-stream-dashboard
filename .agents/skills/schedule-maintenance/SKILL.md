---
name: schedule-maintenance
description: 维护 夢限大みゅーたいぷ 直播日程：按官方预告或成员排期，在本地开发环境或线上站点新增、修改、取消、删除未来日程，并查询今天、明天或指定日期。当用户提到「加日程」「录日程」「改日程」「直播预告」「朝活」「日程维护」「这周谁播」时使用。
metadata:
  internal: true
---

# schedule-maintenance：直播日程维护

通过站点的 `/api/admin/schedule` 维护未来日程。不要直接写数据库，也不要改 `streams`。

## 重要

- 所有日期与时间按 JST（UTC+9）。
- 官方预告经常没有标题，`title` 可以整个省略；页面会显示「待定」。
- 只知道「某天早上 / 中午 / 晚上」时传 `date + slot`，不要编造精确时间。
- 重复提交同一 `datasetId + date + slot` 且内容相同是幂等的；同一天同一时段确实有两场时直接再发一次 POST，服务端会按标题与时间区分并顺延到 `manual:<date>-<slot>-2`。
- 想精确指定主键时才显式传 `id`（例如 `"2026-11-08-late-2"`）；一般不需要。
- 所有新建日程都固定用 `"source": "manual"`，这样之后能在 `/admin/schedule` 继续编辑。
- **本 skill 的请求体永远不要包含 `videoId`**；需要链接时只填 `url`。主键由日期 + 时段决定（`manual:<date>-<slot>`），链接不会改变它；自动同步会更新同一行，而不是另建 `yt:` 行。
- 不要创建 `source = youtube` 的行，也不要删除自动同步行。
- 把某行改到已被另一场占用的日期/时段会返回 `409`，此时先查询确认占用的那条，不要反复重试。

## 步骤 1：确定目标环境

1. 找到当前仓库根目录（包含 `.dev.vars` 与 `package.json`）。
2. 选择目标：
   - **本地**：`http://localhost:4321`。未启动时运行 `bun run dev`。
   - **线上**：读取 `.dev.vars` 里的 `SITE_URL`，例如 `https://ymmt.chilfish.top`。
3. 从 `.dev.vars` 读取 `ADMIN_USER` 与 `ADMIN_PASSWORD`，只在 curl 命令里使用。
   - 不要在回复里打印、复述或写入任何凭据。
   - 不要把密码写进仓库文件或脚本。

## 步骤 2：把预告转成字段

成员映射：

| 预告里的写法 | datasetId |
| --- | --- |
| ののか / 宫永 / 宮永 | nonoka |
| あられ / 仲町 | arale |
| りつ / 峰月 | ritsu |
| みやこ / 藤都子 | miyako |
| ゆの / 天野 | yuno |

时段：

| 文案 | slot | JST 范围 |
| --- | --- | --- |
| 早上 / 早 / 朝活 | early | 05:00–11:59 |
| 中午 / 中 / 昼 | mid | 12:00–17:59 |
| 晚上 / 晚 / 夜 | late | 18:00–次日 04:59 |

日期：

- 把「11/8」「11月8日」「明日」换算成 `YYYY-MM-DD`。
- 跨天朝活：预告说「明天早上」时，日期用明天，`slot` 用 `early`。
- 同一成员同一天可以早晚各一场，分别提交 `early` 与 `late`；同一时段两场就直接提交两次，服务端会顺延序号。

标题：

- 有标题就传 `title`。
- 不知道标题就省略，不要写「未定」「直播」之类的占位；页面会显示「待定」。

类型 `kind`：

| 预告内容 | kind |
| --- | --- |
| 歌枠 / 弾き語り / 歌回 | sing |
| 雑談 / トーク / 朝活聊天 | talk |
| ゲーム / 実況 / ゲーム配信 | game |
| 活动 / 告知 / 纪念 / 联动 | event |

- 不确定就省略，服务端会按标题推断；标题也为空时留空。

## 步骤 2.5：有 YouTube 链接时补全元信息

预告里带 YouTube 链接时，标题与开播时间以 yt-dlp 为准，推文文案只作兜底：

- 推文标题常被手写缩写（「リベンジ！歌枠！！」），完整标题里才有【#歌枠】、成员名等可检索信息。
- `release_timestamp` 给出精确开播时刻，比「22:00」这类口头时间可靠。
- `availability` 能区分会员限定，避免把 `subscriber_only` 的场次当公开场。

```powershell
$url = 'https://www.youtube.com/live/z0GRgSUrY0A'
$meta = yt-dlp -J --skip-download --no-warnings --ignore-no-formats-error $url | ConvertFrom-Json

$meta.id, $meta.title, $meta.live_status, $meta.availability, $meta.channel_id, $meta.duration
[DateTimeOffset]::FromUnixTimeSeconds($meta.release_timestamp).ToOffset([TimeSpan]::FromHours(9)).ToString('yyyy-MM-ddTHH:mm:ss+09:00')
```

- `--ignore-no-formats-error` 必加：未开播的直播本来没有任何格式，不加会直接报
  `This live event will begin in X hours` 且 stdout 为空。
- 命中 bot 检查、`subscriber_only` 或会员限定场次时，先导出登录态再重试：
  `bun scripts/export-yt-cookies.ts` 写出 `~/yt-cookies.txt`，命令加 `--cookies ~/yt-cookies.txt`；
  也可以直接 `--cookies-from-browser firefox`。cookie 文件是凭据，不要落进仓库或贴到回复里。
- 本地已装 `yt-dlp`（2026.10+）与 `deno`（解 JS challenge 用），无需额外安装。

字段映射：

| yt-dlp 字段 | 用法 |
| --- | --- |
| `title` | 直接作 `title`，保留完整标题，不改写、不截断 |
| `release_timestamp` | 转成带 `+09:00` 的 ISO 时间作 `scheduledAt`，`date` / `slot` 由服务端派生 |
| `availability` | `subscriber_only` 原样传；`public` 可省略 |
| `duration` | 仅已结束场次有值；取分钟数作 `expectedMinutes`（服务端限制 15–720） |
| `channel_id` | 对照 `data-sources.json` 校验成员，防止贴错链接 |
| `live_status` | `is_upcoming` 正常录入；`is_live` / `was_live` 说明已经开播或结束，按「已开始」处理，不要再建未来场 |

兜底：命令非 0 退出、输出为空（bot 检查 / 区域限制 / 链接失效 / 非 YouTube 站点）时，
直接退回推文预告的标题与时间继续录入，不要为补元信息卡住日程。

## 步骤 3：写入

设置变量后调用：

```bash
BASE="http://localhost:4321"   # 线上改成 SITE_URL
AUTH="$ADMIN_USER:$ADMIN_PASSWORD"

curl -s -u "$AUTH" \
  -H "content-type: application/json" \
  -X POST "$BASE/api/admin/schedule" \
  -d '{"datasetId":"nonoka","date":"2026-11-08","slot":"late","source":"manual"}'
```

带标题：

```bash
curl -s -u "$AUTH" \
  -H "content-type: application/json" \
  -X POST "$BASE/api/admin/schedule" \
  -d '{"datasetId":"ritsu","title":"歌枠","date":"2026-11-09","slot":"early"}'
```

同一天同一时段两场：直接再发一次，服务端按标题与时间区分并顺延序号。要指定序号时传稳定 `id`：

```bash
-d '{"datasetId":"nonoka","id":"2026-11-08-late-2","date":"2026-11-08","slot":"late"}'
```

带类型：

```bash
-d '{"datasetId":"ritsu","title":"歌枠","date":"2026-11-09","slot":"early","kind":"sing"}'
```

已经有 yt-dlp 元信息时，一次带全（标题取完整标题，时间用 `+09:00`）：

```bash
-d '{"datasetId":"ritsu","title":"【#歌枠 】リベンジ！！！！！歌枠【峰月律/ゆめみた】","scheduledAt":"2026-11-09T22:00:00+09:00","kind":"sing","url":"https://www.youtube.com/live/z0GRgSUrY0A","source":"manual"}'
```

## 步骤 4：验证

查询同一日期范围，确认行与状态：

```bash
curl -s -u "$AUTH" "$BASE/api/admin/schedule?from=2026-11-08&to=2026-11-09"
```

检查：

- `items[].date` 与 `slot` 是否符合预告。
- 有 yt-dlp 元信息时，`title` 应与视频完整标题一致，`timeTentative=false`；只有推文兜底时才允许 `title` 为空。
- `matchedStream` 非空表示已关联到真实场次。
- `state` 为 `upcoming` / `live` / `done` / `cancelled` / `pending`。

给用户的回复用紧凑表格列出：日期、时段、成员、标题（空则「待定」）、状态。

## 常用操作

**查今天和明天**：

```bash
curl -s -u "$AUTH" "$BASE/api/admin/schedule?from=$(date +%F)&to=$(date -d tomorrow +%F)"
```

**修改标题、时段或时间**：

```bash
curl -s -u "$AUTH" -H "content-type: application/json" \
  -X PATCH "$BASE/api/admin/schedule" \
  -d '{"datasetId":"nonoka","eventKey":"manual:2026-11-08-late","title":"雑談"}'
```

**取消**（保留记录）：

```bash
-d '{"datasetId":"nonoka","eventKey":"manual:2026-11-08-late","cancelled":true}'
```

**恢复**：同一 PATCH 传 `"cancelled": false`。

**补直播链接**：PATCH 只传 `url`；主键保持 `manual:<date>-<slot>`，链接只用于匹配与外链。

**删除手工行**：

```bash
curl -s -u "$AUTH" -X DELETE \
  "$BASE/api/admin/schedule?datasetId=nonoka&eventKey=manual%3A2026-11-08-late"
```

## 示例

**示例 1：官方一天的预告**

用户说：「按这个预告加：11/8 晚上ののか、11/9 早上りつ和みやこ」

操作：

1. 换算日期：`2026-11-08`、`2026-11-09`。
2. 三条 POST，均不带 `title`。
3. GET `from=2026-11-08&to=2026-11-09` 验证。
4. 回复表格，标题列写「待定」。

**示例 2：只知道某天有直播**

用户说：「10 号あられ有直播，时间不知道」

操作：

- 缺少时段时不能直接写；先问「早上、中午还是晚上？」再提交。
- 如果用户坚持不知道，先不写，说明日历需要时段才能定位。

**示例 3：改期**

用户说：「把 11/8 晚上ののか改到 11/9 晚上」

操作：

- 用 GET 找到 `eventKey`。
- PATCH 该行，传 `date: "2026-11-09"`、`slot: "late"`。
- 再 GET 确认。

## 故障排除

### 401

**原因**：用户名或密码不对，或线上/本地环境选错。

**解决**：重新从 `.dev.vars` 读取凭据；确认 `BASE` 指向正确环境。

### 503 管理端未配置

**原因**：部署环境没有配置管理端凭据。

**解决**：提示用户按 `.dev.vars.example` 配置后重启 dev 或更新 Worker secret。

### 404 日程不存在

**原因**：`eventKey` 写错，或该行已被删除。

**解决**：先 GET 列出当前行，复制准确的 `eventKey`。

### 409 自动同步的日程不能删除

**原因**：目标是 `source = youtube` 的自动行。

**解决**：不要删；等每日任务自己清理，或改用 PATCH 取消。

### 400 需要 date + slot

**原因**：只给了日期没有时段，也没有 `scheduledAt`。

**解决**：补 `slot`，或改用精确时间 `scheduledAt`。

## 安全

- 不在回复、日志或文件里暴露凭据。
- 不直接连数据库写 `scheduled_streams`。
- 删除前先 GET 确认 `eventKey`；优先用 `cancelled: true` 保留记录。
- 不修改 `streams` 或自动同步行。
