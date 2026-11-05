# 弹幕与事件数据字典

本文定义一场直播的弹幕消息、非消息事件、表情资源与它们在 pack / 数据库里的投影。字段以当前脚本和 `stream-datapack` 的实现为准；pack 的展示字段另见 [data-model.md](./data-model.md) §5 与 §8。

适用范围：`fetch:live-chat`、`fetch:danmaku`、`fetch:streams` 产出的本地会话；`ingest-db` 投影后的 `streams` / `stream_details`；预览页 `/dev/live-chat` 的输入。

## 1. 术语

| 术语 | 定义 |
| --- | --- |
| 弹幕 / 消息 | 观众或主播发出的聊天条目，包含文字、SC、贴纸、会员事件、赠送会员、领取赠礼 |
| 事件 | 不进入消息流的聊天动作：置顶、投票、Q&A、商品、系统提示、模式变更、删除、替换 |
| 等待室 | 预定开播前已经开放的聊天室；播放器状态为 `LIVE_STREAM_OFFLINE`，不是终态 |
| 回放 | 直播结束后通过 `get_live_chat_replay` 或 yt-dlp `live_chat` 字幕取得的历史聊天 |
| SC | Super Chat，`liveChatPaidMessageRenderer`；金额原文不换算汇率 |
| 会员留言 | `liveChatMembershipItemRenderer` 里带正文的条目，归为普通弹幕并保留会员徽章 |
| JST | 日本时间（UTC+9）；所有展示时间统一 JST |

## 2. 数据来源与产物

| 来源 | 命令 | 适用阶段 | 产物 | 事件 | SC 颜色 / 贴纸 |
| --- | --- | --- | --- | --- | --- |
| InnerTube 实时 | `bun run fetch:live-chat --video <id>` | 等待室 / 直播中 | `danmaku_live_<id>.jsonl`、`events_<id>.jsonl`、`emoji_<id>.json`、`work/live-chat-state.json` | 有 | 有（新抓取） |
| InnerTube 回放 | `bun run fetch:danmaku --dataset <id> --video <id> --engine innertube` | 已结束 | `danmaku_<id>.jsonl`、`events_<id>.jsonl`、`emoji_<id>.json`、`work/replay-state.json` | 有 | 有（新抓取） |
| yt-dlp 回放 | 同上，`--engine yt-dlp` | 已结束 / 会员限定 | `danmaku_<id>.jsonl` | 无 | 有（renderer 带颜色时） |
| 全量归档 | `bun run fetch:streams --dataset <id>` | 历史补齐 | meta / 评论 / VSTATS + yt-dlp `live_chat` | 无 | 有（renderer 带颜色时） |
| 表情资源 | `bun run fetch:emoji --dataset <id>` | 任意 | `data/<id>/emoji/*` + `index.json` | — | — |

`fetch:live-chat` 在检测到直播已结束时，默认自动改走 InnerTube 回放并合并实时采集；`--once` 只取一页，不触发完整回放。`fetch:danmaku` 默认 `--engine auto`：先试 InnerTube 回放，失败或没有回放时回退 yt-dlp。

`fetch:danmaku` 已配置 `bun run` 别名；`fetch:streams` 仍用 yt-dlp 的全量归档路径。

## 3. 会话目录与文件

```text
<root>/<日期>_<成员>_<videoId>/
├── danmaku/
│   ├── danmaku_live_<videoId>.jsonl   实时采集（等待室 + 直播中）
│   ├── danmaku_<videoId>.jsonl        回放 / 合并后的完整消息
│   ├── events_<videoId>.jsonl         非消息事件
│   └── emoji_<videoId>.json           本场出现过的频道表情
└── work/
    ├── live-chat-state.json           实时采集状态与 continuation
    └── replay-state.json              InnerTube 回放分页状态
```

