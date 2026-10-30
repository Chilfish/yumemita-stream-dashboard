# stream-datapack — 一场直播的归一化数据包

把**同一场直播**的四类数据合并成一份 JSON：

| 来源                     | 提供什么                                                                      |
| ------------------------ | ----------------------------------------------------------------------------- |
| yt-dlp 元信息            | 开播时刻・时长・标题・简介与简介外链・字幕/弹幕回放有无                       |
| 弹幕（`live_chat` 全量） | 条数・构成・时间分布・词频・SC / 贴纸 / 会员里程碑・参与人数                  |
| 评论区                   | 顶层评论・赞数・置顶・上传者发言                                              |
| VSTATS 快照              | 平均/最大同接・最大值时刻・视聴时间・播放・点赞（YouTube 自身不提供同接历史） |

产物写到本地暂存区 `data/<datasetId>/<videoId>.datapack.json`（已 gitignore），并更新该 dataset 的
本地 `manifest.json` 摘要。正式发布用 `bun run publish:data` 重建 manifest + insights 并上传对象存储。
原始素材（视频/音频/弹幕回放/评论原文）不进本仓库。

## 用法

```powershell
# 先按常规把素材抓进会话目录（meta / danmaku / comments / web）
bun scripts/stream-datapack.ts "D:/projects/claude-messages/temp/youtube-live/<日期>_<成员>_<videoId>"

# 并行抓完多场后一次生成（会自动按开播时间重排 manifest）
bun scripts/stream-datapack.ts <会话目录1> <会话目录2> ...

# 只预览、不碰 data/：写到别处且不更新 manifest
bun scripts/stream-datapack.ts <会话目录> --out <路径>

# 还没在 data-sources.json 登记频道时，强制指定 dataset
bun scripts/stream-datapack.ts <会话目录> --dataset nonoka --skip-index
```

| 选项 | 说明 |
| --- | --- |
| `--dataset <id>` | 强制指定 dataset；默认按 `info.channel_id` 匹配 `data-sources.json` |
| `--out <路径>` | 只写指定文件，不更新 manifest（单个会话） |
| `--vstats <路径>` | 手动指定 VSTATS HTML，默认自动找 `web/vstats_video_<id>.html`（单个会话） |
| `--skip-index` | 只写 datapack，不更新 manifest |
| `-h, --help` | 帮助 |

匹配不到 dataset 时退回旧行为：写到 `<会话目录>/work/stream-datapack.json`，并打印提示。

## 批量补齐历史场次

`fetch-streams.ts` 把「拉频道列表 → 抓 meta/弹幕/评论/VSTATS → 每 N 场生成 datapack」串起来，
可重入、并发、自动跳过已入库场次。

```powershell
# 原始素材放归档工程，datapack 仍自动写 data/nonoka/
bun scripts/fetch-streams.ts --dataset nonoka `
  --root "D:/projects/claude-messages/temp/youtube-live" `
  --concurrency 3

# 也可以把原始素材放本仓库（脚本会自动写 .gitignore，不会提交）
bun scripts/fetch-streams.ts --dataset nonoka --root .\temp\youtube-live
```

| 选项 | 说明 |
| --- | --- |
| `--dataset <id>` | dataset；只有一个时可以省略 |
| `--root <目录>` | **原始会话目录**（meta/danmaku/comments），不是 `data/`；默认 `$STREAM_SESSION_ROOT` 或 `./temp/youtube-live` |
| `--state-dir <目录>` | 进度/日志/频道缓存，默认 `<root>/.fetch-state` |
| `--concurrency <n>` | 媒体并发，默认 3 |
| `--meta-concurrency <n>` | 元信息并发，默认 6 |
| `--build-every <n>` | 每 n 场构建一次，默认 5 |
| `--limit <n>` | 本次最多处理 n 场（含元信息），用于试跑 |
| `--ids <文件>` | 直接读视频 ID 列表（每行一个），跳过频道列表抓取 |
| `--dry-run` | 只列出候选 |
| `--no-build` | 只抓素材 |
| `--restore` | 从对象存储恢复 manifest 与缺失的 datapack；本地没有 manifest 时默认开启 |
| `--no-restore` | 关闭自动恢复 |
| `--force <id[,id...]>` | 定点重抓这些场次（只跑它们，不补跑其他待抓场次）；可重复传，`all` = 全频道候选都重抓 |
| `--publish` | 抓完调用 `publish:data` 发布；有 `--force` 时默认开启 |
| `--no-publish` | 即使有 `--force` 也不发布 |

