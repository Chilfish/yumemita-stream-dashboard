# datapack 数据包

一场直播归一化成一份 JSON：`yumemita.stream-datapack/v2`。字段与抓取口径以本文为准；
命令入口见 [../engineering/cli.md](../engineering/cli.md)。

产物写到本地暂存区 `data/<datasetId>/<videoId>.datapack.json`（已 gitignore），并更新该 dataset 的
本地 `manifest.json` 摘要。正式入库用 `bun run ymmt db ingest`，资产发布用
`bun run ymmt publish data --assets-only`。原始素材（视频 / 音频 / 弹幕回放 / 评论原文）不进本仓库。

## 会话目录结构

```
<会话目录>/
├── meta/info.json                    # yt-dlp -J 原样输出
├── danmaku/danmaku_<videoId>.jsonl   # 归一化弹幕
├── danmaku/<videoId>.live_chat.json  # 原始回放（补会员里程碑文案；可选）
├── danmaku/emoji_<videoId>.json      # 频道表情 id → 图片地址（归一化时生成）
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
| `total` / `byKind`                          | 全部条目数；`text` / `superchat` / `sticker` / `membership` / `gift`（赠送会员公告；领到的赠礼会员计入 `membership`） |
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
| `paid.memberships`                          | 会员里程碑（`header` 取自归一化弹幕的 `msg.header`，如「Welcome to …」；旧 jsonl 回退原始回放的 `headerSubtext`。领到赠礼时为 `received a gift membership by …`） |
| `paid.gifts`                                | 赠送会员公告：`at` / `author`（赠送方）/ `count`（个数）/ `text`（原文） |
| `paid.paidSharePct`                         | 付费条目占全部条目的比例                                                  |
| `topAuthors`                                | 发言数 Top 20（含 `authorId` / 各自 SC / 贴纸 / 会员次数）                |
| `topWords`                                  | 分词后词频（`Intl.Segmenter` 日语分词；≥3 次、最多 40 个；剔除英文虚词/寒暄词） |
| `authors`                                   | **v2 全量**：`author` / `authorId` / `messages` / SC / 贴纸 / 会员次数    |
| `wordCounts`                                | **v2 全量**：`{ 词: 次数 }`，不截断；跨场精确词频靠它；同样剔除英文虚词/寒暄词 |
| `hashtags`                                  | `#` / `＃` 标签计数                                                       |
| `emojiKinds`                                | 表情种类数 ＋ Top 15（频道表情的 id 形如 `<channelId>/<hash>`）           |
| `emojis`                                    | 本场频道专属表情的 `id` / `name` / `url`，供 `fetch:emoji` 镜像；旧 pack 缺失 |
| `ownerChats`                                | 主播本人发言明细（徽章 `Owner`），按时间顺序全量：`at` / `kind` / `text` / `emojis`；旧 pack 缺失 |
| `memberChats`                               | 其他团体成员的发言明细，按时间顺序全量：`at` / `memberId` / `memberLabel` / `author` / `authorId` / `kind` / `text` / `emojis`；身份按 `authorId` 匹配 `data-sources.json`，旧 pack 缺失 |

`derived`：

- `chatPer1000AvgViewers` — 弹幕条数 ÷ 平均同接 × 1000，跨场次比较「弹幕热不热」。
- `likesPer1000Views` — 点赞率（千分比）。
- `scPerHour` — SC 笔/小时。
- `vstatsVsYtdlpViews` — 两边播放数之差（快照时点不同，正常会有小幅差）。

## 口径与已知限制

- **时间一律 JST（UTC+9）**；`video.startedAt` 取 `release_timestamp`（开播），不是 `timestamp`（公开）。
- **纯表情**沿用归档工程 `scripts/danmaku` 的判定：`emoji.id` 含 `/` 的频道表情全部折成 `[表情]`，去掉后为空才算。
- **SC 金额不换算**：`¥ / HK$ / NT$ / MX$ / SGD / IDR …` 各记各的，合计只按币种分组（汇率随时变，不做隐含假设）。币种取金额原文里第一个数字之前的前缀，不做白名单。
- **只收 `addChatItemAction` 的事件**：banner / ticker 是同一事件的置顶与滚动副本，跳过避免重复；删除类 action 不回改已记录条数。Q&A、慢速模式、auto-mod 这类系统提示也不入库，但会按 renderer 类型计入归一化的 skipped 统计。
- **词频剔除英文虚词/寒暄词**：只剩助词/语尾的短平假名会被丢掉，`said` / `hi` / `the` 这类 token 走 `src/lib/stopwords.ts` 的停用词表；同义词、表记揺れ仍不合并。
- **频道表情只有重抓过弹幕的场次有**：图片地址来自原始回放的 emoji run；旧 pack 的 `chat.emojis` 缺失，页面退回 id 文本。
- **作者身份**：归一化弹幕带 `msg.authorId`（来自 `authorExternalChannelId`）。显示名会改、会重名，观众重叠按 ID 合并；旧 jsonl 没有该字段，需要重新归一化。
- **体积**：v2 每场多约 20–30 KB（全量词表 + 作者），只在单场页按需下载。
- **没有同接曲线**：VSTATS 只给平均/最大＋最大值时刻，YouTube 也不保存历史同接。
- **会员里程碑 ≠ 入会人数**：`liveChatMembershipItemRenderer` 与领取赠礼公告只记录直播中出现的那几条；没被领走的赠礼只在 `paid.gifts[].count` 里。
- **评论区口径**取决于抓取时的 `--write-comments` 上限，`comments.total` 是**抓到的**条数，不是视频的总评论数（后者看 `video.snapshot.comments`）。