| 文件 | 生产者 | 记录类型 | 说明 |
| --- | --- | --- | --- |
| `danmaku_live_*.jsonl` | `fetch:live-chat` | `ChatRecord` | 可续跑；与回放按消息 id 合并 |
| `danmaku_*.jsonl` | `fetch:danmaku` / `fetch:live-chat` 回放 / `fetch:streams` | `ChatRecord` | 最终消息真源，`stream-datapack` 优先读它 |
| `events_*.jsonl` | `fetch:live-chat` / `fetch:danmaku` 的 InnerTube 路径 | `ChatEventRecord` | yt-dlp 回放不产生该文件 |
| `emoji_*.json` | `fetch:live-chat` / `fetch:danmaku` / yt-dlp 归一化 | `yumemita.chat-emoji/v1` | id → 名称 / InnerTube 图片地址 |
| `live-chat-state.json` | `fetch:live-chat` | 采集器状态 | continuation、计数、停止原因；续跑用 |
| `replay-state.json` | `fetch:danmaku` / 回放采集器 | 回放分页状态 | 续页 token、页数、计数；续跑用 |

## 4. 消息记录（`ChatRecord`）

### 4.1 顶层

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `seq` | number | 是 | 合并后按 `ts` 升序重编，从 1 开始 |
| `video` | string | 是 | YouTube video id |
| `ts` | number | 是 | Unix 秒；由 `timestampUs` 或采集时刻计算 |
| `rendererId` | string | 否 | `renderer.id`；实时、InnerTube 回放、yt-dlp 回放对同一条消息相同，优先用它去重 |
| `msg` | object | 是 | 消息内容，见 4.2 |

示例：

```json
{"seq":1,"video":"fmjJNbzcr3g","ts":1793718917,"rendererId":"ChwKGkNNYWhtdGVMN0pjREZhVjZUQWdkNzhBajJn","msg":{"author":"@ぺんたい","authorId":"UC-liTSTGf0kqwVvenTNQn2g","text":"","kind":"text","sc":null,"timestampUs":"1793718917446155","emoji":[{"id":"UC99kOG6_9RD0mR3OG4EOfxw/54y5aIPSFd-QoPwPxrGNqQk"}],"badges":["New member"]}}
```

### 4.2 `msg` 字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `author` | string | 否 | 显示名；会改、会重名，不能当稳定主键 |
| `authorId` | string | 否 | `authorExternalChannelId`；观众重叠、去重优先用它 |
| `text` | string | 否 | 正文；频道表情不在正文里，单独放 `emoji` |
| `kind` | enum | 是 | `text` / `superchat` / `sticker` / `membership` / `gift` / `giftRedemption` |
| `sc` | string \| null | 否 | 金额原文，例如 `¥500`、`NT$150.00`；不换算汇率 |
| `timestampUs` | string | 否 | YouTube 绝对微秒时间戳 |
| `emoji` | `{ id: string }[]` | 否 | 频道专属表情 id，按出现顺序；Unicode 表情保留在 `text` |
| `badges` | string[] | 否 | 徽章名，例如 `Member`、`New member`、`Owner`；括号后缀已去掉 |
| `header` | string | 否 | 会员里程碑文案或会员自定义状态，例如 `Welcome to …`、`もぐもぐ` |
| `membershipPrimary` | string | 否 | 会员主文案，例如 `Member for 25 months` |
| `memberMessage` | boolean | 否 | `true` 表示会员留言被归为 `text` |
| `colors` | object | 否 | SC / 贴纸的等级颜色（ARGB 整数），见 4.4 |
| `sticker` | object | 否 | 付费贴纸的 `{ name, url }`，见 4.5 |
| `giftCount` | number | 否 | 一次赠送的会员个数，仅 `kind: "gift"` |

### 4.3 `kind` 与分类规则