单场返工 / 修数据：

```powershell
# 重抓一场（meta → 弹幕 → 评论 → VSTATS → datapack），完成后自动增量发布
bun scripts/fetch-streams.ts --dataset nonoka --force 5xYz1234567

# 只发布本地 pack，不重抓
bun run publish:data --dataset nonoka
```

`--force` 只跑点名的场次（不拉频道列表、不补跑其他待抓场次），会先删掉该场的
`danmaku_*.jsonl` / 评论 / VSTATS / 「不可用」标记再抓，所以结果一定是这次新拉的；
同名/时长等去重规则对强制场次不生效。任一步失败时不会发布，避免把缺数据的 pack 推上去；
修好后手动跑 `bun run publish:data --dataset <id>` 即可。

监控：

```powershell
Get-Content -Wait "<root>/.fetch-state/fetch.log"
Get-Content "<root>/.fetch-state/fetch-progress.json"
```

- 已入库（manifest 或 `data/<id>/*.datapack.json` 里有的 videoId）直接跳过；已有 meta/jsonl/comments 也不会重抓。
- 未来场（`will begin in …`）记作「跳过」，不计失败、不阻塞后续场次。
- 同名短摘要/预告会让位正片；会员限定场次需要已登录的 Firefox cookie，或 `--cookies <jar>`。
- 频道 `/streams` 偶发 SSL 错误时会回退到 `<state-dir>/channel-ids.txt`；也可以用 `--ids`。

### 换设备 / 新环境

跳过判定依赖本地 `data/<id>/`，所以空环境直接续跑会把整个频道重抓一遍。脚本在本地没有
manifest 时会先恢复远端数据（`--restore` 可强制，`--no-restore` 可关闭）：

1. 按 `DATAPACK_BASE` / `VITE_DATAPACK_BASE` 的公开地址拉 `manifest.json`；
2. 拉不到的 pack 再从 `R2_*` 凭据读（需要 `R2_BUCKET`，可选 `R2_PREFIX`）；
3. 只下载本地缺失的 pack，已存在的不重复下载。

恢复后再按正常的「已入库 + 已有素材」逻辑跳过。公开地址要带桶内前缀，例如
`https://s3.example.com/stream-dashboard`。

## 封面图

`fetch-thumbnails.ts` 把每场直播的 YouTube 封面镜像到本地暂存区；页面运行时只读对象存储上的图，
**不直连 YouTube**（避免热链、CORS 与慢请求拖慢首屏）。

```powershell
bun run fetch:thumbs --dataset nonoka                   # 只补缺失
bun run fetch:thumbs --dataset nonoka --force           # 重抓全部
bun run fetch:thumbs --dataset nonoka --limit 20 --dry-run
```

| 选项 | 说明 |
| --- | --- |
| `--dataset <id>` | dataset；不传则处理 `data-sources.json` 里的全部 |
| `--limit <n>` | 本次最多抓 n 张（按 manifest 顺序，最近的场次优先）；0 = 全部 |
| `--force` | 已存在的封面也重新下载 |
| `--dry-run` | 只列出候选，不发请求、不写文件 |
| `--concurrency <n>` | 并发，默认 4（太高会被 YouTube 限流） |
| `-h, --help` | 帮助 |

- 场次列表取自 `data/<id>/manifest.json` 的 `streams[].videoId`；没有 manifest 时退回
  `data/<id>/*.datapack.json` 的文件名。
- 选图：`maxresdefault.jpg`（1280×720）→ `mqdefault.jpg`（320×180），两个都是真 16:9。
  不用 `hqdefault` / `sddefault`，它们是 4:3 letterbox，进页面会出现黑边。
