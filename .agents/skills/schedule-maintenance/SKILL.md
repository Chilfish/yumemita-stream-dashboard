---
name: schedule-maintenance
description: 维护 夢限大みゅーたいぷ 直播日程：把官方预告或成员排期转成未来日程，在本地或线上站点新增、修改、取消、删除并验证；支持成员频道与第三方官方账号的联动场。当用户提到「加日程」「录日程」「改日程」「直播预告」「朝活」「日程维护」「这周谁播」时使用。
metadata:
  internal: "true"
  version: "2.0.0"
---

# 直播日程维护

通过站点的 `/api/admin/schedule` 维护未来日程。不要直接写数据库，不要改 `streams`。

## 何时使用

- 用户给出推文、海报或口头排期，要求排进日历
- 修改已排日程的日期、时段、标题、链接或取消状态
- 查询今天、明天或某段日期的直播安排

## 硬性规则

- 日期与时间一律 JST（UTC+9）。
- 只知道「早上 / 中午 / 晚上」时传 `date + slot`，不要编造精确时间。
- `title` 没有可靠来源就省略，页面显示「待定」；不要写「未定」「直播」之类的占位。
- 新建一律 `"source": "manual"`；请求体**不要包含 `videoId`**，需要链接时只填 `url`。
- 不创建 `source = youtube` 的行，不删除自动同步行。
- 改到已被占用的日期/时段返回 `409`：先 GET 确认占用行，不要反复重试。
- 所有凭据只从 `.dev.vars` 读取，不在回复、日志或文件里输出。

## 工作流

### 1. 确定目标环境

- **本地**：`http://localhost:4321`。未启动时运行 `bun run ymmt dev server`
  （`bun run dev` 只打印子命令帮助；起完等到 4321 返回 401 才算就绪）。
- **线上**：`.dev.vars` 的 `SITE_URL`，例如 `https://ymmt.chilfish.top`。
- 默认跟随用户当前上下文：刚在本地改过数据就写本地，明确说线上才写线上。
- 从 `.dev.vars` 读 `ADMIN_USER` / `ADMIN_PASSWORD`，组合成 Basic 认证头。

### 2. 把预告转成字段

成员：

| 预告里的写法 | datasetId |
| --- | --- |
| ののか / 宫永 / 宮永 | nonoka |
| あられ / 仲町 | arale |
| りつ / 峰月 | ritsu |
| みやこ / 藤都子 | miyako |
| ゆの / 天野 | yuno |

官方账号：

- 团体号 `@BDP_yumemita` 的场次归 `yumemita`。
- 企划母频道 `@bang_dream_official` 的场次归 `bangdream`。
- 其他第三方账号的联动场归聚合账号 `other`，`participants` 填在场的成员 id。
- 官方账号场次的 `participants` 表示「成员在场」，不会并入成员个人场次。
- 目标库没有该 dataset 时接口返回 404：不要临时造账号，确认 ingest 或改用已有账号。

时段：

| 文案 | slot | JST 范围 |
| --- | --- | --- |
| 早上 / 早 / 朝活 | early | 05:00–11:59 |
| 中午 / 中 / 昼 | mid | 12:00–17:59 |
| 晚上 / 晚 / 夜 | late | 18:00–次日 04:59 |

日期与数量：

- 把「11/8」「11月8日」「明日」换算成 `YYYY-MM-DD`；跨天朝活按预告的「明天」取日期。
- 同一成员同一天可以早晚各一场，分别提交 `early` 与 `late`。
- 同一天同一时段两场就提交两次，服务端按标题与时间顺延到 `manual:<date>-<slot>-2`。

标题：

- 预告已经写了标题就原样使用（含副标题、活动名、企划名）；「朝活」「歌枠」「ゲーム」只是分类标签，不能顶替标题。
- 会员限定（会限 / メン限）标题统一写「会限」，可见性由 `availability: "subscriber_only"` 表达。
- 有固定系列名的沿用上一条并顺延期数：りつ「りっちゃんズ集会」、nonoka「でかいぬしゅうかい」、
  miyako「みやこの部屋」；yuno 用「会限」。
- 推文里的频道首页链接（`youtube.com/@xxx`）不是具体视频，不能据此认领 `url`。

类型 `kind`：

