# 弹幕查看器：现有链路调研与新项目设计

> 调研日期：2026-11-24。回答两个问题：本仓库现在怎么获取弹幕与事件；如果要另起一个不与本站耦合的弹幕查看器，数据该长什么样、存在哪、怎么展示。
>
> 本文分两部分：第一节到第九节记录现状与实测（以当前代码为准）；第十节之后是给新项目的方案，标注为「提议」，未实现。
>
> 术语说明：本仓库没有 B 站通道，也不抓 B 站弹幕。下文「弹幕」一律指 YouTube 直播聊天（`live_chat`），「事件」指不进入消息流的聊天动作（置顶、投票、删除等）。B 站的「上舰 / 关注 / PK」在 YouTube 体系里对应会员、赠送会员与领取赠礼，没有关注事件，也没有 PK。

## 一、结论摘要

- **采集**：纯 `fetch` + InnerTube 私有 JSON API，没有 WebSocket、没有 protobuf、没有 `.cc` 文件。实时走 `get_live_chat` 轮询，回放走 `get_live_chat_replay` 翻页，失败的场次回退到 yt-dlp 的 `live_chat` 字幕。
- **落盘**：原始明细是 JSONL，只留在本地会话目录。**全量弹幕从未入过库，也没上过对象存储**。PostgreSQL 里只有聚合、Top 列表、主播发言、成员发言和事件；R2 里只有 pack 归档、封面、表情、逐字稿。
- **量级**：2,018 场、约 726 万条消息、约 3,270 小时素材。单场典型 1,300–5,200 条，最大 15,933 条，峰值 1,161 条/分钟。
- **存储结论**：Neon PostgreSQL 装得下这批数据（估算 1.5–2.5 GB），查询也不慢；真正的成本是每次打开一场要传几 MB JSON，以及免费档存储不够。SQLite 性能更好，但做成 Web 后没有「一台常驻机器」，需要 D1、Turso 或自建 VPS 才能在线。**提议按冷热分开：明细包放对象存储，目录与聚合放小库。**
- **展示形态**：浮动 overlay 只在回放能精确对齐；直播无法做到真正同步，只能按到达时间滚。聊天列、时间轴加热力、高光摘要这三种更稳，可以组合。

## 二、现状：采集链路

### 2.1 协议与端点

定义在 `scripts/lib/innertube-live.ts`：

```ts
export const WATCH_URL = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}&hl=en`
export const LIVE_CHAT_API_URL = 'https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false'
export const LIVE_CHAT_REPLAY_API_URL = 'https://www.youtube.com/youtubei/v1/live_chat/get_live_chat_replay?prettyPrint=false'
```

流程：GET watch 页 → 正则抠 `ytInitialData` / `ytInitialPlayerResponse` → 从 `liveChatRenderer.continuations` 取 continuation token → POST `{ context: INNERTUBE_CONTEXT, continuation }` 轮询。

三个必须照抄的细节：

1. 请求头必须带完整 Chrome UA 加 `hl=en`，否则 YouTube 返回精简页，**没有 `liveChatRenderer`**，取不到 token。
2. continuation 优先级是 `reload → timed → invalidation → replay`。等待室只给 `reloadContinuationData`，只认 timed 会拿不到历史。
3. `LIVE_STREAM_OFFLINE` 属于 `pending`，不是终态；等待室的聊天此时已经可以采集。

### 2.2 实时采集

入口 `bun run ymmt data live-chat --video <id>`，实现分两层：

| 文件 | 作用 |
| --- | --- |
| `scripts/commands/data/live-chat.ts` | CLI、参数、批量与中断处理 |
| `scripts/lib/live-chat-collect.ts` | 轮询循环、续跑、自动转回放 |

轮询间隔由平台返回的 `timeoutMs` 决定，`pollDelayMs()` 把它夹到 `[minMs, maxMs]`，默认 1000–15000 ms，没有值时用 5000 ms。

停止条件：直播结束（自动转回放）、聊天被禁用、播放器受限且无 token、`--max-hours` 到点、Ctrl-C。

### 2.3 回放采集

InnerTube 回放是默认路径，匿名可用。watch 页 `liveChatRenderer.isReplay === true` 时，用 `reloadContinuationData` 打 `get_live_chat_replay`，从头翻完。

- 一页约 50 条消息，对应 5 秒窗口。两小时的场次约 400 页。
- 续页**只认 `liveChatReplayContinuationData`**；`playerSeekContinuationData` 是「跳到某播放进度」，不是下一页，用它会把同一窗口重复取回来。
- 回放首屏的 `Live chat replay is on` 是播放器提示，用 `REPLAY_NOTICE_RE = /live chat replay is on/i` 过滤，不写入事件文件。

### 2.4 yt-dlp 回退

`bun run ymmt data danmaku` 默认 `--engine auto`：先试 InnerTube 回放，失败或没有回放时回退 yt-dlp。

```bash
yt-dlp --cookies-from-browser firefox --skip-download --write-subs \
  --sub-langs live_chat -o "danmaku/%(id)s.%(ext)s" <URL>