- 校验：`content-type` 是 `image/*` 且字节数 > 1500（YouTube 偶尔回小占位图）；15 秒超时、失败重试 2 次。
- 单张失败只记日志，不阻塞其余场次；结束打印 `[fetch-thumbs] <id>：成功 N / 跳过 N / 失败 N / 变体 N`。
- 原子写入（`.tmp` → rename）：中断不会留下半张图被下次当成“已有”。
- 变体：每张原图用 `Bun.Image` 编码 480 / 960 / 1280w 的 WebP（quality 78，约 24 / 56 / 78 KB，
  原图约 144 KB）。只有原图（例如以前抓过的旧数据）时自动补齐，不重新下载；`--force` 才重编码。

本地与远端布局（key 由 dataset + videoId（+ 变体宽度）决定，不依赖 manifest，离线也能拼出 URL）：

```text
data/<datasetId>/thumbs/<videoId>.jpg          # 本地原图（data/ 整目录 gitignore）
data/<datasetId>/thumbs/<videoId>.<w>.webp     # 本地变体，w ∈ 480 / 960 / 1280
<base>/<datasetId>/thumbs/<videoId>.jpg        # 对象存储
<base>/<datasetId>/thumbs/<videoId>.<w>.webp   # 对象存储
```

`bun run publish:data` 的上传顺序是 **thumbs（原图 + 变体）→ pack → manifest / insights → index**：
先保证图在，manifest 里的 `thumbnail` 出现时就一定有对应文件与全部 `srcset` 候选。要下架某张图，
删掉本地文件后重跑发布即可；缺变体只警告，页面会退回原图。

页面侧约定：`src/lib/thumb-variants.ts` 定义宽度与命名，`src/lib/data.ts` 拼 `thumbnailUrl()` /
`thumbnailSrcSet()`，`StreamCover` 用 `srcset` + `sizes` 交给浏览器选档。

## 补缺失弹幕（v2 全量升级）

只抓 `live_chat` 回放，不重新抓 meta / 评论 / VSTATS；已有 pack 的其余字段原样保留。

```bash
# 1. 生成缺失清单（有弹幕、但本机没有 danmaku_<id>.jsonl）
bun scripts/missing-danmaku.ts --root "D:/projects/claude-messages/temp/youtube-live"

# 2. 只抓缺失弹幕；不带 --dataset 就是全部成员
bun scripts/fetch-danmaku.ts --root "D:/projects/claude-messages/temp/youtube-live" --concurrency 3

# 3. 用新弹幕把 v1 pack 升级成 v2
bun scripts/enrich-chat.ts --root "D:/projects/claude-messages/temp/youtube-live"

# 4. 重建 insights（本地；确认后再去掉 --no-upload 发布）
bun run publish:data --no-upload
```

多实例并行（互不重叠）：

```bash
bun scripts/fetch-danmaku.ts --root "..." --shard 1/4 --concurrency 3
bun scripts/fetch-danmaku.ts --root "..." --shard 2/4 --concurrency 3
bun scripts/fetch-danmaku.ts --root "..." --shard 3/4 --concurrency 3
bun scripts/fetch-danmaku.ts --root "..." --shard 4/4 --concurrency 3
```

- `--shard i/n` 按全局任务顺序取模分片，多个实例不会抢同一场；中断后重跑会跳过已有 jsonl。
- 建议总并发（实例数 × `--concurrency`）控制在 8–12，太高容易触发 YouTube 限流。
- 会员限定场次需要 Firefox cookie；默认 `--cookies-from-browser firefox`，也可 `--cookies <jar>`。
- 没有弹幕回放的场次会写 `work/chat-unavailable.txt`，下次跳过；失败写 `data/missing-danmaku/failed*.json`。
- `scripts/enrich-chat.ts` 只重算作者 / 词频 / 徽章 / 构成，保留 video / vstats / comments / density / paid。

早期 jsonl 缺 `authorId`（同一个人被拆成 `id:` / `name:` 两行）时，用原始回放补一次：

