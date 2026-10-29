# 数据抓取进度

目标是补齐宫永ののか（`nonoka`）的全频道历史直播，而不只是最初的最近 30 场。本页记录
**抓到哪里了、哪些场次判定跳过、下一批从哪开始**；字段口径见 [data-model.md](data-model.md)。

最后更新：**2026-10-28**

## 总览

| 项 | 值 |
| --- | --- |
| 频道 | 宮永ののか（`UCGeCnpimiSN5rgiKbJzHd3A`） |
| 频道 `/streams` 公开列表 | **262** 条 |
| 已入库 datapack | **262**（公开列表与会员限定场次已全部补齐） |
| 公开列表内待抓 | **0** |
| 已覆盖时间范围 | 2023-11-19 – 2026-10-22 |
| 有 VSTATS 快照的场次 | **15**（越往前越可能缺失） |
| 数据体积 | `data/nonoka/` 约 **6.91 MB** |

抓取来源与命令见 [scripts/README.md](../scripts/README.md)。原始会话留在归档工程
`claude-messages/temp/youtube-live/`，本仓库只接收 datapack。

## 批次一：2026-10-28（+8）

从最近 30 场向前续抓，全部为公开存档：

| 日期 | videoId | 标题 | 时长 | 弹幕 | SC | 评论 | VSTATS |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| 2026-08-09 | [`2nf1sFpZCYs`](https://www.youtube.com/watch?v=2nf1sFpZCYs) | #2 魔法少女ノ魔女裁判 第一回 | 6:13:39 | 4706 | 6 | 7 | — |
| 2026-08-08 | [`3EYGzu9v7Fc`](https://www.youtube.com/watch?v=3EYGzu9v7Fc) | #1 魔法少女ノ魔女裁判 はじまり | 4:42:18 | 5158 | 4 | 17 | — |
| 2026-08-07 | [`brSArzAwakE`](https://www.youtube.com/watch?v=brSArzAwakE) | 完全版前編 ののちゃんに100の質問 | 2:10:08 | 3705 | 10 | 16 | — |
| 2026-07-28 | [`vJPs8vO2b5c`](https://www.youtube.com/watch?v=vJPs8vO2b5c) | 弾き語り ごほうびアコギ練習 | 1:55:51 | 1725 | 10 | 11 | — |
| 2026-07-27 | [`iDX9seQqdbs`](https://www.youtube.com/watch?v=iDX9seQqdbs) | 弾き語り おばあちゃんに弾く曲さがす | 1:52:18 | 2561 | 10 | 8 | — |
| 2026-07-24 | [`1tHjKH2RcLk`](https://www.youtube.com/watch?v=1tHjKH2RcLk) | 弾き語り 今日こそむーどつくる | 1:25:27 | 1321 | 9 | 8 | — |
| 2026-07-23 | [`pIUX59V2ewc`](https://www.youtube.com/watch?v=pIUX59V2ewc) | 弾き語り アニメ6話たいき | 0:57:56 | 1296 | 3 | 4 | — |
| 2024-12-13 | [`TbPTEdGTNhc`](https://www.youtube.com/watch?v=TbPTEdGTNhc) | 名刺づくり改 リベンジ | 1:28:04 | 2514 | 2 | 12 | — |

## 批次二：2026-10-28（+10）

继续按频道顺序向前，覆盖 2026-06-22 – 2026-07-18：

| 日期 | videoId | 标题 | 时长 | 弹幕 | SC | 评论 | VSTATS |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| 2026-07-18 | [`XQkw13WV-Co`](https://www.youtube.com/watch?v=XQkw13WV-Co) | 【真夏】クリスマスをとりかえせ！ | 1:57:55 | 2361 | 9 | 9 | — |
| 2026-07-17 | [`-UEEf-KLg_8`](https://www.youtube.com/watch?v=-UEEf-KLg_8) | 【弾き語り】きんにくつう♪ | 2:22:27 | 2228 | 14 | 7 | — |
| 2026-07-15 | [`3Gf03daGWEo`](https://www.youtube.com/watch?v=3Gf03daGWEo) | 【弾き語り】実写でよるのアコギ練習♪ | 2:59:25 | 3074 | 9 | 12 | — |
| 2026-07-13 | [`ush-zgCYprM`](https://www.youtube.com/watch?v=ush-zgCYprM) | 【弾き語り】きままアコギ練習♪ | 2:14:03 | 2116 | 14 | 12 | — |
| 2026-07-10 | [`pewta0Ojp3g`](https://www.youtube.com/watch?v=pewta0Ojp3g) | 【全国ツアー】ラスト！ゆめんそーれ♪おきなわ♪ | 1:52:05 | 4659 | 17 | 8 | — |
| 2026-06-30 | [`guD0U3vqKuI`](https://www.youtube.com/watch?v=guD0U3vqKuI) | 【弾き語り】アニメ直前！ギター練習。 | 2:49:39 | 1933 | 8 | 4 | — |
| 2026-06-28 | [`dCqRtTlG_YI`](https://www.youtube.com/watch?v=dCqRtTlG_YI) | 【Refind Self】性格診断ゲーム | 4:50:51 | 4262 | 4 | 6 | — |
| 2026-06-27 | [`3SMzyn1ncZs`](https://www.youtube.com/watch?v=3SMzyn1ncZs) | 【7 Days to End with You】 | 8:20:14 | 4594 | 3 | 6 | — |
| 2026-06-24 | [`MzUvKyzL_VQ`](https://www.youtube.com/watch?v=MzUvKyzL_VQ) | 【弾き語り】ギター練習よる。 | 2:04:51 | 1342 | 4 | 10 | — |
| 2026-06-22 | [`ubUgGCFPorw`](https://www.youtube.com/watch?v=ubUgGCFPorw) | 【全国ツアー】振り返り第十七弾！東京！ | 3:05:54 | 2925 | 14 | 8 | — |

`—` 表示站点没有该场条目（`vstats` 为 `null`），不是抓取失败。VSTATS 对该企划的收录从
2026-08 中旬开始，越往前越可能没有；2026-07 及更早的场次实测单场页返回 5 字节空页。

## 判定跳过

| 日期 | videoId | 原因 |
| --- | --- | --- |
| 2026-08-28 | `5APd1wj9QlA` | 4:48 的同名摘要/预告，正片是会员限定的 `8pLN7zBYnc`（2:04:15）。按「同名去重、保留正片」跳过。 |
| — | `2Q5A9SWgHtA` | 未来场占位（yt-dlp 提示 680 天后开播），没有可抓内容。 |

## 批次三：2026-10-28（+214，全量补齐）

继续按频道顺序向前抓取，直到公开列表与会员限定场次全部入库：新增 **214** 场，累计 **262** 场。
逐场清单以 [`data/nonoka/manifest.json`](../data/nonoka/manifest.json) 为准，本页不再逐条抄录。

## 下一批候选

当前没有待抓场次。频道新增直播后，用下面的命令重新生成差值列表：

```powershell
yt-dlp --flat-playlist --print "%(id)s" `
  "https://www.youtube.com/channel/UCGeCnpimiSN5rgiKbJzHd3A/streams" > channel.txt
# 与 data/nonoka/manifest.json 的 streams[].videoId 求差集，保留频道顺序
```

## 更新流程

```powershell
# 一次跑完：频道列表 → meta/弹幕/评论/VSTATS → 每 5 场自动生成 datapack
bun scripts/fetch-streams.ts --dataset nonoka `
  --root "D:/projects/claude-messages/temp/youtube-live" `
  --concurrency 3

# 进度与日志
Get-Content -Wait "D:/projects/claude-messages/temp/youtube-live/.fetch-state/fetch.log"
Get-Content "D:/projects/claude-messages/temp/youtube-live/.fetch-state/fetch-progress.json"

# 最后同步/校验
bun run sync:data
bun run validate:data
```

`--root` 是**原始会话目录**，不是 `data/`；datapack 仍按 `data-sources.json` 写到 `data/nonoka/`。
已入库和已有素材的场次会自动跳过，中断后直接重跑同一条命令即可。

换设备或清掉 `data/` 后不需要先跑别的脚本：本地没有 manifest 时，`fetch-streams` 会先从
`VITE_DATAPACK_BASE`（或 `R2_*` 凭据）恢复 manifest 与缺失的 datapack，再按同样的规则跳过
已抓场次。要强制刷新本地暂存区时加 `--restore`，不想联网时加 `--no-restore`。

## 口径提醒

- **同名去重**：教学/游戏系列会同一标题分多场，manifest 只保留时长正常的正片；摘要、预告、切片不进数据集。
- **会员限定**：`availability: "subscriber_only"` 的场次需要已登录 Firefox cookie 才能取到 chat replay。
- **评论区是抓取上限**：`commentsCaptured` 是 yt-dlp `--write-comments` 抓到的条数，不是视频总评论数。
- **VSTATS 没有历史曲线**：只有平均/最大同接与最大值时刻，且 2026-08 之前大概率没有条目。
- **未来场不要抓**：`live_status` 为 `is_upcoming` / 提示 days until premiere 的直接跳过。
