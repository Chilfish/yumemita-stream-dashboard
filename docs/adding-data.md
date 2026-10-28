# 增加数据

## 数据从哪来

页面消费的是 `stream-datapack` 生成的归一化 JSON。生产这些 JSON 的 pipeline（yt-dlp 元信息 / 弹幕 / 评论区 / VSTATS 快照）不在本仓库内；本仓库只负责**存放、同步、展示**。

如果你在上层归档工程里生成了新的 datapack：

```text
<archive>/docs/配信数据画像/data/<videoId>.datapack.json
<archive>/docs/配信数据画像/data/batch30_manifest.json
```

把需要的文件搬进本仓库即可，不需要保留对归档目录的引用。

## 目录约定

```text
data/
├─ README.md
└─ <datasetId>/
   ├─ manifest.json
   └─ <videoId>.datapack.json
```

- `datasetId`：小写字母/数字/连字符，例如 `nonoka`。
- `videoId`：YouTube 11 位 id，也是 datapack 文件名。
- `manifest.json`：该 dataset 的场次摘要索引。

## 加一场直播（推荐用脚本）

```bash
bun run add:datapack nonoka /path/to/abc123XYZ.datapack.json
```

脚本会：

1. 校验 `schema` 与 `video.id`；
2. 复制到 `data/nonoka/abc123XYZ.datapack.json`；
3. 从 datapack 抽出 manifest 摘要（同名字段与 `collect-batch` 一致）；
4. 按 `videoId` upsert，按开播时间重排 `rank`；
5. 更新 `count` / `generatedAt`。

然后：

```bash
bun run sync:data
bun run validate:data
bun run dev
```

### 手工加（不用脚本）

1. 复制 `<videoId>.datapack.json` 到 `data/<datasetId>/`。
2. 在 `manifest.json` 的 `streams` 里加一行摘要。字段见 [data-model.md](data-model.md#2-manifest)。
3. `count` +1，`generatedAt` 改成当前时间。
4. `bun run sync:data && bun run validate:data`。

摘要里的数字必须和 datapack 对得上；不确定就优先用脚本，避免手算出错。

## 加一位成员 / 新 dataset

1. 新建目录 `data/<id>/`。
2. 放入 `manifest.json` 与所有 `<videoId>.datapack.json`。
3. 在 `data-sources.json` 增加一条：

```json
{
  "datasets": [
    {
      "id": "nonoka",
      "label": "宮永ののか",
      "channelId": "UCGeCnpimiSN5rgiKbJzHd3A",
      "manifest": "data/nonoka/manifest.json",
      "datapackDir": "data/nonoka"
    },
    {
      "id": "arare",
      "label": "仲町あられ",
      "channelId": "UC...",
      "manifest": "data/arare/manifest.json",
      "datapackDir": "data/arare"
    }
  ]
}
```

4. `bun run sync:data`。`public/data/index.json` 会多一条 dataset，页面顶部自动出现选择器。

不需要改 React 组件。

## manifest 从哪来

如果上游有 `collect-batch.mjs` 之类的脚本，直接用它生成 `batch30_manifest.json`，再改名为 `manifest.json` 放进 `data/<id>/`。手工维护也可以，但请保持以下字段与 datapack 一致：

- `videoId` / `title` / `url` / `startedAt` / `durationSec`
- `chatTotal` / `uniqueAuthors` / `superchats`
- `avgConcurrent` / `maxConcurrent` / `watchTimeHours` / `views` / `likes`
- `commentsCaptured`
- `chatPer1000AvgViewers` / `likesPer1000Views` / `scPerHour`

`rank` / `count` / `generatedAt` 只影响列表顺序和页脚显示。

## 数据检查清单

| 检查项 | 说明 |
| --- | --- |
| schema | 必须是 `yumemita.stream-datapack/v1` |
| `video.id` | 必须等于文件名里的 videoId |
| `startedAt` | 必须带 `+09:00`（JST） |
| `durationSec` | 与 `chat.density.perMinute.length` 大致对应（分钟数） |
| `vstats` | 没有 VSTATS 时保持 `null`，不要填 0 |
| `scTotalsByCurrency` | 金额按原文，不换算汇率 |
| `comments` | 允许 `null`；`comments.total` 是抓取到的条数 |
| `topWords` / `topAuthors` | 允许为空数组；跨场聚合是近似值 |
| 会员限定 | `availability: "subscriber_only"`；确认可公开范围 |

跑一遍：

```bash
bun run sync:data
bun run validate:data
bun run dev
```

## 数据体积与 Git

- 当前 30 场约 **1 MB**，直接提交 JSON 即可，不需要 Git LFS。
- 如果未来超过 ~100 MB，再考虑 LFS 或把数据放到对象存储；页面读取路径不变（仍按 manifest + 文件名）。
- `public/data/` 是生成物，已 gitignore；不要提交。
- `data/` 是源数据，**要提交**。

## 隐私与版权

- 会员限定 / 会限内容可能不适合公开部署；上线前确认范围。
- 原始内容版权归权利人，详见 [NOTICE.md](../NOTICE.md)。
- 不要把包含个人隐私的原始抓取（cookie、邮箱、付款信息）放进仓库；datapack 只应包含聚合后的公开字段。