```

yt-dlp 路径**只有消息，没有事件**。会员限定场次需要 cookie。归一化实现在 `scripts/lib/live-chat.ts` 的 `normalizeLiveChat()`，输入结构是 `{ replayChatItemAction: { actions: [{ addChatItemAction: { item } }] } }`。

### 2.5 命令树

| 命令 | 场景 |
| --- | --- |
| `bun run ymmt data live-chat --video <id>` | 等待室 / 直播中跟随 |
| `bun run ymmt data live-chat --video <id> --once` | 只取一页，不触发完整回放 |
| `bun run ymmt data live-chat --dataset <id> --ids <file> --max-hours 3` | 批量跟随 |
| `bun run ymmt data danmaku --dataset <id> --video <id>` | 单场补弹幕，`--engine auto\|innertube\|yt-dlp` |
| `bun run ymmt data danmaku --dataset <id> --limit 20 --concurrency 3` | 按缺失清单批量补 |
| `bun run ymmt data danmaku --dataset <id> --shard 1/4` | 多实例取模分片 |
| `bun run ymmt data datapack <会话目录>` | jsonl → pack |

`RunDanmakuOptions`：`dataset[] / root / video[] / ids / concurrency(3) / limit / shard / engine(auto) / force / keepRaw / cookie / cookies / cookiesFromBrowser / pageDelay(150ms) / maxPages / noResume / noForceIpv4 / dryRun`。

### 2.6 会话目录与产物

```text
<SESSION_ROOT>/<YYYY-MM-DD JST>_<成员label>_<videoId>/
├── meta/info.json                       yt-dlp -J 原样输出
├── danmaku/
│   ├── danmaku_live_<videoId>.jsonl     实时采集（等待室 + 直播中）
│   ├── danmaku_<videoId>.jsonl          回放 / 合并后的最终消息
│   ├── events_<videoId>.jsonl           非消息事件
│   ├── emoji_<videoId>.json             本场表情
│   └── <videoId>.live_chat.json         yt-dlp 原始字幕（默认删，--keep-raw 保留）
├── comments/comments_<videoId>.json
├── web/vstats_video_<videoId>.html
└── work/
    ├── live-chat-state.json             实时采集状态
    ├── replay-state.json                回放分页状态
    ├── chat-unavailable.txt             平台未保留回放的哨兵
    └── vstats-unavailable.txt
```

`SESSION_ROOT` 默认 `$STREAM_SESSION_ROOT` 或 `./temp/youtube-live`。代码里强制禁止指向 `data/`。当前仓库实际有 1,994 个会话目录。

### 2.7 断点续跑与去重

**状态文件**：`work/live-chat-state.json` 记录 `continuation / continuationKind / lastSeq / stored / eventsStored / duplicates / polls / disposition / status / lastError / stopReason`，用 tmp 文件加 rename 原子替换。重跑时恢复 continuation 与计数，同时重建 `seen` 集合。

**去重**：`scripts/lib/danmaku-merge.ts` 的 `DanmakuKeySet`：

```ts
export function danmakuKey(record: DanmakuKeySource): string {
  const rendererId = text(record.rendererId)
  if (rendererId) return `id:${rendererId}`
  return contentKey(record) // raw:${timestampUs}|${authorId}|${author}|${kind}|${text}|${header}
}
```

关键约束：**带 `rendererId` 的记录不把内容键放进集合**。同一作者在同一秒发两条相同正文（常见于纯表情消息 `text: ""`）时，id 不同但内容键相同，按内容键去重会误删。没有 id 的旧记录只能按内容键。

**合并**：`mergeDanmakuRecords()` 按 `ts` 升序排序后 `seq` 从 1 重编；事件按 `at` 升序重编；同一秒内消息在前、事件在后。

### 2.8 错误分类与哨兵

`classifyChatError()` 把错误分四类：

| 分类 | 处理 |
| --- | --- |
| `members_only` / `chat_disabled` / `ended` | 停止 |
| `rate_limited` / `transient` | 清 continuation、指数退避（起始 2000 ms，上限 60000 ms）、重抓 watch 页 |

其他机制：

- 没有 continuation 时退避重抓 watch 页，最长 60 秒一次。
- 每 10 分钟重新检查 watch 页，防止等待室的 timed 链在直播结束后一直给空页。
- `SIGINT` 只置 `running = false`，循环退出后保存状态。
- 回放分页重试 5 次，只对 429 / 5xx / 网络错误重试，4xx 直接抛。
- 续页 token 过期（400/403/404/410）时从 watch 页重取一次 token、`pages = 0` 重翻，靠去重挡住重复。
- 哨兵 `chat-unavailable.txt` / `vstats-unavailable.txt` 有 30 天 TTL，过期后重新尝试，避免一次临时失败变成永久跳过。
- cookie 每次运行默认重新从浏览器导出，因为浏览器会轮换 `__Secure-*PSIDTS`；只使用 youtube.com 域的 cookie，混入 google.com 的 `NID` / `SIDCC` 会触发降级页。

## 三、现状：消息与事件的记录格式

字段级字典见 [../data/chat-events.md](../data/chat-events.md)，这里只列与新项目建模相关的部分。

### 3.1 消息 `ChatRecord`

定义在 `scripts/lib/live-chat.ts`：

```ts
export interface ChatRecord {
  seq: number
  video: string
  ts: number          // Unix 秒 = timestampUsec / 1e6
  rendererId?: string // 平台稳定 id，跨实时 / 回放 / yt-dlp 相同，去重主键
  msg: {
    author?: string
    authorId?: string
    text?: string
    sc?: string | null
    kind: 'text' | 'superchat' | 'sticker' | 'membership' | 'gift' | 'giftRedemption'
    timestampUs?: string
    emoji?: { id: string }[]
    badges?: string[]
    header?: string
    membershipPrimary?: string
    memberMessage?: boolean
    colors?: ChatPaidColors
    sticker?: ChatStickerAsset
    giftCount?: number
  }
}
```

真实一行：

```json
{"seq":3,"video":"fmjJNbzcr3g","ts":1793792396,"msg":{"author":"@steinberg11","text":"おたんじょうび、おめでとうがらし","kind":"superchat","sc":"¥10,059","timestampUs":"1793792396418164","colors":{"headerBackground":4291821568,"headerText":4294967295,"bodyBackground":4293271831,"bodyText":4294967295,"authorName":3019898879,"timestamp":2164260863},"authorId":"UC4hcOoWhQN2W1tSBu-r1t3g","emoji":[{"id":"㊗"},{"id":"🎊"},{"id":"UC99kOG6_9RD0mR3OG4EOfxw/54y5aK3nFd-QoPwPxrGNqQk"}],"badges":["New member"]},"rendererId":"ChwKGkNPX3htYkdkN3BjREZhbnI1d01kWTljZUdn"}
```

注意这行暴露的现状问题：`text` 里只有文字，频道表情单独放在 `emoji` 数组，**句中位置丢失**。`@steinberg11` 这条的「おたんじょうび、おめでとうがらし」后面接的 🎊 到底在哪个字之后，记录里还原不出来。

`colors` 全部是 YouTube 原始 ARGB 无符号 32 位整数，转 CSS 用 `rgba(r, g, b, a/255)`：

| 字段 | 用途 |
| --- | --- |
| `headerBackground` | SC 头部 / 等级色 |
| `headerText` | SC 头部文字 |
| `bodyBackground` / `bodyText` | SC 正文底色 / 文字 |
| `authorName` / `timestamp` | 作者名 / 时间颜色 |
| `moneyChipBackground` / `moneyChipText` | 贴纸金额 chip |
| `background` | 贴纸整行底色 |

`kind` 的分类规则：

| `kind` | 来源 renderer | 说明 |
| --- | --- | --- |
| `text` | `liveChatTextMessageRenderer` | 普通文字 / 表情 |
| `text` + `memberMessage: true` | `liveChatMembershipItemRenderer` 且 `message` 有正文 | 会员留言，保留 `Member` 徽章与会员文案 |
| `superchat` | `liveChatPaidMessageRenderer` | 金额在 `sc`，颜色在 `colors` |
| `sticker` | `liveChatPaidStickerRenderer` | 金额在 `sc`，图片在 `sticker` |
| `membership` | `liveChatMembershipItemRenderer` 且无正文 | 入会 / 续费 / 里程碑 |
| `gift` | `liveChatSponsorshipsGiftPurchaseAnnouncementRenderer` | 个数在 `giftCount`，单价不可得 |
| `giftRedemption` | `liveChatSponsorshipsGiftRedemptionAnnouncementRenderer` | 领取赠礼；pack 里并入 `membership` |

### 3.2 事件 `ChatEventRecord`

定义在 `scripts/lib/live-chat-events.ts`：

```ts
export type ChatEventType =
  | 'banner' | 'bannerRemoved'
  | 'poll' | 'pollUpdate'
  | 'qna' | 'product'
  | 'system' | 'modeChange'
  | 'deleted' | 'deletedAuthor' | 'replaced'
  | 'panel' | 'other'

