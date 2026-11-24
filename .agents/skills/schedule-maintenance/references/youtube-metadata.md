# YouTube 元信息补全

预告里带 `/watch` 或 `/live` 链接时才做这一步。目标：用视频的完整标题与精确开播时间覆盖推文文案。

```powershell
$url = 'https://www.youtube.com/live/z0GRgSUrY0A'
$meta = yt-dlp -J --skip-download --no-warnings --ignore-no-formats-error $url | ConvertFrom-Json

$meta.id, $meta.title, $meta.live_status, $meta.availability, $meta.channel_id, $meta.duration
[DateTimeOffset]::FromUnixTimeSeconds($meta.release_timestamp).ToOffset([TimeSpan]::FromHours(9)).ToString('yyyy-MM-ddTHH:mm:ss+09:00')
"now: " + [DateTimeOffset]::UtcNow.ToOffset([TimeSpan]::FromHours(9)).ToString('yyyy-MM-dd HH:mm')
```

- `--ignore-no-formats-error` 必加：未开播的直播没有格式，不加会报
  `This live event will begin in X hours` 且 stdout 为空。
- 先解析 `t.co`：`Invoke-WebRequest -Uri '<t.co>' -MaximumRedirection 5` 取最终 URL。
- 命中 bot 检查或会员限定场次时先导出登录态：`bun run ymmt tool cookies` 写出 `~/yt-cookies.txt`，
  命令加 `--cookies ~/yt-cookies.txt`；也可以 `--cookies-from-browser firefox`。
  cookie 文件是凭据，不要落进仓库或贴到回复里。
- 本地已装 `yt-dlp`（2026.10+）与 `deno`（解 JS challenge），无需额外安装。

## 先验真：元信息可能是占位值

未开播的直播页在正式排期前，YouTube 会返回**假排期**：`release_timestamp` 常是
`2028-01-01T23:30+09:00`、`2028-09-07T23:45+09:00` 这类固定值，`timestamp` 同理（epoch 落在 2024 年）。
照抄会把日程写到两年后。

每次拿到元信息都过一遍：

1. 把 `release_timestamp` 转 JST，与当前时间、推文预告日期对照。跨年或落在 2028 年初即判为占位。
2. 看 `live_status`：占位视频长期停在 `is_upcoming`，推文说的时间过了也不开播。
3. 占位时不要用它的时间，退回推文口径（`date + slot` 或 `HH:00`）；
   也不要把该视频当这一场的链接，链接要能对上内容与时间。
4. 判断今天真正在播哪场，看频道 `/streams` 里 `is_live` 的那条，用它的标题与 id 回填；
   `is_upcoming` 的占位条目一律忽略。

推文只给频道首页（`youtube.com/@xxx_yumemita`）而不是具体视频时，官方没给链接：
先按推文时间写入，标题留空；频道列表只用来确认是否已经开播，不是用来认领视频。

## 字段映射

| yt-dlp 字段 | 用法 |
| --- | --- |
| `title` | 直接作 `title`，保留完整标题，不改写、不截断 |
| `release_timestamp` | 验真后转成带 `+09:00` 的 ISO 时间作 `scheduledAt`；占位值不用 |
| `availability` | `subscriber_only` 原样传；`public` 可省略 |
| `duration` | 仅已结束场次有值；取分钟数作 `expectedMinutes`（15–720） |
| `channel_id` | 对照 `data-sources.json` 校验成员，防止贴错链接 |
| `live_status` | `is_upcoming` 正常录入；`is_live` / `was_live` 说明已开播或结束，不要再建未来场 |

## 兜底

命令非 0 退出、输出为空（bot 检查 / 区域限制 / 链接失效 / 非 YouTube 站点）时，
退回推文预告的标题与时间继续录入。不要为补元信息卡住日程。