```bash
bun scripts/backfill-author-id.ts --root "D:/projects/claude-messages/temp/youtube-live"
bun scripts/enrich-chat.ts --root "D:/projects/claude-messages/temp/youtube-live" --force
bun run publish:data
bun run verify:data --remote
```

- `scripts/backfill-author-id.ts` 只重写缺少 `authorId` 的 jsonl，已有 ID 的默认跳过；条数应与原文件一致。
- `scripts/enrich-chat.ts --force` 会把已是 v2 的 pack 也用新 jsonl 重新聚合。

## 校验 v2 数据

`validate:data` 只检查文件存在与场次数；`verify:data` 检查内容是否自洽、发布是否真的生效。

```bash
bun run verify:data             # 本地：authors 求和、uniqueAuthors、insights 重算、coverage、authors.json
bun run verify:data --remote    # 再对比对象存储上的 insights / authors.json / 抽样 pack / manifest
```

- `authors.messages` 之和必须等于 `chat.total`，`authors.length` 必须等于 `uniqueAuthors`。
- `insights.topWords` / `topAuthors` 必须与直接重算 pack 的结果一致。
- `aggregation.coverage` 必须与 v2 场次数一致。
- `--remote` 会直接读桶（有 `R2_*`）或带时间戳走公开地址，避免被 CDN 旧缓存骗过去。

## 抓取侧（不在本仓库）

本仓库只放结果。原始会话由归档工程的 `yt-dlp` + `scripts/danmaku` 产出：

```powershell
$url = "https://www.youtube.com/watch?v=<videoId>"

# 元信息（评论另跑一次 --write-comments，原样存 comments_<id>.json）
yt-dlp -J --cookies-from-browser firefox $url > meta/info.json

# 弹幕回放 → 归一化 jsonl
yt-dlp --cookies-from-browser firefox --skip-download --write-subs --sub-langs live_chat `
  -o "danmaku/%(id)s.%(ext)s" $url
bun <归档工程>/scripts/danmaku/from-live-chat.ts danmaku/<videoId>.live_chat.json

