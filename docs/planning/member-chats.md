# 成员串门发言（chat.memberChats）

其它 4 位成员的 YouTube 账号会在彼此的直播间发言。这些消息不带 `Owner` 徽章，但都带 `Moderator` 徽章；
它们和普通观众消息混在一起，目前 pack 只保留聚合与 `ownerChats`，页面上看不到。

本方案把「非本场主播的团体成员发言」单独收进 `chat.memberChats`，在单场 `?view=words` 增加一个独立区块。
它是彩蛋级信息，不进入主播发言列表，也不改变现有统计口径。

## 1. 识别口径

- 身份以 `authorExternalChannelId`（归一化后的 `msg.authorId`）为准，与 `data-sources.json` 的 `channelId` 精确匹配。
- 排除本场 dataset 自己的 `channelId`：主播在自己直播间的消息仍归 `ownerChats`（`Owner` 徽章）。
- 没有 `authorId` 的旧记录不猜身份，直接跳过。昵称形如 `@yuno_yumemita`，但显示名可改，只作展示。
- 不能按 `Moderator` 徽章判断：频道版主里还有普通观众。

2026-11-18 对本地 1,909 场归档的核对：

| 项 | 数字 |
| --- | --- |
| 含其他成员发言的场次 | 143 |
| 消息条数 | 596 |
| yuno / nonoka / arale / ritsu / miyako | 381 / 110 / 59 / 28 / 18 条 |
| 这些消息的徽章 | 全部为 `Moderator`，0 条 `Owner` |

分布很偏：yuno 占 64%，出现在 94 场；单场最多是 2024-02-07 峰月律场（4 人共 47 条）。

## 2. 数据契约

`chat.memberChats?: MemberChat[]`，按时间升序，全量，单场通常 0–50 条。

```ts
interface MemberChat {
  at: string                 // JST ISO
  memberId: string           // data-sources.json 的 dataset id，如 "yuno"
  memberLabel: string        // 展示名，如 "千石ユノ"
  author: string             // 聊天显示名，如 "@yuno_yumemita"
  authorId: string           // 频道 ID
  kind: "text" | "superchat" | "sticker" | "membership" | "gift"
  text: string
  emojis?: string[]
}
```

- 旧 pack 缺这个字段，读取侧按空数组处理。
- 不新增计数字段；条数 = 数组长度，成员数由前端分组得到。
- `memberLabel` 随 pack 落库，避免页面再查一次数据集索引；与 `video.channelName` 同样的冗余策略。

## 3. 页面

- `?view=words` 在「主播本人发言」下方增加「成员发言」区块。
- 按 `memberId` 分组，组头显示成员名、聊天昵称、条数；组内沿用现有发言行的样式（时间跳 YouTube、正文、频道表情）。
- 弹幕构成里增加一行「其他成员发言」，仅在有条目时显示。
- 不做筛选、搜索或独立子视图；信息量小，单独区块足够。

## 4. 回填方案（待执行）

历史 143 场要上屏，pack 必须先补字段。数据都在本地 `danmaku_*.jsonl`，不需要重抓。

步骤：

1. 本地：`bun scripts/oneoff/backfill-member-chats.ts --dry-run` 列出目标。
2. 本地：`--no-upload` 只改 `data/<datasetId>/*.datapack.json`，抽样核对条数与时间。
3. `bun run ymmt db ingest --dataset <id> --ids <清单>` 写入本地库，页面走查。
4. 线上：去掉 `--no-upload` 上传 pack 到对象存储，再按 dataset 分批 ingest；单批超过 10 个场次就拆。
5. 完成后跑 `validate data` 与 `db verify`，再删临时脚本。

脚本只处理「已有 pack 且缺 `memberChats`」的场次；写空数组表示「已确认没有其他成员发言」，可反复执行。
找不到对应会话 jsonl 的场次跳过并记录，不阻塞其余场次。

2026-11-18 已在本地执行 1–3：更新 142 场（42 场缺会话跳过），全量 ingest 后 `db verify` 0 问题。
第 4 步（线上 pack / 对象存储）尚未执行。

## 5. 验收

- [ ] 本场 `EJ1DNBxLjN4` 的 pack 含 18 条 yuno 发言，页面区块可见，时间可跳 YouTube。
- [ ] 单人场 / 无成员发言的场次不渲染空区块。
- [ ] 主播消息仍只出现在 `ownerChats`，不重复进入 `memberChats`。
- [ ] 旧 pack（无字段）读取不报错，页面不渲染区块。
- [ ] `bun run check`、`bun run build`、`bun run validate data` 通过。

## 6. 未决

- 是否把成员发言计入 `chat.badges` 之外的独立统计（站点级「串门次数」）？先不做。
- 是否按成员给固定色？等真实页面上屏后再判断，避免多一套颜色 Token。