| `kind` | 来源 renderer | 说明 |
| --- | --- | --- |
| `text` | `liveChatTextMessageRenderer` | 普通文字 / 表情弹幕 |
| `text` + `memberMessage: true` | `liveChatMembershipItemRenderer` 且 `message` 有正文 | 会员留言；仍保留 `Member` 徽章与 `header` / `membershipPrimary` |
| `superchat` | `liveChatPaidMessageRenderer` | SC；金额在 `sc`，颜色在 `colors` |
| `sticker` | `liveChatPaidStickerRenderer` | 付费贴纸；金额在 `sc`，图片在 `sticker`，颜色在 `colors` |
| `membership` | `liveChatMembershipItemRenderer` 且无正文 | 入会 / 续费 / 新会员里程碑 |
| `gift` | `liveChatSponsorshipsGiftPurchaseAnnouncementRenderer` | 赠送会员公告；个数在 `giftCount`，单价不可得 |
| `giftRedemption` | `liveChatSponsorshipsGiftRedemptionAnnouncementRenderer` | 领取赠礼；pack 里并入 `membership` |

分类规则：

1. `liveChatMembershipItemRenderer` 的 `message` 有正文时归为 `text`，`memberMessage: true`；`headerPrimaryText` 写 `membershipPrimary`，`headerSubtext` 写 `header`。
2. 领取赠礼保留 `kind: "giftRedemption"`，由 `stream-datapack` 计入 `byKind.membership`；`paid.gifts` 只统计赠送方。
3. 旧 jsonl 里的「会员留言」可能仍是 `membership`；预览层会按「`kind === membership` 且有正文」重新显示为普通弹幕，但旧 pack 的 `byKind` 不会自动改。

### 4.4 `colors`（SC / 贴纸等级颜色）

`colors` 全部是 YouTube 原始 ARGB 整数（无符号 32 位）。预览按 `rgba(r, g, b, a/255)` 转 CSS；旧档没有该字段时按金额给近似等级色。

| 字段 | 来源 renderer 字段 | 用途 |
| --- | --- | --- |
| `headerBackground` | `headerBackgroundColor` | SC 头部 / 等级色 |
| `headerText` | `headerTextColor` | SC 头部文字 |
| `bodyBackground` | `bodyBackgroundColor` | SC 正文底色 |
| `bodyText` | `bodyTextColor` | SC 正文文字 |
| `authorName` | `authorNameTextColor` | 作者名颜色 |
| `timestamp` | `timestampColor` | 时间颜色 |
| `moneyChipBackground` | `moneyChipBackgroundColor` | 贴纸金额 chip 底色 |
| `moneyChipText` | `moneyChipTextColor` | 贴纸金额 chip 文字 |
| `background` | `backgroundColor` | 贴纸整行底色 |

示例：

```json
{"seq":2,"video":"vid","ts":1793286854,"msg":{"author":"@sc","text":"おめでとう","kind":"superchat","sc":"¥500","colors":{"headerBackground":4294947584,"headerText":4278190080,"bodyBackground":4294953512,"bodyText":4278190080,"authorName":2315255808,"timestamp":2147483648}}}
```

### 4.5 `sticker`（付费贴纸）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string \| null | `sticker.accessibility.accessibilityData.label` |
| `url` | string | 取最大尺寸缩略图；`//lh3...` 会补成 `https://lh3...` |

示例：

```json
{"seq":3,"video":"vid","ts":1793286898,"msg":{"author":"@sticker","text":"","kind":"sticker","sc":"¥140","sticker":{"name":"cake","url":"https://lh3.googleusercontent.com/..."},"colors":{"moneyChipBackground":4280150454,"moneyChipText":4278190080,"background":4280150454}}}
```

### 4.6 表情

`msg.emoji` 只收频道专属表情（id 形如 `<channelId>/<hash>`）。Unicode 表情是 `text` 里的字符。表情图片和名称来自两处：

- `emoji_<videoId>.json`：本场出现过的表情，`url` 是 InnerTube 原图；
- `emojis/<dataset>/index.json`：dataset 级名称索引，图片按 id 推导，见 §8。

## 5. 事件记录（`ChatEventRecord`）