# VSTATS 单场页
Invoke-WebRequest "https://www.vstats.jp/video/<videoId>" -OutFile web/vstats_video_<videoId>.html
```

YouTube 的 robot 检查会让不带 cookie 的 `yt-dlp -J` 失败；用已登录的 Firefox cookie 即可
（频道列表 `--flat-playlist` 不需要）。

## 会话目录结构

```
<会话目录>/
├── meta/info.json                    # yt-dlp -J 原样输出
├── danmaku/danmaku_<videoId>.jsonl   # 归一化弹幕
├── danmaku/<videoId>.live_chat.json  # 原始回放（补会员里程碑文案；可选）
├── comments/comments_<videoId>.json  # 评论区
└── web/vstats_video_<videoId>.html   # VSTATS 单场页快照（可选）
```

输入全部可选，缺哪块就跳过哪块；至少要 `meta/info.json`（里面要能读到 `id`）。

## 输出结构（`yumemita.stream-datapack/v2`）

> v2 在 v1 基础上追加 `chat.authors` / `chat.wordCounts` 与 `topAuthors[].authorId`；旧 v1 pack 仍可读取，跨场聚合会自动回退。

| 段         | 内容                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `video`    | id・标题・频道・开播/公开时刻（JST）・时长・结束时刻・简介・简介外链数组・章节・字幕与弹幕回放有无・抓取时点的播放/点赞/评论                |
| `vstats`   | 页面更新时刻・开始/结束・配信时长・`maxConcurrent` ＋ `maxConcurrentAt`・`avgConcurrent`・`watchTimeHours`・播放・点赞；没有快照时为 `null` |
| `chat`     | 见下表                                                                                                                                      |
| `comments` | 总数・顶层/回复数・置顶数・赞数合计・逐条（作者・赞・时刻・置顶・是否上传者・全文）                                                         |
| `derived`  | 派生比值（见下）                                                                                                                            |

`chat` 字段：

| 字段                                        | 含义                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| `total` / `byKind`                          | 全部条目数；`text` / `superchat` / `sticker` / `membership` 分项          |
| `pureEmojiOnly`                             | 只有频道表情的条目（与 `danmaku_*.txt` 头部的「已过滤」数一致）           |
| `uniqueAuthors` / `ownerMessages`           | 发言人数；主播本人发言数（徽章 `Owner`）                                  |
| `badges`                                    | 徽章分布（`Member` / `New member` / `Owner`…）                            |
| `timeRange`                                 | 首条/末条时刻 ＋ `preRollSec`（开播前待机所秒数）                         |
| `coveragePct`                               | 弹幕覆盖到的时长占比（用开播时刻对齐）                                    |
| `density.perMinute`                         | **逐分钟条数**（下标＝开播后第几分钟），画图直接用                        |
| `density.perMinuteSc`                       | 逐分钟 SC 笔数                                                            |
| `density.perFiveMinute` / `perTenMinute`    | 5 分/10 分汇总；10 分档带 `at` 时刻                                       |
| `density.peakMinute`                        | 条数最多的一分钟                                                          |
| `paid.superchats`                           | 全量 SC：时刻・金额原文・币种・数值・留言                                 |
| `paid.scTotalsByCurrency`                   | 分币种合计（**不换算汇率**）                                              |
| `paid.stickers` / `stickerTotalsByCurrency` | 贴纸同上                                                                  |
| `paid.memberships`                          | 会员里程碑（`header` 取自原始回放的 `headerSubtext`，如「Welcome to …」） |
| `paid.paidSharePct`                         | 付费条目占全部条目的比例                                                  |
| `topAuthors`                                | 发言数 Top 20（含 `authorId` / 各自 SC / 贴纸 / 会员次数）                |
| `topWords`                                  | 分词后词频（`Intl.Segmenter` 日语分词；≥3 次、最多 40 个）                |
| `authors`                                   | **v2 全量**：`author` / `authorId` / `messages` / SC / 贴纸 / 会员次数    |
| `wordCounts`                                | **v2 全量**：`{ 词: 次数 }`，不截断；跨场精确词频靠它                     |
| `hashtags`                                  | `#` / `＃` 标签计数                                                       |
| `emojiKinds`                                | 表情种类数 ＋ Top 15（频道表情的 id 形如 `<channelId>/<hash>`）           |

`derived`：

- `chatPer1000AvgViewers` — 弹幕条数 ÷ 平均同接 × 1000，跨场次比较「弹幕热不热」。
- `likesPer1000Views` — 点赞率（千分比）。
- `scPerHour` — SC 笔/小时。
- `vstatsVsYtdlpViews` — 两边播放数之差（快照时点不同，正常会有小幅差）。

## 口径与已知限制

- **时间一律 JST（UTC+9）**；`video.startedAt` 取 `release_timestamp`（开播），不是 `timestamp`（公开）。
- **纯表情**沿用归档工程 `scripts/danmaku` 的判定：`emoji.id` 含 `/` 的频道表情全部折成 `[表情]`，去掉后为空才算。
- **SC 金额不换算**：`¥ / HK$ / NT$ / ₩` 各记各的，合计只按币种分组（汇率随时变，不做隐含假设）。
- **词频不做语义过滤**：只剩助词/语尾的短平假名会被丢掉，但同义词、表记揺れ不会合并。
- **作者身份**：归一化弹幕带 `msg.authorId`（来自 `authorExternalChannelId`）。显示名会改、会重名，观众重叠按 ID 合并；旧 jsonl 没有该字段，需要重新归一化。
- **体积**：v2 每场多约 20–30 KB（全量词表 + 作者），只在单场页按需下载。
- **没有同接曲线**：VSTATS 只给平均/最大＋最大值时刻，YouTube 也不保存历史同接。
- **会员里程碑 ≠ 入会人数**：`liveChatMembershipItemRenderer` 只记录直播中出现的那几条。
- **评论区口径**取决于抓取时的 `--write-comments` 上限，`comments.total` 是**抓到的**条数，不是视频的总评论数（后者看 `video.snapshot.comments`）。