| 预告内容 | kind |
| --- | --- |
| 歌枠 / 弾き語り / 歌回 | sing |
| 雑談 / トーク / 朝活聊天 | talk |
| ゲーム / 実況 / ゲーム配信 | game |
| 活动 / 告知 / 纪念 / 联动 | event |

不确定就省略，服务端会按标题推断。

### 3. 补 YouTube 元信息

预告带 `/watch` 或 `/live` 链接时，先解析 `t.co`，再用 yt-dlp 取完整标题、`release_timestamp`、
`availability`、`live_status`。**必须验真占位时间**，否则会把日程写到 2028 年。

```powershell
$meta = yt-dlp -J --skip-download --no-warnings --ignore-no-formats-error '<URL>' | ConvertFrom-Json
$meta.id, $meta.title, $meta.live_status, $meta.availability, $meta.channel_id
[DateTimeOffset]::FromUnixTimeSeconds($meta.release_timestamp).ToOffset([TimeSpan]::FromHours(9)).ToString('yyyy-MM-ddTHH:mm:ss+09:00')
```

占位值、cookie、字段映射与兜底规则见 [references/youtube-metadata.md](references/youtube-metadata.md)。

### 4. 写入并验证

```bash
BASE="http://localhost:4321"
AUTH="$ADMIN_USER:$ADMIN_PASSWORD"

curl -s -u "$AUTH" \
  -H "content-type: application/json" \
  -X POST "$BASE/api/admin/schedule" \
  -d '{"datasetId":"ritsu","title":"歌枠","date":"2026-11-09","slot":"early","kind":"sing","source":"manual"}'
```

```bash
curl -s -u "$AUTH" "$BASE/api/admin/schedule?from=2026-11-08&to=2026-11-09"
```

确认 `date` / `slot` / `title` 与预告一致，`timeTentative=false`（有 yt-dlp 元信息时），
`state` 为 `upcoming` / `live` / `done` / `cancelled` / `pending`。
接口字段、PATCH / DELETE 与状态含义见 [references/api.md](references/api.md)。

### 5. 回复用户

用紧凑表格列出：日期、时段、成员或账号、标题（空则「待定」）、状态。

## 按需阅读

| 文件 | 何时读 |
| --- | --- |
| [references/api.md](references/api.md) | 需要拼请求体、处理 401/404/409、改期 / 取消 / 删除，或核对返回字段时 |
| [references/youtube-metadata.md](references/youtube-metadata.md) | 预告带 YouTube 链接、yt-dlp 拿到的时间可疑、或需要 cookie 时 |
| [references/examples.md](references/examples.md) | 拿不准某类输入怎么落字段时，先看有没有同类示例 |

## 常见错误

### 401 未认证
用户名或密码不对，或本地/线上选错。重新从 `.dev.vars` 读取凭据，确认 `BASE`。

### 503 管理端未配置
部署环境缺少管理端凭据。按 `.dev.vars.example` 配置后重启 dev 或更新 Worker secret。

### 404 datasetId 不存在
目标库还没有这个账号。确认 `db ingest` 已写入，或改用已有账号；不要临时造 dataset。

### 404 日程不存在
`eventKey` 写错或已被删除。先 GET 列出当前行，复制准确 `eventKey`。

### 409 自动同步的日程不能删除
目标是 `source = youtube` 的行。不要删，改用 PATCH 取消或等每日任务清理。

### 409 目标日期时段已占用
先 GET 确认占用的是哪一场。同一场就合并，另一场就换时段或顺延序号。

### 400 需要 date + slot
只给了日期没有时段，也没有 `scheduledAt`。补 `slot` 或改用精确时间。

### 日程被写到两年后
用了占位 `release_timestamp`。按 [references/youtube-metadata.md](references/youtube-metadata.md) 判定占位后用推文口径重排；
已写入的行 PATCH `scheduledAt`，并把错的 `url` 清成 `null`。

## 留痕与安全

日程录入是例行数据操作：**不写 `docs/development-log/`、不 commit、不更新 backlog**，做完给表格即可。

只有改代码、发现数据异常（占位值、错成员、线上报错）或需要新约定时才写日志并提交。

- 不直接连数据库写 `scheduled_streams`。
- 删除前先 GET 确认 `eventKey`；优先 `cancelled: true` 保留记录。
- 不修改 `streams` 或自动同步行。
