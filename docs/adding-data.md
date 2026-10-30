# 增加数据

## 数据从哪来

页面消费的是 `stream-datapack` 生成的归一化 JSON。生产这些 JSON 的 pipeline（yt-dlp 元信息 / 弹幕 / 评论区 / VSTATS 快照）不在本仓库内。

- **dataset 索引与预聚合**（`index.json` / `manifest.json` / `insights.json`）由 `publish:data` 从 pack 派生，和 datapack 一起上传对象存储，不进 git。
- **逐场 datapack** 上传到对象存储（Cloudflare R2 等），不进 git；浏览器按 `VITE_DATAPACK_BASE/<datasetId>/<videoId>.datapack.json` 拉取。
- 页面运行时直接读对象存储，发布后刷新即可，不需要重新构建前端。
- `data/<datasetId>/` 下的 pack、manifest、insights 都是上传前的本地暂存/派生物。

## 目录约定

```text
data/
├─ README.md
└─ <datasetId>/
   ├─ manifest.json            # 场次索引（由 pack 派生，本地）
   ├─ insights.json            # 预聚合摘要（由 pack 派生，本地）
   └─ <videoId>.datapack.json  # 唯一真源（本地暂存）
```

- `datasetId`：小写字母/数字/连字符，例如 `nonoka`。
- `videoId`：YouTube 11 位 id，也是 datapack 文件名。
- `manifest.json` / `insights.json`：由 `publish:data` 从 pack 派生，不要手改。

## 加一场直播

```bash
# 1. 放进暂存区，顺带更新本地 manifest
bun run add:datapack nonoka /path/to/abc123XYZ.datapack.json

# 2. 由全部 pack 重建 index + manifest + insights，并增量上传到 R2
bun run publish:data

# 3. 本地看效果（sync 只生成 public/data/ 兜底快照）
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

3. `bun run publish:data --dataset arare` 生成并上传该 dataset 的 manifest / insights，并在最后刷新根 `index.json`。
4. 刷新页面，成员入口自动出现；不需要重新构建。离线开发时再跑 `bun run sync:data` 更新兜底快照。

不需要改 React 组件。

## 加逐字稿

逐字稿是**作者手写的 Markdown**，和抓取数据不同：它进 git，页面只读渲染，站内没有编辑器。

### 1. 建文件

```bash
# 从模板生成，日期 / 标题自动从 data/<dataset>/manifest.json 带出
bun run transcript:new W0bKqP-Eyj4 --dataset nonoka

# 或者把已经写好的 Markdown 复制进来（videoId 可从文件名日期匹配 manifest）
bun run transcript:import "D:/messages/archives/2026-10-13_ライブ振り返り.md" --dataset nonoka
bun run transcript:import "<path>" --dataset nonoka --video-id W0bKqP-Eyj4
```

落到 `content/transcripts/<datasetId>/<videoId>.md`；以 `_` / `.` 开头的文件是草稿，不参与发布。
目标文件已存在时默认拒绝，`--force` 才覆盖。

### 2. 写正文

frontmatter 是极简 YAML（字符串、数字、引号、`[a, b]` 行内数组）：

```markdown
---
videoId: W0bKqP-Eyj4
date: 2026-10-13
title: 【ライブ振り返り】13th ライブをふりかえる
members: [nonoka]
tags: [杂谈, 13th live]
summary: 一场把 13th live 从头聊到尾的复盘。
---

## 开场

[00:00:12] 大家好，今天想聊聊 13th live……
```

- `videoId` 必填且唯一，是关联场次的唯一键；文件名不参与匹配。
- 行首 `[12:34]` / `[1:02:03]` 自动变成 YouTube 深链，可见文本仍是时间码。
- `##` / `###` 生成目录；原始 HTML 不渲染（`react-markdown` 默认安全模式）。

完整字段、命令与常见问题见 [content/transcripts/README.md](../content/transcripts/README.md)。

### 3. 发布

```bash
bun run publish:transcripts --no-upload   # 只校验：缺 videoId / 未知 dataset / 重复 videoId 都会列出来
bun run publish:transcripts               # 增量上传
bun run publish:transcripts --force       # 忽略 data/.publish-state.json，全量重传
```

产物（远端优先，失败回退到构建时的 Markdown 快照，所以本地不发布也能预览）：

```text
<base>/<datasetId>/transcripts/<videoId>.json   # { frontmatter, markdown, updatedAt }
<base>/transcripts/index.json                   # 有稿的场次列表，最后写
```

- 先传正文、最后写索引：中途失败只会「索引少一篇」，不会指向不存在的文件。
- 单篇失败只记日志，不阻塞其余稿件；退出码仍为 1，CI 会拦住。
- 单场页的「逐字稿」分段只在索引里有当前 `videoId` 时出现；索引页在 `#/:datasetId/transcripts`。
- 发布后刷新页面即可，不需要重新构建前端。

## manifest 从哪来

不需要手工维护。`publish:data` 用 `scripts/lib/dataset-manifest.ts` 的 `buildStreamSummary`
从每个 pack 抽出摘要，按开播时间倒序重排 `rank`，并写回 `count` / `generatedAt`。
`subject` / `scope` / `note` 来自 `data-sources.json`。

`rank` / `count` / `generatedAt` 只影响列表顺序和页脚显示。

## 数据检查清单

| 检查项 | 说明 |
| --- | --- |
| schema | `yumemita.stream-datapack/v1` 或 `/v2`（新抓取统一写 v2） |
| `video.id` | 必须等于文件名里的 videoId |
| `startedAt` | 必须带 `+09:00`（JST） |
| `durationSec` | 与 `chat.density.perMinute.length` 大致对应（分钟数） |
| `vstats` | 没有 VSTATS 时保持 `null`，不要填 0 |
| `scTotalsByCurrency` | 金额按原文，不换算汇率 |
| `comments` | 允许 `null`；`comments.total` 是抓取到的条数 |
| `topWords` / `topAuthors` | 允许为空数组；v2 另有全量 `wordCounts` / `authors`，跨场精确聚合依赖它们 |
| 会员限定 | `availability: "subscriber_only"`；确认可公开范围 |

跑一遍：

```bash
bun run sync:data
bun run validate:data
bun run dev
```

## 数据体积与 Git

- **git 里不存数据**：只有 `data-sources.json` 和 `data/README.md`。
- 单个 dataset 约 300 场、均 26 KB，放在对象存储；几千场也不会撑大仓库。
- `data/<id>/` 下的 pack、manifest、insights 都是本地暂存/派生物，已 gitignore。
- `public/data/` 是构建生成物，同样不提交。
- 回滚数据靠对象存储的版本控制，不是 `git revert`。

## 隐私与版权

- 会员限定 / 会限内容可能不适合公开部署；上线前确认范围。
- 原始内容版权归权利人，详见 [NOTICE.md](../NOTICE.md)。
- 不要把包含个人隐私的原始抓取（cookie、邮箱、付款信息）放进仓库；datapack 只应包含聚合后的公开字段。