### 5.1 顶层

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `seq` | number | 是 | 事件文件内按 `at` 升序重编 |
| `video` | string | 是 | video id |
| `at` | number | 是 | Unix 秒；没有原生时间戳的事件用采集时刻 |
| `type` | string | 是 | 事件类型，见 5.2 |
| `owner` | boolean | 是 | 是否由主播（或主播操作，如置顶、发起投票）产生 |
| `author` | string | 否 | 事件作者 / 操作者 |
| `authorId` | string | 否 | 稳定频道 ID |
| `text` | string \| null | 是 | 可读摘要；没有正文时为 `null` |
| `id` | string | 否 | 稳定事件 id，用于跨轮询去重 |
| `data` | object | 否 | 结构化细节，见 5.3 |
| `raw` | unknown | 否 | 原始 renderer / action；只存在本地事件文件，pack 不保留 |

### 5.2 事件类型

| `type` | 来源 action / renderer | `owner` | `text` | `data` |
| --- | --- | --- | --- | --- |
| `banner` | `addBannerToLiveChatCommand` / `liveChatBannerRenderer` | 是 | `置顶 <作者>：<正文>` 或 header | `header` / `pinnedAuthor` / `pinnedAuthorId` / `pinnedKind` / `pinnedEmojis` / `targetId` / `actionId` |
| `bannerRemoved` | `removeBannerForLiveChatCommand` | 是 | null | `targetId` |
| `poll` | `showLiveChatActionPanelAction` / `updateLiveChatPollAction`（带问题） | 是 | 问题 | 见 5.3 |
| `pollUpdate` | `updateLiveChatPollAction`（无问题） | 是 | null | 见 5.3 |
| `qna` | `liveChatCallForQuestionsRenderer` / `liveChatCreatorAnswersQuestionsRenderer` | 是 | 问题 / 回答 | 无 |
| `product` | `liveChatProductItemRenderer` | 是 | 标题 / 文案 | 无 |
| `system` | `liveChatViewerEngagementMessageRenderer` | 否 | 系统提示 | `iconType` |
| `modeChange` | `liveChatModeChangeMessageRenderer` | 否 | 慢速 / 会员限定等提示 | `iconType` |
| `deleted` | `markChatItemAsDeletedAction` / `removeChatItemAction` | 否 | null | `targetItemId` / `action`；实时采集可能补 `targetAuthor` / `targetText` / `targetKind` / `targetOwner` |
| `deletedAuthor` | `markChatItemsByAuthorAsDeletedAction` / `removeChatItemByAuthorAction` | 否 | null | `authorId` / `action`；可能补 `targetAuthor` / `targetOwner` |
| `replaced` | `replaceChatItemAction` | 否 | 替换后的正文 | `targetItemId` / `kind` / `emojis` |
| `panel` | `showLiveChatActionPanelAction` 且不是投票 | 否 | 面板标题 / 文案 | `panelId` |
| `other` | 未识别 renderer | 否 | 尽力提取的文本 | 无 |

### 5.3 投票 `data`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `pollKey` | string | 问题文本；更新包没有问题时用选项文本拼接 |
| `snapshotKey` | string | 当前选项快照的 JSON 字符串；用于去重 |
| `pollType` | string \| null | 例如 `LIVE_CHAT_POLL_TYPE_CREATOR`；缺省按主播发起处理 |
| `metadata` | string \| null | 例如 `@yuno_yumemita • 13h ago • 387 votes` |
| `choices` | array | `{ text, selected, percentage, ratio }`；`percentage` 是平台给的字符串，`ratio` 是 0–1 |
| `snapshotCount` | number | 仅 pack / 预览合并后追加：合并了多少次快照 |
| `updatedAt` / `updatedAtTs` | string / number | 仅 pack / 预览合并后追加：最后一次快照时间 |

一条投票可能产生多次 `poll` / `pollUpdate`。本地事件文件保留每次快照；`stream-datapack` 和预览按 `pollKey` 合并为一条，选项和百分比取最后一次，`text` 取第一次出现的问题。

