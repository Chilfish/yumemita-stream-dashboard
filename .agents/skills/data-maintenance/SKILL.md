---
name: data-maintenance
description: 补抓、新增、重抓单场直播数据并同步到本地库、线上 Neon 与 R2：按场次归属和已有数据判断该用 data official、data fetch、data refetch、db ingest、publish push 还是 publish sync，跑完做对账与页面验证。当用户提到「补数据」「补抓这一场」「加一场」「入库」「推送到线上」「同步数据」「重抓」「线上没有这场」时使用。
metadata:
  internal: "true"
  version: "1.0.0"
---

# 直播数据维护

数据只从 `data/<dataset>/*.datapack.json`（本地 pack）派生：pack → 本地 PostgreSQL → 线上 Neon + R2。
所有写入都走 `bun run ymmt <group> <command>`，不要手改 pack、不要直接连库改行。

## 何时使用

- 给某个视频补数据（成员频道新场、第三方官方账号联动场）
- 本地已有 pack，要推到线上
- 线上缺场次、缺封面、页面打不开某一场
- 重抓已有场次（补弹幕 / 评论 / VSTATS）

未来日程（还没开播的排期）不属于这里，用 [schedule-maintenance skill](../schedule-maintenance/SKILL.md)。

## 先判断两件事

### 1. 场次归谁

| 频道 | dataset | 判断方式 |
| --- | --- | --- |
| 5 位成员频道 | `nonoka` / `arale` / `ritsu` / `miyako` / `yuno` | `channelId` 匹配 `data-sources.json` |
| 团体号 `@BDP_yumemita` | `yumemita` | 同上 |
| 企划母频道 | `bangdream` | `sync=manual`，只能手动加 |
| 其他第三方账号 | `other`（聚合） | `data official` 默认落到这里 |

用 yt-dlp 确认频道与状态（cookie 由脚本自动从 firefox 导出，也可手动指定）：

```powershell
yt-dlp --cookies "$env:USERPROFILE\yt-cookies.txt" --ignore-no-formats-error --skip-download `
  --print "%(id)s|%(title)s|%(channel)s|%(channel_id)s|%(live_status)s|%(release_timestamp)s|%(availability)s" '<URL>'
```

`live_status` 为 `is_upcoming` / `is_live` 时拒绝入库：走日程维护，等结束后再补。

### 2. 现在到哪一步

| 现状 | 做法 |
| --- | --- |
| 只有链接，什么都没抓 | 见「工作流 A / B」 |
| 本地 pack 有、本地库没/旧 | `db ingest --dataset <id>` |
| 本地都齐、线上缺 | `publish push <视频>`（单场）或 `publish sync`（批量） |
| 线上有、本地库缺（换机 / 回滚） | `db pull` |
| 需要重新抓素材 | `data refetch <视频>` |

## 工作流 A：成员频道场次

```bash
# 单场（先小批量验证再放开）
bun run ymmt data fetch --dataset nonoka --limit 3
bun run ymmt data fetch --dataset nonoka