export interface ChatEventRecord {
  seq: number
  video: string
  at: number
  type: ChatEventType
  owner: boolean
  author?: string
  authorId?: string
  text: string | null
  id?: string
  data?: Record<string, unknown>
  raw?: unknown      // 只存本地事件文件，pack 不保留
}
```

事件类型与来源的对应：

| `type` | 来源 | `owner` | `data` |
| --- | --- | --- | --- |
| `banner` | `addBannerToLiveChatCommand` / `liveChatBannerRenderer` | 是 | `header` / `pinnedAuthor` / `pinnedAuthorId` / `pinnedKind` / `pinnedEmojis` / `targetId` / `actionId` |
| `bannerRemoved` | `removeBannerForLiveChatCommand` | 是 | `targetId` |
| `poll` | `showLiveChatActionPanelAction` / `updateLiveChatPollAction`（带问题） | 是 | `pollKey` / `snapshotKey` / `pollType` / `metadata` / `choices` |
| `pollUpdate` | `updateLiveChatPollAction`（无问题） | 是 | 同上 |
| `qna` | `liveChatCallForQuestionsRenderer` / `liveChatCreatorAnswersQuestionsRenderer` | 是 | — |
| `product` | `liveChatProductItemRenderer` | 是 | — |
| `system` | `liveChatViewerEngagementMessageRenderer` | 否 | `iconType` |
| `modeChange` | `liveChatModeChangeMessageRenderer` | 否 | `iconType` |
| `deleted` | `markChatItemAsDeletedAction` / `removeChatItemAction` | 否 | `targetItemId` / `action`，实时采集可补 `targetAuthor` / `targetText` |
| `deletedAuthor` | `markChatItemsByAuthorAsDeletedAction` / `removeChatItemByAuthorAction` | 否 | `authorId` / `action` |
| `replaced` | `replaceChatItemAction` | 否 | `targetItemId` / `kind` / `emojis` |
| `panel` | `showLiveChatActionPanelAction`（非投票） | 否 | `panelId` |
| `other` | 未识别 renderer | 否 | — |

投票的 `data.choices[]` 是 `{ text, selected, percentage: "26%", ratio: 0.2558 }`。同一投票会产生多次 `poll` / `pollUpdate`，本地事件文件保留每次快照；pack 与预览层按 `pollKey` 合并成一条，选项和百分比取最后一次，问题取第一次。

主动忽略的 action（计入 `skipped`）：`addLiveChatTickerItemAction` 与所有 `liveChatTicker*Renderer`（滚动副本）、`liveChatDialogRenderer` / `liveChatItemListRenderer` / `liveChatHeaderRenderer` / `liveChatParticipantsListRenderer` / `liveChatParticipantRenderer` / `liveChatEngagementPanelRenderer` / `liveChatBannerHeaderRenderer`（UI 结构），以及 `clickTrackingParams` 等元数据。

### 3.3 时间口径

| 字段 | 口径 |
| --- | --- |
| `ts` / `at` | 绝对 Unix 秒；有 `timestampUsec` 用它，没有时（回放）为 0 或采集时刻 |
| `msg.timestampUs` | 平台给出的绝对微秒，精度最高 |
| `video.startedAt` | `release_timestamp`（实际开播），不是 `timestamp`（公开时刻） |
| `timeRange.preRollSec` | `startedAt - firstAt`，正数表示开播前待机秒数 |
| `density.perMinute[i]` | `floor((at - startedAt) / 60)`；`at < startedAt` 的条目不进逐分钟 |

这是现有实现最值得沿用的设计：**落盘存绝对时间，聚合时再相对开播对齐**。JSONL 里没有任何「相对开播的第几秒」。新项目如果要做 overlay，只需要在封包时算一次 `offset_ms`。

### 3.4 表情

`msg.emoji` 只收频道专属表情，id 形如 `<channelId>/<hash>`；Unicode 表情留在 `text` 里。图片路径由 id 推导：

```text
<PUBLIC_R2_BASE>/emojis/<folder>/<hash>.png
folder = datasetId（成员表情）或 youtube（全局表情）
hash   = id 的 `/` 后半段
```

名称来自 `emojis/<dataset>/index.json` 的 `names[id]`，缺失时回退 `emoji_<videoId>.json` 里的 `name`。浏览器直连对象存储读索引 JSON 可能被 CORS 挡住，现有 POC 走同源中间件 `/dev/live-chat-emoji-index`。

## 四、现状：从明细到入库

### 4.1 链路

```text
yt-dlp / InnerTube
      │
      ├─ meta/info.json
      ├─ danmaku/*.jsonl            ← 全量明细，只留在本地
      ├─ comments/*.json
      └─ web/vstats_*.html
      ▼
bun run ymmt data datapack <会话目录>    buildPack() → data/<id>/<videoId>.datapack.json
      ▼
┌──────────────────────────────┬──────────────────────────────────┐
│ bun run ymmt db ingest        │ bun run ymmt publish data         │
│ Neon PostgreSQL               │ R2 archive/<id>/<videoId>.json    │
│ 只有聚合与 owner/member/events │ emojis/<id>/*  thumbs/*           │
└──────────────────────────────┴──────────────────────────────────┘
```

`buildPack()` 从 JSONL 生成 `chat` 段：`total / byKind / pureEmojiOnly / uniqueAuthors / badges / timeRange / coveragePct / density / paid / topAuthors / authors / topWords / wordCounts / hashtags / emojiKinds / emojis / ownerChats / memberChats / events`。

### 4.2 数据库里到底有什么

`chat_events` 表**从未创建**，只有 DDL 草稿。backlog B6「全量弹幕入库与检索」仍是未开始状态。数据库里与弹幕相关的只有：

| 表 / 列 | 内容 | 量级 |
| --- | --- | --- |
| `streams`（宽表） | `chat_total` / `chat_by_kind` / `pure_emoji_only` / `unique_authors` / `sc_totals_by_currency` / `paid_share_pct` 等标量 | 2,018 行 |
| `stream_details`（jsonb） | `density` / `time_range` / `badges` / `emoji_kinds` / `emoji` / **`owner_chats`** / **`member_chats`** / **`events`** | 2,018 行 |
| `paid_events` | SC / 贴纸 / 会员 / 赠送，一行一笔 | 约 4.5–10 万行 |
| `stream_authors` | 每场每作者发言计数 | 约 6.5 万行 |
| `stream_words` | 每场词频，仅 `count >= 3` | 约 11 万行 |
| `authors` | 观众维度表 | 约 20–30 万行 |

**唯一存逐条聊天正文的地方是 `stream_details.owner_chats` 与 `member_chats`**：主播本人发言和团体其他成员发言。普通观众的消息一条都没入库。

`stream_details.raw_detail` 是从未写入的死列。`paid_events.author_id` 虽然存在，但 ingest 里写死 `null`。

### 4.3 pack 的体积分布

实测 `data/yuno/e0VMqA8Bphg.datapack.json`（4,142 行）：

| 段 | 占比 |
| --- | --- |
| `chat.authors`（全量作者，约 1,900 行） | 最大 |
| `chat.wordCounts`（全量词频，约 1,040 行） | 次之 |
| `chat.density` / `paid` / `topAuthors` / `topWords` | 中等 |
| `chat.total` / `byKind` / 时间等标量 | 很小 |

`authors` 加 `wordCounts` 占单份 pack 近四分之三体积，这就是 v2 每场多 20–30 KB 的原因。单份 pack 平均 80 KB，最大 467 KB。**pack 里没有一条普通观众消息**。

### 4.4 原始明细去了哪

| 位置 | 是否存全量 JSONL |
| --- | --- |
| 本地会话目录 `temp/youtube-live/` | 是 |
| 对象存储 R2 | 否 |
| PostgreSQL | 否 |
| CI | 只靠 GitHub Actions cache 存活（`data-${{ github.run_id }}`） |
| git | 否，`data/` 已 gitignore |

`data/README.md` 明确写了「不要放原始视频/音频、弹幕原始 JSONL」。

## 五、现状：量级与规模

### 5.1 总量（按 `data/*/insights.json` 累加）

| dataset | 场次 | 弹幕总量 | 去重作者数 |
| --- | ---: | ---: | ---: |
| nonoka | 297 | 683,080 | 32,435 |
| arale | 516 | 1,709,003 | 89,134 |
| ritsu | 352 | 1,060,564 | 49,964 |
| miyako | 331 | 1,098,984 | 38,715 |
| yuno | 451 | 2,057,399 | 83,267 |
| yumemita（官方） | 71 | 652,022 | 23,170 |
| **合计** | **2,018** | **约 7,261,052** | — |

总时长约 1,177 万秒，即约 3,270 小时。历史文档里记的是 691 万条，那是较早快照。

### 5.2 单场与速率

- 单场典型 1,300–5,200 条，极端峰值 `arale/EmGZ08TBFOg` 15,933 条。
- 平均速率 19–119 条/分钟，官方号最高 118.7。峰值分钟 `arale/Kis1vai3V4Y` 1,161 条/分钟。
- 单场发言人数 127–278。
- 付费条目：SC 单场 0–248，贴纸 0–53，会员 0–2，赠送多为 0。

### 5.3 数据量估算（给新项目做容量规划用）

按一行约 200–250 B（含序号、时间、作者、正文、JSON 字段与小索引）估算：

| 形态 | 估算体积 |
| --- | --- |
| 726 万条消息的 SQLite 单文件（含索引） | 1.5–2 GB |
| 同上，gzip 后按场打包 | 350–450 MB |
| 单场 3,700 条的 JSONL 原始 | 约 1.1 MB |
| 单场 3,700 条的 JSONL gzip | 约 200 KB |
| 单场 15,933 条（最大场）原始 / gzip | 约 5 MB / 约 800 KB |
| 现有聚合库（1,901 场时实测） | 59 MB |

单场明细小到可以**整包塞进浏览器**，这是新项目设计的关键前提：单场 200 KB gzip 传一次，之后筛选、搜索、滚动全在客户端，不需要任何查询请求。

## 六、现状：R2 对象布局

| Key 模板 | 内容 | 可见性 |
| --- | --- | --- |
| `archive/<datasetId>/<videoId>.datapack.json` | pack 归档 | 应私有，当前公开 |
| `<datasetId>/transcripts/<videoId>.json` | 逐字稿正文 | 应私有，当前公开 |
| `<datasetId>/thumbs/<videoId>.jpg` | 封面原图 | 公开 |
| `<datasetId>/thumbs/<videoId>.<w>.webp` | 480 / 960 / 1280w 变体 | 公开 |
| `emojis/<folder>/<hash>.png` | 频道 / 全局表情 | 公开 |
| `emojis/<datasetId>/index.json` | 表情名称索引 | 公开 |

**桶里没有任何弹幕 JSONL**。已存在的安全隐患：公开域名 `ymmt-s3.chilfish.top` 是桶级公开域，`archive/` 与 `*/transcripts/` 可匿名下载，125 个会员限定 pack 仍公开（backlog B43、postmortem 006）。新项目一开始就应该按私有桶加签名 URL 或同源代理设计。

## 七、现状：前端展示

### 7.1 正式页面

单场页 `/[datasetId]/stream/[videoId]?view=` 有六个子视图：`overview` / `timeline` / `words` / `paid` / `comments` / `transcript`。全部 SSR，数据来自 PostgreSQL。

| 视图 | 展示 |
| --- | --- |
| `overview` | 指标条 + 逐分钟密度面积图 + 10 分钟柱状图 |
| `timeline` | D3 双轨时间轴（弹幕面积 + SC 刻度 + 峰值标记 + 悬停十字线） |
| `words` | 高频词 / 发言者 Top 条 + 主播发言列表 + 成员发言分组 + 构成统计 |
| `paid` | SC 合计 + SC 明细表 + 赠送会员 / 贴纸 / 会员列表 |

正式页面**没有全量弹幕时间线**，也不能按行看到普通观众消息。`chat.events` 虽然被读进 pack，但没有任何组件渲染它。

### 7.2 开发 POC

`/dev/live-chat` 只在 `astro dev` 可用，生产返回 404。它读本地 JSONL，是唯一真正按行展示弹幕的实现：

- 会话头 + 8 个统计卡 + 类型徽章云 + sticky 工具栏（筛选 / 搜索）+ 虚拟列表时间线。
- 自研 `VirtualList`：`ResizeObserver` 实测行高、绝对定位、`requestAnimationFrame` 节流；6,012 条时 DOM 只有约 10 行。
- 消息与事件有完整视觉区分：SC 用真实 ARGB 左边框 + 金额 chip，事件行用弱底纹 + 类型徽章，主播行主色微底。
- 筛选维度：全部 / 文字 / 付费 / 会员 / 事件 / 主播；搜索覆盖作者、正文、事件类型、投票选项。
- 导入交互：文件选择器解析 `.jsonl`，自动区分消息与事件，只存在内存。

这套 POC 验证了「单场几万行在浏览器里渲染没问题」，但没有 URL 状态、没有组件拆分、不能用于正式页面。

### 7.3 实时性

全站没有 WebSocket、SSE 或轮询。日历页每分钟刷新「现在」时间，只为更新直播状态，不重拉数据。所有数据都是「SSR 一次性取值 + CDN 缓存 + tag purge」。

## 八、平台能力边界

这一节决定新项目能承诺什么。全部来自实测，文档见 [../data/chat-events.md](../data/chat-events.md) 第 10 节。

| 限制 | 实测 / 说明 | 对产品的约束 |
| --- | --- | --- |
| 等待室历史不可回翻 | 2026-11-04 `2Q5A9SWgHtA`（`LIVE_STREAM_OFFLINE`）：reload token 只返回 2 条、跨度 14 分钟；`live_chat_replay` 只有空壳 | 开播前的弹幕只能在等待室实时在场才拿得到，事后补不回来 |
| 回放起点 | 从正片 / 开播前一段开始 | 不含更早的等待室消息 |
| 投票不回放 | 2026-11-18 `vdSknMZJ87Y`：回放 138–199 页、9,243 条消息、0 事件 | 投票 / Q&A / 置顶只在直播时抓，回放永久缺失 |
| 平台未保留回放 | watch 页没有 `liveChatRenderer`，只有 `Live chat replay is not available for this video.` | 这类场次永久拿不到，用 `isChatReplayUnavailable()` 判定并写哨兵 |
| `isReplay: null` 不等于在直播 | 必须看 `availabilityMessage` | 状态判定不能只看布尔值 |
| 会员限定要 cookie | 匿名通常停在 `unplayable` | 需要登录态与 cookie 轮换 |
| 赠送会员单价不可得 | 平台只给 `giftCount` | 只能统计个数，不能算金额 |
| 被删消息 | 实时可反查补正文，回放通常只有 `targetItemId` | 回放的删除记录信息更少 |
| 延迟下限 | 等于轮询间隔，1–15 秒 | 不能承诺亚秒级「实时」 |
| 汇率 | 金额只给原文 | 不能跨币种相加 |

另有两个易踩的判定错误：

1. `playerSeekContinuationData` 不是下一页。只遍历 `liveChatReplayContinuationData`。
2. 回放首屏的播放器提示 `Live chat replay is on` 时间戳是抓取时刻，不是消息时刻，必须过滤。

## 九、现状可复用与需重做的部分

如果新项目只借鉴本仓库，下面这些可以直接搬；标为「重做」的是现有实现已经被证明不够、新项目应该改掉的地方。

| 项 | 复用 / 重做 | 理由 |
| --- | --- | --- |
| InnerTube 协议细节（UA、continuation 优先级、错误分类） | 复用 | 全是踩坑换来的，没有理由重来 |
| `DanmakuKeySet` 去重键设计 | 复用 | 带 id 时不塞内容键这个边界必须保留 |
| 绝对时间落盘、聚合时相对开播对齐 | 复用 | overlay 与跨场对比都依赖它 |
| 状态文件 + 原子写 + 续跑 | 复用 | 回放一页 50 条、几百页，断点必须有 |
| 哨兵 + 30 天 TTL | 复用 | 避免一次临时失败变成永久跳过 |
| 虚拟列表 POC | 复用思路 | 可变行高、测高、绝对定位已被验证 |
| `text` + `emoji[]` 分开存 | 重做 | 丢了表情在句中的位置，还原不出原样 |
| 聚合进宽表 + 明细留本地 | 重做 | 明细不入库导致「完整时间线」始终做不成 |
| `raw` 只留本地 | 重做 | 解析器升级后无法重归一化，只能 `--force` 重抓 |
| 桶级公开域 | 重做 | 把会员限定内容漏出去了（postmortem 006） |
| 单场页 SSR 一次性下发大对象 | 重做 | `/gallery` 已出现 1.7 MB props 的问题 |

## 十、新项目：边界与形态

### 10.1 目标

- 回放：导入一场直播的全部弹幕与事件，能按类型、作者、关键字筛选，能跳到 YouTube 原片对应位置。
- 直播：边采集边看，支持断线重连与去重。
- 一屏看完一场，也能检索跨场。

### 10.2 非目标

- 不发弹幕、不做审核、不做用户系统。
- 不依赖本仓库的数据格式、导航或部署。可以借鉴技术栈，不共享数据库与对象桶。
- 不承诺直播亚秒延迟。

### 10.3 三段式结构

关键判断来自前面的量级测算：**单场明细小到可以整包塞进浏览器**（典型 200 KB gzip，最大 800 KB），而这类数据不可变、按场整读、几乎不更新。用查询型数据库当主存储是错配。

```text
        ┌─ 采集器（直播轮询 / 回放翻页）
        │     └─ 本地 SQLite（WAL）写入缓冲
        │           ├─ SSE / WS 扇出（直播观看）
        │           └─ 封包：排序、重编 seq、算聚合、打 parser_version
        │
        ├──→ 对象存储：<platform>/<channel>/<video>/<hash>.jsonl.gz   （不可变明细包）
        └──→ 目录库：channel / stream / 每日聚合 / 可选全局搜索      （小库）