示例：

```json
{"seq":1,"video":"fmjJNbzcr3g","at":1793763750,"type":"poll","owner":true,"author":"@yuno_yumemita","text":"ゆのちゃん、おたんじょうび","id":"poll:ゆのちゃん、おたんじょうび","data":{"pollKey":"ゆのちゃん、おたんじょうび","snapshotKey":"[...]","pollType":"LIVE_CHAT_POLL_TYPE_CREATOR","metadata":"@yuno_yumemita • 13h ago • 387 votes","choices":[{"text":"おめでとう","selected":false,"percentage":"26%","ratio":0.2558}]}}
```

### 5.4 置顶与删除

置顶事件保留被置顶消息的作者、正文、表情 id 与 target id；`raw` 里是完整的 banner renderer。删除事件不回溯修改已记录的弹幕，只追加一条 tombstone：

- 实时采集会用 `rendererId` 反查被删消息，补 `targetAuthor` / `targetText` / `targetKind` / `targetOwner`；
- InnerTube 回放采集没有实时索引，通常只有 `targetItemId`；
- 删除是审核动作，不一定是主播本人；`owner` 默认 `false`。

### 5.5 忽略的 action

以下 action / renderer 不进入消息或事件，计入 `skipped` 统计，供排查：

- `addLiveChatTickerItemAction` 与所有 `liveChatTicker*Renderer`：消息的滚动副本，不重复落档；
- `liveChatDialogRenderer`、`liveChatItemListRenderer`、`liveChatHeaderRenderer`、`liveChatParticipantsListRenderer`、`liveChatParticipantRenderer`、`liveChatEngagementPanelRenderer`、`liveChatBannerHeaderRenderer`：面板/UI 结构；
- `clickTrackingParams`、`trackingParams`、`continuation`、`item`、`command`、`params`、`loggingDirectives`：action 元数据。

## 6. 合并、去重与排序

### 6.1 三种来源

| 场景 | 消息 | 事件 | 合并方式 |
| --- | --- | --- | --- |
| 等待室 / 直播中 | `danmaku_live_*.jsonl` | `events_*.jsonl` | 实时写入，按 `rendererId` / 内容键去重 |
| InnerTube 回放 | `danmaku_*.jsonl` | `events_*.jsonl` | 可续页；与实时文件合并 |
| yt-dlp 回放 | `danmaku_*.jsonl` | 无 | 同一份字幕内先按 `rendererId` 去重，再与实时文件合并 |

`fetch:live-chat` 在直播结束后默认调用回放采集器；`fetch:danmaku` 直接走回放。两者最终都会把 `danmaku_live_*.jsonl` 合并进 `danmaku_*.jsonl`。

yt-dlp 的 `live_chat` 字幕可能同时含「直播段」和「从开头重写的回放段」（回放段前有 `REPLAY_VEM*` 播放器提示），同一条消息会出现两次。`normalizeLiveChat` 在写文件时就用 `DanmakuKeySet` 去重，只保留第一次出现的记录，重复条数记在 `NormalizeResult.duplicates`。

### 6.2 去重键

`DanmakuKeySet` 同时使用两类键：

- `rendererId`：有 id 的记录按 id 去重；
- 内容键：`timestampUs + authorId/author + kind + text + header`，用于旧档没有 id 的情况。

带 id 的记录不会把内容键放进集合：同一作者在同一秒发两条相同正文（常见于纯表情消息 `text: ""`）时，id 不同但内容键相同，不能误判为重复。没有 id 的旧记录只能按内容键去重。

### 6.3 排序与编号

- 消息按 `ts` 升序排序，`seq` 从 1 重编；
- 事件按 `at` 升序排序，`seq` 从 1 重编；
- 同一秒内消息在前、事件在后；
- 回放首屏的 `Live chat replay is on` 是播放器提示，时间戳是抓取时刻，回放采集器会过滤，不写入事件文件。

### 6.4 表情 sidecar