# 每日增量（只碰 sync=channel / filtered 的账号）
bun run ymmt data update
```

`fetch` 会把素材抓到 `temp/youtube-live/<日期>_<label>_<videoId>/`，并在 `data/<dataset>/` 生成 pack 与 manifest。
`--force <videoId>` 强制重抓某一场；`--no-publish` 只落本地。

`fetch` 对「本地已有 pack」的场次默认跳过。补素材（弹幕回放、评论、封面）要用 `data refetch <视频>`，
重复跑 `data official` / `data fetch` 不会重抓。

## 工作流 B：官方 / 第三方账号场次

参与者必须显式给，标题与简介都不可靠（团体号 71 场标题只有 1 场写人名）：

```bash
bun run ymmt data official "<链接>" --participants all
bun run ymmt data official "<链接>" --participants yuno
bun run ymmt data official "<链接>" --participants arale,nonoka --dataset bangdream
bun run ymmt data official "<链接>" --participants all --dry-run
bun run ymmt data official "<链接>" --participants all --no-online   # 只写本地
```

- 默认落到 `other`，再把 `videoId → participants` 写进 `content/collaborations.json`。
- 指向成员频道会直接报错：成员频道的联动改用 `content/collaborations.json` 登记或 `data refetch`。
- 顺序：元信息 → 登记 → fetch → 本地 ingest → 线上 ingest → verify → publish → purge。
- 长期单独归档的第三方账号（如某个商店号会一直播），先在 `data-sources.json` 加一条 `kind: official` 的 dataset，再用 `--dataset <id>`。

## 工作流 C：只补某一类数据

```bash
bun run ymmt data vstats --dataset <id>     # VSTATS 单场页快照
bun run ymmt data thumbnails --dataset <id> # 封面镜像与 480/960/1280w WebP
bun run ymmt data danmaku --dataset <id>    # 补缺失的弹幕 jsonl
bun run ymmt data live-chat --help          # 实时聊天采集（直播中）
```

命令参数以 `--help` 为准；这些命令只改本地素材与 pack，入库与发布仍按工作流 D。

## 工作流 D：本地已齐，推线上

单场（pack 已在，不重抓）：

```bash
bun run ymmt publish push <视频或链接> --dry-run   # 看归属 + 线上是新增还是覆盖
bun run ymmt publish push <视频或链接>             # 线上 ingest → 汇总 → verify → publish → purge
```

批量（例如一次导入了多场）：

```bash
bun run ymmt publish sync --dataset <id> --recent-days 0 --dry-run
bun run ymmt publish sync --dataset <id> --recent-days 0
```

`publish sync` 的候选窗口默认只认最近 7 天开播的 pack，历史场次必须 `--recent-days 0`；
已有场次默认不读不写，要按 hash 刷新加 `--update-existing`。

## 工作流 E：重抓已有场次

```bash
bun run ymmt data refetch "<链接或 ID>"
bun run ymmt data refetch "<链接或 ID>" --no-online   # 只改本地
```

会重抓素材 → 重建 pack → 本地 ingest → 线上 ingest → verify → publish → purge。
只是弹幕 / 评论 / VSTATS 有增量时用它；只想把现有 pack 推线上用工作流 D。

## 验证

```bash
bun run ymmt db verify --dataset <id>            # 库与 pack 字段级对账
bun run ymmt validate data                       # 本地 pack schema
bun run ymmt validate content                    # 数据自洽 + 远端对象可达
```

页面侧至少确认一场能打开（线上带 `--dry-run` 之外的真实请求）：

```powershell
$r = Invoke-WebRequest -Uri 'https://ymmt.chilfish.top/<dataset>/stream/<videoId>' -UseBasicParsing
$r.StatusCode; $r.Content -match '<标题里的片段>'
```

verify 有差异先看是不是 pack 在 ingest 之后又被改；重跑 `db ingest` 再 verify，不要手改库。

## 收尾

- 例行补数据不写 `docs/development-log/`、不改 backlog；只有改脚本 / 发现数据异常时才留痕。
- `data/` 不进 git；`content/collaborations.json` 进 git——`data official` 改过它就提交（只提交这一个文件，别带上工作区其他人的改动）。
- 线上写入只认 `.dev.vars.prod`，执行期间强制 `LOCAL=0`；`DATABASE_URL` 指向本机时命令会拒绝执行。

## 常见错误

### `Sign in to confirm you're not a bot`
cookie 失效或没导出。脚本默认从 firefox 导出到 `~/yt-cookies.txt`；换浏览器用 `--cookies-from-browser <browser>`，已有 jar 用 `--cookies <path>`，完全公开的场次才用 `--anonymous`。

### `Requested format is not available` / 只有 `sb0`-`sb3`
n-challenge 没解出来，视频格式只剩 storyboard。只取元信息的 `-J`、以及 `--skip-download --write-subs --sub-langs live_chat` 的弹幕下载，都必须带 `--ignore-no-formats-error`（`fetch` / `official` / `refetch` 已内置）；自己临时跑 yt-dlp 时也要加。

症状：fetch 日志出现 `chat failed ... Requested format is not available`，pack 里 `chat.total = 0` 但 `hasLiveChatReplay = true`。修好后用 `data refetch <视频>` 补弹幕。

### 入库后提示「manifest 里有 N 场标了封面但本地没有图片」
封面没镜像。先 `bun run ymmt data thumbnails --dataset <id>`，再 `publish push <视频>` 或 `publish data --dataset <id>` 上传。

### `publish sync` 显示「新增 0」但线上确实没有
候选窗口默认最近 7 天。加 `--recent-days 0`，或改用 `publish push <视频>`。

### 页面还是旧的
缓存没失效。确认命令最后一步 purge 成功（HTTP 200）；手动补：

```bash
bun run ymmt publish purge --dataset <id> --video <videoId>
```

### `data official` 报「成员频道不能用官方场次管线」
该频道属于成员。用 `data refetch`，或在 `content/collaborations.json` 登记参与者后跑 `db ingest`。

### 封面 404 / 只有占位图
对象存储没传。`bun run ymmt publish data --dataset <id> --ids <文件>` 补传；`--assets-only` 只传资产不写索引。

### 本地库和线上对不上
方向判断错：线上是权威源时用 `db pull`（线上 → 本机），本机是权威源时用 `publish push` / `publish sync`（本机 → 线上）。
