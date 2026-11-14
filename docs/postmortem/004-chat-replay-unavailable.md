---
编号: 004
主题: 平台未保留回放被当成「直播尚未结束」，无弹幕场次每轮重试
日期: 2026-11-14
严重级别: SEV-3
分类: 缺陷
状态: Mitigated
根因归类: 设计建模
---

# 004 — 平台未保留回放被当成「直播尚未结束」，无弹幕场次每轮重试

## 摘要

`collectReplay()` 用 `liveChatRenderer.isReplay` 判断 watch 页是否存在回放。YouTube 对一部分场次根本没有保留回放聊天，
这类页面连 `liveChatRenderer` 都不存在，`isReplay` 取不到值（`null`）。于是回放采集走进「还在直播」分支，
`data danmaku` 报「直播尚未结束，实时采集请用 fetch:live-chat」，既不写 `chat-unavailable.txt`，
也不让场次进入终态，每轮补抓都会重试一次并计为失败。

## 影响

- 用户可见：单场页 / 数据集汇总里这类场次的弹幕数据恒为 0，页面上看不出「平台没有」还是「我们没抓到」。
- 返工：每轮 `data danmaku` 都会把这类场次当失败重试，抓取日志被打成失败。
- 隐藏风险：错误信息把「已结束的 2024 年回放」描述成「直播中」，会把人引向「等直播结束再抓」的错误结论。

## 时间线

| 日期 / commit | 事件 |
| --- | --- |
| 2026-11-14 | 排查 `6CRIOtWb-Og` 无弹幕，发现 watch 页 `availabilityMessage` 明确写着未保留回放 |
| 2026-11-14 | 同日其他场次在同样登录态下 `isReplay: true`，确认不是 cookie / bot 检查导致 |
| 2026-11-14 | `yt-dlp -J` 带 cookie 也没有 `live_chat` 字幕，确认平台侧缺失 |
| 2026-11-14 | 新增 `isChatReplayUnavailable()`，回放采集据此返回 `no-replay` 并跳过 yt-dlp 回退 |

## 根因分析（blameless）

1. `WatchStatus` 里「有没有回放」只建模成三态 `boolean | null`，`null` 既可能是「还没判定出来」，也可能是「页面没有这个字段」。
   回放采集把 `null` 归进「非回放 = 还在直播」，把「字段缺失」误读成「状态未知但仍在直播」。
2. 同一模块里已经有一个能正确判定终态的 `classifyWatchStatus()`（依据 `isLiveNow` / `endTimestamp` / `availabilityMessage`），
   但回放路径没有复用它，只读了单一字段。
3. 平台把「没有回放」表达成 `availabilityMessage` 的自由文本，没有独立的状态位；正则只覆盖了 `chat disabled`，没覆盖 `replay not available`。

## 触发条件

场次由 YouTube 侧决定不保留聊天回放（关闭聊天、早期直播、版权或地区原因等）。
用户侧没有任何前置条件，只要该场进入 `data danmaku` 的候选就会触发。

## 检测

由「为什么这场没有弹幕」的人工提问暴露。检测盲区：`no-replay` 与 `live` 两种结果在统计里分别是「无回放」和「失败」，
后者会被当成可重试的临时问题，日志里没有区分「平台没有」与「我们没拿到」。

## 处置

- `scripts/lib/innertube-live.ts` 新增 `isChatReplayUnavailable(status)`：只认 `availabilityMessage` 里的
  `live chat replay is not available/unavailable`，`isReplay === true` 时不成立。
- `scripts/lib/live-chat-collect.ts`：无 continuation 时改用 `isReplay === true || isChatReplayUnavailable()` 判定 `no-replay`，
  命中时给出 `reason: 'chat-replay-unavailable'`，让调用方能区分原因。
- `scripts/commands/data/danmaku.ts`：auto 模式拿到该原因不再回退 yt-dlp（字幕同样不存在），直接写 `chat-unavailable.txt`。
- `scripts/commands/data/live-chat.ts`：实时采集转回放且平台未保留时，日志不再提示「重跑会续翻」。
- 文档：`docs/data/chat-events.md` §10 补「平台未保留回放」一行。

## 做得对的地方

- `classifyWatchStatus()` 早已把 `availabilityMessage` 纳入判定，修复是复用它而不是再写一套状态机。
- 哨兵 `chat-unavailable.txt` 有 30 天有效期，平台若日后补开回放仍会被重新尝试。
- 单场 pack 明确记录 `video.hasLiveChatReplay`，从数据侧就能先分辨「平台没有」与「我们没抓到」。

## 行动项

### 缓解（针对已发生的具体缺口）

- [x] 识别平台未保留回放并返回 `no-replay`（维护者）
- [x] auto 模式跳过无意义的 yt-dlp 回退（维护者）
- [x] 单元测试覆盖 `isReplay: null` + 未保留回放的组合（维护者）

### 预防（针对整类问题）

- [x] 回放采集复用 `availabilityMessage` 判定，不再只看单一布尔字段（维护者）
- [ ] 抓取汇总里把「平台未保留」与「请求失败」分成两个计数，日志层面可区分（维护者）

## 教训

1. 三态字段（`boolean | null`）的 `null` 要区分「未判定」与「不存在」，不能按「另一种 false」处理。
2. 外部系统把状态表达成自由文本时，正则要覆盖它实际会出现的说法；同一模块里已有的状态判定应复用而不是重写。

## Changed Files

```text
scripts/lib/innertube-live.ts
scripts/lib/live-chat-collect.ts
scripts/commands/data/danmaku.ts
scripts/commands/data/live-chat.ts
tests/scripts/lib/innertube-live.test.ts
tests/scripts/lib/live-chat-collect.test.ts
docs/data/chat-events.md
docs/development-log/2026-11-14.md
```

## 关联报告

- [001](./001-yt-dlp-chat-duplicate.md)：同属「采集路径对同一份数据的判定口径不一致」
- [003](./003-stale-yt-cookies-cache.md)：同属「外部系统的可用性被本地单向推断」
