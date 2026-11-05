---
编号: 001
主题: yt-dlp 字幕的直播段与回放段重复，弹幕 / SC 双倍入库
日期: 2026-11-05
严重级别: SEV-2
分类: 缺陷
状态: Mitigated
根因归类: 设计建模
---

# 001 — yt-dlp 字幕的直播段与回放段重复，弹幕 / SC 双倍入库

## 摘要

`fmjJNbzcr3g` 的 `danmaku_*.jsonl` 有 32,343 条，其中 10,285 条重复，SC 与普通弹幕都被计了两次。yt-dlp 的 `live_chat` 字幕同时包含直播段和从头重写的回放段（`REPLAY_VEM*` 播放器提示之后重新开始），`normalizeLiveChat` 按 action 顺序全部写出，没有去重。`fetch:danmaku` 的合并去重只在 `danmaku_live_*.jsonl` 存在时执行，只跑 yt-dlp 链路的场次不会触发，重复直接落盘并进入 pack / 数据库。

## 影响

- 该场弹幕总数、SC 条数 / 金额、词频与发言者统计都按两份累计：重复段覆盖前 10,285 条消息，其中 178 条 SC（该场唯一 SC 287 条）。
- 本地 616 场存档扫描后只发现这一场受影响，其余 `dupRecords=0`。
- 已重新归一化该场文件：32,343 → 22,058 条，重复 0，SC 287 条。

## 时间线

| 日期 / commit | 事件 |
| --- | --- |
| 2026-11-04 | `fetch:danmaku` / `fetch:streams` 抓取 `fmjJNbzcr3g`，yt-dlp 字幕写入时未去重 |
| 2026-11-05 | 反馈「获取弹幕时 SC 没有去重」，按 `rendererId` 复现，确认普通弹幕同样重复 |
| 2026-11-05 | `normalizeLiveChat` 增加 `DanmakuKeySet` 去重与 `duplicates` 计数；补单元测试；重新生成受影响文件 |

## 根因分析（blameless）

1. yt-dlp 把直播段和回放段写进同一份 `.live_chat.json`，同一 `renderer.id` 出现两次；这是上游的真实输出，不是脚本拼接错误。
2. 归一化函数只做渲染，不做去重；去重责任被放在「合并两份文件」的步骤里。
3. 合并步骤以 `danmaku_live_*.jsonl` 存在为前提；单跑 yt-dlp 回放时没有实时文件，去重逻辑整体被跳过。
4. 单测只覆盖「两份文件之间去重」，没有覆盖「同一份字幕内部重复」。

## 触发条件

直播期间已经用 yt-dlp 抓过一次 `live_chat`，结束后同一字幕文件又追加 / 重写了完整回放段；且该场没有 `danmaku_live_*.jsonl`（没有走 InnerTube 实时采集）。

## 检测

用户对比 SC 条数时发现。检测盲区：`ingest` 与对账都不校验 `rendererId` 唯一性，重复记录在总量、图表与词频里看起来只是「这场很热闹」。

## 处置

- `normalizeLiveChat` 写文件前用 `DanmakuKeySet` 按 `rendererId`（缺失时内容键）去重，重复条数写入 `NormalizeResult.duplicates`；`fetch:danmaku` 发现重复时打印提示。
- 用原始 `.live_chat.json` 重新生成受影响场次的 `danmaku_*.jsonl`，原文件可由 raw 随时重建。

## 做得对的地方

- 原始 `.live_chat.json` 保留在会话目录，问题可复现、可重建。
- `DanmakuKeySet` 已有「带 id 记录不互相按内容键判重」的规则，归一化直接复用，没有引入第二套去重口径。

## 行动项

### 缓解（针对已发生的具体缺口）

- [x] `normalizeLiveChat` 增加去重与 `duplicates` 计数（维护者）
- [x] 补单测：同一份字幕里重复的 SC / 普通弹幕只保留一条，故意去掉去重会变红（维护者）
- [x] 重新生成 `fmjJNbzcr3g` 的 `danmaku_*.jsonl`（维护者）
- [ ] 重新生成该场 pack 并 `db:ingest`，让数据库统计与文件一致（维护者）

### 预防（针对整类问题）

- [x] 测试覆盖整类输入：同一来源内部重复，而不只跨文件重复
- [x] 排查脚本的「只查参数」路径不再触发副作用：`ingest-db` 支持 `--help`，未知参数打印警告
- [ ] 对账时抽查 `rendererId` 唯一性（P2，数据量允许后再做）

## 教训

归一化是「一条消息一条记录」的最后一道关：去重不能依赖后续合并步骤，也不能假设合并一定被执行。写码前自查「同一份上游文件里会不会重复」。

## Changed Files

```text
scripts/lib/live-chat.ts
scripts/lib/live-chat.test.ts
scripts/fetch-danmaku.ts
scripts/ingest-db.ts
docs/data/chat-events.md
docs/planning/backlog.md
docs/development-log/2026-11-05.md
docs/postmortem/README.md
docs/postmortem/001-yt-dlp-chat-duplicate.md
```

## 关联报告

- 无