```

- **明细包**放对象存储，内容哈希命名，永久 CDN 缓存，天然 immutable。
- **目录库**一场一行，几千行级别，负责列表、排序、跨场聚合入口。
- **原始 renderer** 另存 `raw/`，解析器升级后能重归一化，不必重抓。

## 十一、新项目：数据结构

### 11.1 设计原则

1. 消息与事件共用一条时间线、一张表。渲染时不需要在应用层 merge。
2. 存有序 `runs`，不存 `text` + `emoji[]`。InnerTube 本来就给 `runs[]`，存下来就能原样还原。
3. `seq` 与 `ts_us` 分开。`seq` 是封包时按时间重编的场内稠密序号，范围读用它；`ts_us` 留给外部对时。
4. `offset_ms` 落库。overlay 全靠它，不要每次现算。
5. 作者名与徽章存**发言时快照**，最新值另存维度表。改名、掉会员后历史不能变。
6. 删除用 tombstone，不物理删、不回溯改正文。
7. `parser_version` 打在包上。解析器升级后可选择性重导。

### 11.2 SQLite schema

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE channel (
  id         TEXT PRIMARY KEY,           -- youtube:UCxxxx
  platform   TEXT NOT NULL,
  name       TEXT NOT NULL,
  handle     TEXT,
  avatar_key TEXT
);

CREATE TABLE stream (
  id             TEXT PRIMARY KEY,       -- youtube:videoId
  channel_id     TEXT NOT NULL REFERENCES channel(id),
  external_id    TEXT NOT NULL,
  title          TEXT NOT NULL,
  status         TEXT NOT NULL,          -- scheduled|live|ended|unavailable
  scheduled_at   INTEGER,                -- unix ms
  started_at     INTEGER,                -- 实际开播，overlay 对齐基准
  ended_at       INTEGER,
  msg_count      INTEGER NOT NULL DEFAULT 0,
  event_count    INTEGER NOT NULL DEFAULT 0,
  bundle_key     TEXT,
  bundle_hash    TEXT,
  parser_version INTEGER NOT NULL,
  UNIQUE (platform, external_id)
);

CREATE TABLE item (
  stream_id    TEXT NOT NULL REFERENCES stream(id),
  seq          INTEGER NOT NULL,
  item_id      TEXT NOT NULL,            -- 平台稳定 id，缺失时用内容哈希
  ts_us        INTEGER NOT NULL,         -- 绝对微秒
  offset_ms    INTEGER,                  -- ts_us/1000 - started_at，等待室为负
  type         TEXT NOT NULL,            -- text|superchat|sticker|membership|gift|giftRedemption|banner|poll|...
  author_id    TEXT,
  author_name  TEXT,                     -- 发言时快照
  runs         TEXT,                     -- JSON: [{t:'text',v:'…'},{t:'emoji',id:'…'}]
  plain_text   TEXT,                     -- 去表情纯文本，供搜索 / 词频
  badges       TEXT,                     -- JSON string[]
  amount_text  TEXT,                     -- "¥500" 原文
  amount_minor INTEGER,                  -- 解析后的最小单位整数，仅同币种可比
  currency     TEXT,
  colors       TEXT,                     -- JSON，SC / 贴纸 ARGB
  sticker_url  TEXT,
  gift_count   INTEGER,
  owner        INTEGER NOT NULL DEFAULT 0,
  deleted      INTEGER NOT NULL DEFAULT 0,
  target_id    TEXT,                     -- 删除 / 替换 / 置顶指向的 item_id
  data         TEXT,                     -- JSON，事件专用
  PRIMARY KEY (stream_id, seq),
  UNIQUE (stream_id, item_id)
);

CREATE INDEX item_stream_ts ON item(stream_id, ts_us);
```

