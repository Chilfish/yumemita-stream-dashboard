# data/

**本地暂存区，不进 git。** 真源是每个 dataset 下的 `*.datapack.json`；`db:ingest` 把它们投影到
PostgreSQL，`publish:assets` 上传封面 / 表情 / archive。`manifest.json` / `insights.json` 只作本地派生与调试。

```text
data/
├─ .publish-state.json           # 资产上传进度（publish:assets 用）
└─ nonoka/
   ├─ <videoId>.datapack.json   # 每场完整数据（真源）
   ├─ manifest.json             # 由 pack 派生
   ├─ insights.json             # 由 pack 派生
   └─ .fetch-state/             # 抓取进度（fetch:streams 用）
```

## 当前数据集

场次以数据库 `streams` 为准（本地 pack 可能少几场未恢复的历史数据）：

| id | 成员 | 场次 | channelId |
| --- | --- | ---: | --- |
| `nonoka` | 宮永ののか | 288 | `UCGeCnpimiSN5rgiKbJzHd3A` |
| `arale` | 仲町あられ | 506 | `UCWfF0DB6m_t2CE3KcOOOX7g` |
| `ritsu` | 峰月律 | 340 | `UCxc0MrPoACKTFlV24GqX2sg` |
| `miyako` | 藤都子 | 322 | `UCZXxRYaP7mfuglPnptnBBCA` |
| `yuno` | 千石ユノ | 441 | `UC99kOG6_9RD0mR3OG4EOfxw` |

- 抓取进度、跳过判定与下一批候选见 [../docs/data/data-progress.md](../docs/data/data-progress.md)。
- `<videoId>.datapack.json`：每场完整数据，schema `yumemita.stream-datapack/v1` 或 `/v2`（新抓取写 v2）。
- `manifest.json` / `insights.json`：由 `publish:data` 本地派生，不要手改；页面不读它们。

## 文件命名

- 文件名 = YouTube videoId（11 位），与 manifest 的 `streams[].videoId` 必须一致。
- 不要用标题做文件名：标题会变、会重复、含特殊字符。

## 来源

由上层归档工程的 `stream-datapack` pipeline 生成：

- yt-dlp 元信息（开播时刻、时长、标题、简介）
- 弹幕 `live_chat` 全量
- 评论区
- VSTATS 单场快照（平均/最大同接、视听时间、播放、点赞）

本仓库只存放结果，不包含抓取脚本与原始媒体。

## 更新

```bash
# 单场：放进暂存区并更新本地 manifest
bun run add:datapack nonoka /path/to/<videoId>.datapack.json

# 投影到 Neon PostgreSQL（增量；先 --limit 小批量验证）
bun run db:ingest
bun run db:verify

# 上传封面 / 表情 / archive（增量）
bun run publish:assets
bun run purge:cache --dataset <id>
bun run validate:data
```

页面请求期查数据库；本地 pack 仍是唯一真源。R2 只保留封面、表情、逐字稿正文与原始 pack 归档。

## 不要放什么

- 原始视频/音频、弹幕原始 JSONL、评论原始 JSON。
- cookie、token、邮箱、付款信息等隐私数据。
- `dist/`、`.wrangler/`、`.dev.vars`（构建产物与本地凭据）。
