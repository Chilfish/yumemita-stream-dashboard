# 增加数据

## 数据从哪来

页面消费的是 `stream-datapack` 生成的归一化 JSON。生产这些 JSON 的 pipeline（yt-dlp 元信息 / 弹幕 / 评论区 / VSTATS 快照）不在本仓库内。

- **场次索引与预聚合**（`manifest.json` / `insights.json`）提交进本仓库。
- **逐场 datapack** 上传到对象存储（Cloudflare R2 等），不进 git；浏览器按 `VITE_DATAPACK_BASE/<datasetId>/<videoId>.datapack.json` 拉取。
- `data/<datasetId>/` 下的 datapack 只是上传前的本地暂存区。

## 目录约定

```text
data/
├─ README.md
└─ <datasetId>/
   ├─ manifest.json            # 场次索引（提交）
   ├─ insights.json            # 预聚合摘要（提交）
   └─ <videoId>.datapack.json  # 上传前的本地暂存区（不提交）
```

- `datasetId`：小写字母/数字/连字符，例如 `nonoka`。
- `videoId`：YouTube 11 位 id，也是 datapack 文件名。
- `manifest.json` / `insights.json`：由 `publish:data` 从 pack 派生，不要手改。

## 加一场直播

```bash
# 1. 放进暂存区，顺带更新本地 manifest
bun run add:datapack nonoka /path/to/abc123XYZ.datapack.json

# 2. 由全部 pack 重建 manifest + insights，并上传到 R2
bun run publish:data

# 3. 本地看效果
bun run sync:data
bun run validate:data
bun run dev
```

`add:datapack` 会校验 `schema` / `video.id`，复制到 `data/nonoka/`，并按开播时间重排本地 manifest 的 `rank`。
真正的 manifest 与 insights 以 `publish:data` 的重算结果为准。

### 手工加（不用脚本）

1. 复制 `<videoId>.datapack.json` 到 `data/<datasetId>/`。
2. `bun run publish:data` 重建 manifest + insights 并上传。

不需要手写摘要：manifest 完全由 pack 派生。

## 加一位成员 / 新 dataset

1. 新建目录 `data/<id>/`，放入所有 `<videoId>.datapack.json`。
2. 在 `data-sources.json` 增加一条：

```json
{
  "datasets": [
    {
      "id": "arare",
      "label": "仲町あられ",
      "channelId": "UC...",
      "manifest": "data/arare/manifest.json",
      "datapackDir": "data/arare",
      "subject": "仲町あられ",
      "scope": "按频道顺序补齐的历史场次",
      "note": ""
    }
  ]
}
```

3. `bun run publish:data --dataset arare` 生成并上传该 dataset 的 manifest / insights。
4. `bun run sync:data`，`public/data/index.json` 会多一条 dataset，页面顶部自动出现选择器。

不需要改 React 组件。

## manifest 从哪来

不需要手工维护。`publish:data` 用 `scripts/lib/dataset-manifest.ts` 的 `buildStreamSummary`
从每个 pack 抽出摘要，按开播时间倒序重排 `rank`，并写回 `count` / `generatedAt`。
`subject` / `scope` / `note` 来自 `data-sources.json`。

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

- **git 里不存数据**：只有 `data-sources.json` 和 `data/README.md`。
- datapack 合计约 7 MB（262 场，均 26 KB），放在对象存储；几千场也不会撑大仓库。
- `data/<id>/` 下的 pack、manifest、insights 都是本地暂存/派生物，已 gitignore。
- `public/data/` 是构建生成物，同样不提交。
- 回滚数据靠对象存储的版本控制，不是 `git revert`。

## 隐私与版权

- 会员限定 / 会限内容可能不适合公开部署；上线前确认范围。
- 原始内容版权归权利人，详见 [NOTICE.md](../NOTICE.md)。
- 不要把包含个人隐私的原始抓取（cookie、邮箱、付款信息）放进仓库；datapack 只应包含聚合后的公开字段。