`runs` 的两种写法：

```json
[{"t":"text","v":"おめでとう"},{"t":"emoji","id":"UC99.../54y5"},{"t":"text","v":"！"}]
```

`plain_text` 是 `runs` 里所有 `text` 拼接的结果，只用于检索与词频，渲染一律用 `runs`。

### 11.3 与现有实现的差异

| 现有 | 新项目 | 原因 |
| --- | --- | --- |
| `msg.text` + `msg.emoji[]` | `runs[]` | 保留表情位置 |
| `ts` 秒 | `ts_us` 微秒 | 保留原生精度，同秒内可排序 |
| 无 `offset_ms` | 落库 | overlay 与 seek 直接用 |
| `seq` 与排序混在一起 | `seq` 独立 | 范围读就是 B-tree 顺序扫 |
| 明细留本地 | 打包上对象存储 | 可跨设备、可 CDN |
| `raw` 不入库 | 单独存原始 renderer | 解析器可迭代 |
| 删除只追加事件 | `deleted` 标志 + `target_id` | 渲染时一行内即可判断 |

### 11.4 如果坚持单库（PostgreSQL）

把 `item` 按 `stream_id` 做 `PARTITION BY HASH`，或者干脆不分区。几百万行不需要分区，预估 5,000 万行以上再上。索引至少要有 `(stream_id, seq)` 主键与 `(stream_id, ts_us)`。

