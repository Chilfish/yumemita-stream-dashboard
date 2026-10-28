# data/

**本地暂存区，不进 git。** 真源是每个 dataset 下的 `*.datapack.json`，发布时由它们派生出
`manifest.json` 与 `insights.json`，三者一起上传到对象存储（R2 等）。

```text
data/
└─ nonoka/
   ├─ <videoId>.datapack.json   # 每场完整数据（真源）
   ├─ manifest.json             # 由 pack 派生
   ├─ insights.json             # 由 pack 派生
   └─ .fetch-state/             # 抓取进度（fetch:streams 用）
```

## 当前数据集

| id | 成员 | 场次 | 时间范围 | channelId |
| --- | --- | --- | --- | --- |
| `nonoka` | 宮永ののか | 262 | 2023-11-19 – 2026-10-22 | `UCGeCnpimiSN5rgiKbJzHd3A` |

- 抓取进度、跳过判定与下一批候选见 [../docs/data-progress.md](../docs/data-progress.md)。
- `<videoId>.datapack.json`：每场完整数据，schema `yumemita.stream-datapack/v1`。
- `manifest.json` / `insights.json`：`bun run publish:data` 生成，不要手改。

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
# 单场：放进暂存区并更新本地 manifest
bun run add:datapack nonoka /path/to/<videoId>.datapack.json

# 从全部 pack 重建 manifest + insights，并上传到 R2
bun run publish:data

# 构建/开发前同步到 public/data
bun run sync:data
bun run validate:data
```

`sync:data` 在配了 `VITE_DATAPACK_BASE` 时从对象存储拉 manifest/insights（带本地缓存），
没配时直接用这里的本地文件，离线也能开发。

## 不要放什么

- 原始视频/音频、弹幕原始 JSONL、评论原始 JSON。
- cookie、token、邮箱、付款信息等隐私数据。
- `public/data/`（生成物）。