回放归一化写 `emoji_<videoId>.json` 时先读旧表再合并，避免覆盖实时采集阶段已经拿到的表情。没有表情时删除旧文件。

## 7. 投影到 pack 与数据库

### 7.1 pack `chat`

`stream-datapack` 从 `danmaku_*.jsonl` 和 `events_*.jsonl` 生成 `chat`。完整字段见 [data-model.md](./data-model.md) §5；这里只列与消息/事件相关的口径。

| 字段 | 来源 | 说明 |
| --- | --- | --- |
| `total` | 定时消息条数 | 含纯表情与付费条目 |
| `byKind` | `msg.kind` | `text` / `superchat` / `sticker` / `membership` / `gift`；`giftRedemption` 并入 `membership` |
| `pureEmojiOnly` | `emoji` + `text` | 只剩频道表情的条目 |
| `uniqueAuthors` | `authorId` 优先 | 没有 id 的旧数据退回显示名 |
| `ownerMessages` | `badges` 含 `Owner` | 主播发言条数；DB 查询时排除 `ownerChats` 里的 `kind: "event"` |
| `badges` | `msg.badges` | 徽章分布 |
| `timeRange` | `ts` + `video.startedAt` | `firstAt` / `lastAt` / `preRollSec` |
| `coveragePct` | 时长 + 首末条 | 只算开播后区间 |
| `density` | `ts` | 逐分钟 / 5 分钟 / 10 分钟；开播前条目不计入逐分钟 |
| `paid` | SC / 贴纸 / 会员 / 赠送 | 金额不换算汇率 |
| `topAuthors` / `authors` | `authorId` / `author` | Top 20 与全量 |
| `topWords` / `wordCounts` | `msg.text` | 会员系统文案与赠送/领取不计入词频 |
| `hashtags` | `msg.text` | `#` / `＃` |
| `emojiKinds` | `msg.emoji` | 种类数 + Top 15 |
| `emojis` | `emoji_*.json` | 本场表情资源 |
| `ownerChats` | Owner 消息 + owner 事件 | 按时间排序；事件 `kind: "event"` |
| `events` | `events_*.jsonl` | 紧凑事件；投票合并为最后一次快照；不保留 `raw` |

### 7.2 数据库

- `stream_details.owner_chats`：`chat.ownerChats` 原样写入；`kind: "event"` 表示主播操作。
- `stream_details.events`：`chat.events ?? []` 写入；`packs.ts` 读回 `chat.events`。
- `stream_details.emojis`：`chat.emojis ?? []`。
- `owner_messages` 没有单独列；`packs.ts` 用 `ownerChats.filter(kind !== "event").length` 计算。
- `stream_details.events` 由 `drizzle/0001_add_stream_events.sql` 添加；部署前执行 `bun run db:migrate`。

### 7.3 pack 没有的东西

pack 只有聚合、Top 列表、主播发言和事件，**不包含全量弹幕明细**。要做完整弹幕时间线，需要读 `danmaku_*.jsonl`（本地 / R2 / 未来的 `chat_events` 表），不能只靠 `chat`。

## 8. 表情索引与图片

### 8.1 id 格式

频道专属表情的 id 形如 `<channelId>/<hash>`，例如：

```text
UC99kOG6_9RD0mR3OG4EOfxw/54y5aK3nFd-QoPwPxrGNqQk
```

YouTube 全局表情的 scope 是 `UCkszU2WH9gy1mb0dV-11UJg`，图片目录固定为 `youtube/`，不按成员复制。

### 8.2 两套文件

| 文件 | schema | 内容 | 用途 |
| --- | --- | --- | --- |
| `emoji_<videoId>.json` | `yumemita.chat-emoji/v1` | `{ id, name, url }[]`，url 是 InnerTube 原图 | 本场表情资源；pack `chat.emojis` |
| `emojis/<dataset>/index.json` | `yumemita.emoji-index/v1` | `{ names: { "<id>": "名称" } }` | dataset 级名称索引；发布到对象存储 |