### 11.5 搜索

| 场景 | 做法 |
| --- | --- |
| 单场搜索 | 不需要服务端索引。包已在浏览器，直接 substring / trigram 扫 |
| 跨场搜索（SQLite） | FTS5，`tokenize='trigram'`。不要用 `unicode61`，它会把整句日文当一个词 |
| 跨场搜索（Postgres） | `pg_trgm` + GIN。对无空格日文可用，但索引体积大 |
| 高质量日文分词 | 另上 Meilisearch / Typesense，不要自己写分词 |

## 十二、新项目：存储选型

### 12.1 先回答两个问题

**Neon PostgreSQL 撑得住吗：撑得住。**

- 726 万行 × 200–250 B 约 1.5–2.5 GB（含索引），`WHERE stream_id = $1 AND seq BETWEEN $2 AND $3` 是索引范围扫，1–5 ms。
- 容量不是瓶颈。瓶颈是每次打开一场要传几 MB JSON，以及跨区 RTT 与 Worker 序列化 CPU。
- 免费档 0.5 GB 不够，需要 Launch 档（10 GB 起）。
- 本仓库已验证：1,901 场、59 MB 聚合库，跨区 p50 约 120 ms，瓶颈一直是 RTT 而不是行数。

**SQLite 的问题不是性能，是没有常驻机器。**

