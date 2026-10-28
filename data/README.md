# data/

源数据目录。每个 dataset 一个子目录：

```text
data/
└─ nonoka/
   ├─ manifest.json
   └─ <videoId>.datapack.json
```

## 当前数据集

| id | 成员 | 场次 | 时间范围 | channelId |
| --- | --- | --- | --- | --- |
| `nonoka` | 宮永ののか | 48 | 2024-12-13 – 2026-10-22 | `UCGeCnpimiSN5rgiKbJzHd3A` |

- 抓取进度、跳过判定与下一批候选见 [../docs/data-progress.md](../docs/data-progress.md)。

- `nonoka/manifest.json`：场次摘要索引（由 `scripts/stream-datapack.ts` 维护）。
- `nonoka/<videoId>.datapack.json`：每场完整数据，schema `yumemita.stream-datapack/v1`。

## 文件命名

- 文件名 = YouTube videoId（11 位），与 manifest 的 `streams[].videoId` 必须一致。
- 不要用标题做文件名：标题会变、会重复、含特殊字符。

## 来源

由上层归档工程的 `stream-datapack` pipeline 生成：

- yt-dlp 元信息（开播时刻、时长、标题、简介）
- 弹幕 `live_chat` 全量
- 评论区
- VSTATS 单场快照（平均/最大同接、视聴时间、播放、点赞）

本仓库只存放结果，不包含抓取脚本与原始媒体。

## 更新

```bash
# 单场
bun run add:datapack nonoka /path/to/<videoId>.datapack.json

# 批量/手工后
bun run sync:data
bun run validate:data
```

`sync:data` 会生成 `public/data/`（gitignore），浏览器只读生成物。

## 不要放什么

- 原始视频/音频、弹幕原始 JSONL、评论原始 JSON。
- cookie、token、邮箱、付款信息等隐私数据。
- `public/data/`（生成物）。

字段与口径见 [../docs/data-model.md](../docs/data-model.md)。