图片路径由 id 推导：

```text
<PUBLIC_R2_BASE>/emojis/<folder>/<hash>.png
folder = datasetId（成员表情）或 youtube（全局表情）
hash   = id 的 `/` 后半段
```

例如 `UC99kOG6_9RD0mR3OG4EOfxw/54y5aK3nFd-QoPwPxrGNqQk` 对应：

```text
<PUBLIC_R2_BASE>/emojis/yuno/54y5aK3nFd-QoPwPxrGNqQk.png
```

### 8.3 名称、快捷键与回退

- 名称优先取 `index.json` 的 `names[id]`；没有索引时退回 `emoji_*.json` 的 `name`。
- 预览会把文本里的 `:Name:` 按名称索引替换成图片；大小写不敏感。
- 图片优先用索引路径；加载失败时退回 `emoji_*.json` 的 InnerTube 地址；都失败时显示名称或 `[表情]`。
- 索引缺失（没跑 `fetch:emoji`）不影响消息正文，只影响名称和图片。
- 浏览器直接 `fetch` 对象存储的 `index.json` 可能被 CORS 挡住；预览走同源 dev 中间件 `/dev/live-chat-emoji-index`。正式组件应走同源代理、服务端读取或带 CORS 的静态资源，不要假设浏览器能直连桶。

### 8.4 生成

`bun run fetch:emoji --dataset <id>` 合并频道 / YouTube 表情选择器与 `chat.emojis`，镜像图片到 `data/<id>/emoji/`，并写 `index.json`。

## 9. 时间口径

| 字段 | 口径 |
| --- | --- |
| `ts` / `at` | Unix 秒；消息取 `timestampUsec / 1e6`，没有时用采集时刻 |
| `timestampUs` | YouTube 绝对微秒时间戳；回放与实时同一套 |
| `video.startedAt` | `release_timestamp`（实际开播），不是 `timestamp`（公开时刻） |
| `timeRange.firstAt` / `lastAt` | 消息首末条；可早于开播 |
| `preRollSec` | `startedAt - firstAt`；正数表示开播前待机时长 |
| `density` | 只统计 `at >= startedAt` 的条目；开播前条目不计入逐分钟 |
| 事件 `at` | 有 `timestampUsec` 用原生时间；投票更新、删除等没有时间戳时用采集时刻 |
| `Scheduled start` | watch 页 `microformat…startTimestamp`；等待室会话目录日期用它 |

时间展示统一 JST。`ts` 是绝对时间，跨时区排序不受影响。

## 10. 覆盖范围与已知限制

| 限制 | 说明 |
| --- | --- |
| 等待室历史窗口 | InnerTube 只返回当前窗口，没有回翻游标。2026-11-04 实测 `2Q5A9SWgHtA`（`LIVE_STREAM_OFFLINE`，673 天后开播）：reload token 只返回 2 条、时间跨度 14 分钟；`live_chat_replay` 只有空壳，没有 replay/seek continuation。几周前的消息无法补回 |
| 回放起点 | 回放从正片/开播前一段开始，不包含更早的等待室消息 |
| 旧档缺字段 | `colors`、`sticker`、`memberMessage`、`membershipPrimary` 只在新归一化/新抓取里有；旧 jsonl 需要重抓或重归一化 |
| 会员留言旧分类 | 旧 jsonl 可能把带正文的会员留言记成 `membership`；预览会重新显示为普通弹幕，旧 pack 的 `byKind` 不会自动改 |
| yt-dlp 回放 | 只有消息，没有 `events_*.jsonl`；会员限定需要 cookie |
| ticker / UI | 滚动副本与面板结构不落档，计入 `skipped` |
| 删除 | 不回溯删除已记录消息；只追加 tombstone。实时采集能补被删内容，回放通常只有 target id |
| 赠送会员金额 | YouTube 不回传赠送单价，只有 `giftCount` |
| 汇率 | SC / 贴纸金额不换算，按币种分组 |
| `owner` 判定 | 置顶、投票、Q&A、商品默认按主播操作处理；版主置顶可能也被标为 `owner` |
| 会员限定 | 实时 / 回放需要 cookie；匿名通常停在 `unplayable` |
| 坏行 | JSONL 解析失败计 `invalid`，采集器会清理坏行；不阻塞其余记录 |
| 全量明细 | pack 不含全量弹幕；完整时间线必须读 jsonl 或未来的 `chat_events` 表 |