- 单文件、FTS5、范围扫极快、备份就是拷文件，性能上胜过在线库。
- 写并发只有单写者，但写入本来就是「同时只采一场」，完全够。
- 做成 Web 有三条路，各有代价：

| 方案 | 优点 | 代价 |
| --- | --- | --- |
| Cloudflare D1 | 托管 SQLite，与 Workers 同栈 | 按扫描行数计费，范围扫容易打爆额度；单库 10 GB；主库单区域 |
| Turso / libSQL | 嵌入副本，边缘节点本地只读 SQLite，写回主库 | 多一套基础设施与同步语义 |
| VPS 挂 volume | 最直接，配合 Litestream 备份 | 要自己运维 |

### 12.2 推荐：按冷热分开

| 方案 | 适合 | 代价 |
| --- | --- | --- |
| **对象存储明细包 + Neon 目录（推荐）** | Web、要跨场统计与搜索、已在 Cloudflare 栈 | 需要设计封包与版本 |
| 对象存储明细包 + 纯静态站 | 只看单场 / 回放，零后端 | 跨场搜索只能在客户端做 |
| Neon 单库全量 | 一个库搞定、要 SQL 检索、SSR | 出网与序列化成本，免费额度不够 |
| SQLite（本地 / 桌面 Tauri） | 离线、个人归档工具 | 不做成 Web 就没有远程问题 |
| Turso 嵌入副本 | 边缘低延迟读 + 直播写 | 多一套基础设施 |

一句话规则：**明细是不可变冷数据，放对象存储并让客户端持有；目录、聚合、跨场检索是热数据，放小库。** 730 万条不值得为了「能 SQL 查」把 2 GB 塞进在线库再每次传 6 MB。

### 12.3 封包格式

两种都可，按是否需要服务端查询选：

| 格式 | 优点 | 代价 |
| --- | --- | --- |
| `jsonl.gz`（一行一条 `item`） | 流式解析、追加友好、跨语言 | 不能直接 SQL 查 |
| 单场 `.sqlite` 文件 | 可直接查询、可 attach | 生成与版本管理更重 |

推荐先用 `jsonl.gz`。浏览器侧用 `DecompressionStream('gzip')` 流式解压，逐行 `JSON.parse`，10 万行以内不阻塞。

## 十三、新项目：写入路径

### 13.1 直播

```text
轮询 InnerTube
   ↓ 每页 50 条
本地 SQLite WAL  INSERT OR IGNORE (stream_id, item_id)
   ├─→ SSE text/event-stream 推给观看端（按 seq 断点续传）
   └─→ 结束时封包：排序 → 重编 seq → 算聚合 → gzip → 上传 → 写 stream 行 → purge CDN
```

要点：

- 幂等靠 `(stream_id, item_id)` 唯一约束，不靠应用层判断。
- 断线重连用 `?since=<seq>` 或 `Last-Event-ID` 回补，客户端按 `item_id` 再去一次重。
- 采集进程与观看端解耦。采集进程崩了重启后从状态文件继续，不影响已推送部分。

### 13.2 历史导入

- 同一条 `normalize(raw, parserVersion) → Item`，数据源换成回放翻页或本地 JSONL。
- 支持「拖一个 JSONL 进来直接看」，不落库，纯内存。现有 POC 已验证这个交互。
- 批量导入按场并行，单场失败跳过并记录，不阻塞其余。

## 十四、新项目：展示形态

### 14.1 四种形态

**A. 浮动 overlay（B 站式）**

- 只有回放能精确对齐：`player.getCurrentTime() * 1000` 对上 `offset_ms`。
- 直播无法真正同步：YouTube embed 的 `currentTime` 基准不稳，还有平台延迟。现实做法是「按到达时间滚动」，不要假装同步。
- 实现要点：泳道分配防重叠；`requestAnimationFrame` + `translateX`；DOM 节点池或 canvas；密度超阈值时按优先级丢弃（主播 > SC > 会员 > 普通）。
- SC 不飞，走顶部固定条。
- 可调项：速度、透明度、密度上限、屏蔽词、按类型开关。

