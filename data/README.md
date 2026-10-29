# data/

**本地暂存区，不进 git。** 真源是每个 dataset 下的 `*.datapack.json`，发布时由它们派生出
`manifest.json`、`insights.json`，以及桶根的 `index.json`，一起上传到对象存储（R2 等）。

```text
data/
├─ .publish-state.json           # 发布进度（publish:data 用，增量上传）
└─ nonoka/
   ├─ <videoId>.datapack.json   # 每场完整数据（真源）
   ├─ manifest.json             # 由 pack 派生
   ├─ insights.json             # 由 pack 派生
   └─ .fetch-state/             # 抓取进度（fetch:streams 用）
```

## 当前数据集

| id | 成员 | 场次 | 时间范围 | channelId |
| --- | --- | ---: | --- | --- |
| `nonoka` | 宮永ののか | 287 | 2023-11-19 – 2026-10-29 | `UCGeCnpimiSN5rgiKbJzHd3A` |
| `arale` | 仲町あられ | 286 | 2025-06-08 – 2026-10-29 | `UCWfF0DB6m_t2CE3KcOOOX7g` |
| `ritsu` | 峰月律 | 339 | 2023-11-19 – 2026-10-27 | `UCxc0MrPoACKTFlV24GqX2sg` |
| `miyako` | 藤都子 | 321 | 2023-11-18 – 2026-10-28 | `UCZXxRYaP7mfuglPnptnBBCA` |
| `yuno` | 千石ユノ | 236 | 2025-05-08 – 2026-10-24 | `UC99kOG6_9RD0mR3OG4EOfxw` |

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

# 从全部 pack 重建 index + manifest + insights，并增量上传到 R2
bun run publish:data

# 生成 public/data/ 兜底快照并校验
bun run sync:data
bun run validate:data
```

页面运行时直接读对象存储，发布后刷新即可。`sync:data` 在配了 `VITE_DATAPACK_BASE` 时从远端拉
index/manifest/insights（带本地缓存）写进 `public/data/`，没配时直接用这里的本地文件，离线也能开发。

## 不要放什么

- 原始视频/音频、弹幕原始 JSONL、评论原始 JSON。
- cookie、token、邮箱、付款信息等隐私数据。
- `public/data/`（生成物）。