## 11. 版本演进

- 新字段一律可选，旧记录缺失时用 `null` / 默认值；不要改变已有字段的含义。
- `kind` 的六种值不扩展；会员留言用 `kind: "text"` + `memberMessage`，不要新增 `memberMessage` kind。
- 新事件类型追加到 `ChatEventType`，同时更新本表、`validate-schema.ts` 和 pack 类型。
- 删除字段或改变语义时提升 pack schema 版本，并在 `stream-datapack` 做兼容或迁移。
- 事件文件是本地真源，`raw` 保留原始 renderer；pack 只保留紧凑字段。

## 12. 示例

普通文字 + 频道表情：

```json
{"seq":1,"video":"vid","ts":1793718917,"rendererId":"Chw...","msg":{"author":"@viewer","authorId":"UC...","text":"おめでとう ","kind":"text","emoji":[{"id":"UC99kOG6_9RD0mR3OG4EOfxw/54y5aK3nFd-QoPwPxrGNqQk"}],"badges":["Member"]}}
```

会员留言：

```json
{"seq":2,"video":"vid","ts":1793721454,"rendererId":"Chw...","msg":{"author":"@イカコさん","authorId":"UC8-...","text":"今月もよろしくお願いします","kind":"text","badges":["Member"],"header":"もぐもぐ","membershipPrimary":"Member for 25 months","memberMessage":true}}
```

投票事件：

```json
{"seq":1,"video":"vid","at":1793763750,"type":"poll","owner":true,"author":"@yuno_yumemita","text":"ゆのちゃん、おたんじょうび","id":"poll:ゆのちゃん、おたんじょうび","data":{"pollKey":"ゆのちゃん、おたんじょうび","snapshotKey":"[...]","pollType":"LIVE_CHAT_POLL_TYPE_CREATOR","metadata":"@yuno_yumemita • 13h ago • 387 votes","choices":[{"text":"おめでとう","selected":false,"percentage":"26%","ratio":0.2558}]}}
```

置顶事件：

```json
{"seq":2,"video":"vid","at":1793718010,"type":"banner","owner":true,"author":"@yuno_yumemita","text":"置顶 @yuno_yumemita：３さい…","id":"banner:live-chat-banner:...","data":{"header":"Pinned by @yuno_yumemita","pinnedAuthor":"@yuno_yumemita","pinnedAuthorId":"UC99kOG6_9RD0mR3OG4EOfxw","pinnedKind":"text","pinnedEmojis":["UC99kOG6_9RD0mR3OG4EOfxw/..."],"targetId":"live-chat-banner","actionId":"Chw..."}}
```

删除事件：

```json
{"seq":3,"video":"vid","at":1793763740,"type":"deleted","owner":false,"text":null,"id":"deleted:Chw...","data":{"targetItemId":"Chw...","action":"removeChatItemAction"}}
```

## 13. 校验与命令

```bash
# 实时 / 等待室：先取一页，确认 token 与字段
bun run fetch:live-chat --video <videoId> --once --dry-run

# 已结束：InnerTube 回放（默认 auto）
bun run fetch:danmaku --dataset yuno --video <videoId> --dry-run
bun run fetch:danmaku --dataset yuno --video <videoId> --engine innertube

# 生成 pack 后校验字段
bun run validate:data
bun run db:ingest --dataset yuno
bun run db:verify --dataset yuno
```

写入 `stream_details.events` 前需要应用迁移：

```bash
bun run db:migrate
```