**B. 聊天列（Twitch / YouTube 式）**

- 虚拟列表 + 可变行高，贴底自动滚，向上翻时暂停并显示「回到最新」。
- 同一作者连续发言可合并，省空间也更接近原生。
- 徽章、作者名颜色、表情图、金额 chip。

**C. 时间轴 / 热力 + 定位**

- 逐分钟密度曲线 + SC 刻度 + 事件标记，点击 seek。
- 回放场景最有用。高密度段用「概览 / 明细」双模式，避免一开就几万行。

**D. 高光摘要**

- 只留 SC、置顶、投票、主播发言。适合「几分钟看完一场」。

**推荐组合**：回放 = 视频 + overlay + 右侧聊天列（可切时间轴）；直播 = 聊天列 + SSE 状态条；归档浏览 = 时间轴 + 高光。

### 14.2 类型表现映射

| 类型 | 聊天列 | overlay | 备注 |
| --- | --- | --- | --- |
| `text` | 普通行 | 飞行弹幕 | 纯表情行必须渲染图片，不能留空白 |
| `superchat` | 等级色左边框 + 金额 chip + 置顶卡片 | 顶部固定条，不飞 | 颜色不能是唯一信号，金额与标签同时存在 |
| `sticker` | 缩略图 + 金额 | 不飞或贴边 | 图挂了显示 `[贴纸]` |
| `membership` / `gift` / `giftRedemption` | 弱化系统行，可选 toast | 不飞 | 不进词频 |
| `banner` / `bannerRemoved` | 顶部常驻条，直到取消置顶 | 顶部条 | 指向原消息，可点击跳转 |
| `poll` / `pollUpdate` | 内联卡片，按 `pollKey` 合并成一张，选项条 + 百分比 + 票数 + 更新时间 | 卡片 | 标注「非实时」，别让读者以为结果实时 |
| `qna` / `product` | 卡片 | 卡片 | 主播操作 |
| `deleted` / `deletedAuthor` | 占位或隐藏，可切换「显示已删除」 | 隐藏 | 不回溯改正文 |
| `replaced` | 就地替换目标行正文 | 同左 | |
| `system` / `modeChange` | 弱化、可折叠 | 隐藏 | |
| `panel` / `other` | 默认隐藏 | 隐藏 | |

### 14.3 视觉与可访问性

- 颜色只用设计 Token；SC 等级色是数据，集中在一个模块，不散落硬编码。
- 不用颜色作唯一区分：SC 有金额与标签，事件有类型文字，主播有「主播」徽章。
- 行用 `<ol>` / `<li>`；筛选按钮 `aria-pressed`；计数变化 `aria-live="polite"`；`prefers-reduced-motion` 下不做入场动画。
- 虚拟列表要注意的代价：浏览器原生查找、文本选中、滚动定位、焦点连续性都会退化。参考 [long-document-rendering-practices.md](./long-document-rendering-practices.md) 的取舍。

### 14.4 状态

| 状态 | 表现 |
| --- | --- |
| loading | 骨架行 |
| empty | 说明这里是什么、为什么空、下一步怎么做 |
| error | 可执行的下一步（重试、换文件、检查凭据） |
| partial | 坏行、缺事件、缺表情索引，显示数量但不阻塞 |
| degraded | 旧档没有 SC 颜色 / 贴纸，用回退样式并提示重抓可补全 |

## 十五、落地顺序

1. `parser`：`Item` 类型 + `normalize()` + 去重 / 排序，单测覆盖六种 `kind` 与十三种事件。
2. `store`：SQLite 写入 + `(stream_id, item_id)` 幂等 + 封包上传。
3. `collector`：先只做回放，可重复、无时效压力，跑通历史导入。
4. `viewer`：虚拟列表 + 筛选 + 搜索，全在客户端。
5. `overlay`：加播放器同步。
6. 最后做直播 SSE 与跨场检索。

前四步不需要服务器数据库，一个静态站就能看历史弹幕。

## 十六、已知坑

1. **别丢 `raw`**。解析器一定会改，重抓的代价是几百页乘几千场。
2. **别用显示名当主键**，用 `authorId`；缺 id 时用 `name:` 哈希兜底。
3. **同一秒同文的两条消息不是重复**。带 id 时不塞内容键，这是现有实现专门处理过的边界。
4. **SC 金额不换算汇率**，按币种分组；`amount_minor` 只用于同币种排序。
5. **直播投票必须直播时抓**，回放永久缺失，产品上要提前说明。
6. **会员限定的包不能公开**。按私有桶加签名 URL 或同源代理设计。
7. **Unicode 表情留在文字里，频道表情单独存 id**；索引失败降级成 `:Name:` 或 `[表情]`。
8. **`playerSeekContinuationData` 不是下一页**。
9. **回放首屏的播放器提示要过滤**，不然会多出一条时间戳错误的事件。
10. **别在 Worker 里逐条 insert**。回放几百页，批量写或本地缓冲后再传。

## 十七、未决问题

- 明细包用 `jsonl.gz` 还是单场 `.sqlite`？前者简单，后者能 attach 查询。
- 跨场搜索要不要做，做的话用 FTS5 trigram 还是外部分词服务。
- 直播端用 SSE 还是 WebSocket？SSE 更简单，但单向。
- 等待室阶段是否在时间线上单独标记？现有实现只按时间排序，`offset_ms` 为负。
- 投票只显示最后一次快照，还是提供历史快照切换？
- 删除的消息默认隐藏还是默认占位？现有策略是保留原记录并追加 tombstone。
- 是否支持把导入的 JSONL 导出成可分享的静态页面。

## 相关文档

- [../data/chat-events.md](../data/chat-events.md)：现有弹幕与事件的字段级字典
- [../data/datapack.md](../data/datapack.md)：pack 结构与口径
- [../ui-design/chat-visualization.md](../ui-design/chat-visualization.md)：现有 POC 的组件方案与正式化路径
- [long-document-rendering-practices.md](./long-document-rendering-practices.md)：超长列表渲染的业界做法
- [../planning/architecture.md](../planning/architecture.md)：本仓库分层与数据流

