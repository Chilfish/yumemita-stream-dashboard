# 增加数据

## 数据从哪来

页面消费的是 `stream-datapack` 生成的归一化 JSON。生产这些 JSON 的 pipeline（yt-dlp 元信息 / 弹幕 / 评论区 / VSTATS 快照）不在本仓库内。

- **当前页面读 PostgreSQL**：`db:ingest` 把 `data/<datasetId>/*.datapack.json` 投影到 Neon，页面请求期查库。
- **本地 pack 是唯一真源**：`data/<datasetId>/` 不进 git；manifest / insights 仍是本地派生物。
- **R2 只保留对象**：封面、表情、逐字稿正文、原始 pack 归档。`publish:assets` 不再写 index / manifest / insights。
- 数据更新后不需要重新构建前端；需要让缓存失效时调内部 purge 端点。

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
- `manifest.json` / `insights.json`：由 `publish:data` 本地派生，页面不读；不要手改。

## 加一场直播

```bash
# 1. 放进暂存区，顺带更新本地 manifest
bun run add:datapack nonoka /path/to/abc123XYZ.datapack.json

# 2. 投影到 PostgreSQL（增量，按 content_hash 跳过未变化场次）
bun run db:ingest -- --dataset nonoka

# 3. 对账 + 本地看效果
bun run db:verify -- --dataset nonoka
bun run dev
```

`add:datapack` 会校验 `schema` / `video.id`，复制到 `data/nonoka/`，并按开播时间重排本地 manifest 的 `rank`。
数据库里的 `streams` / `dataset_insights` 以 `db:ingest` 的结果为准。

### 手工加（不用脚本）

1. 复制 `<videoId>.datapack.json` 到 `data/<datasetId>/`。
2. `bun run fetch:thumbs --dataset <id>` 补封面。
3. `bun run db:ingest --dataset <id>` 写库。
4. `bun run publish:assets --dataset <id>` 上传封面 / 表情 / archive。
5. `bun run purge:cache --dataset <id>` 失效缓存。

不需要手写摘要：`streams` 与 `dataset_insights` 完全由 ingest 从 pack 派生。

## 本地已最新，同步到线上

本地 pack、封面、逐字稿都齐了以后，用一条命令按线上目标跑完整链路。**默认只同步新增场次**：

```bash
bun run sync:remote -- --dry-run             # 看目标、新增数量与步骤
bun run sync:remote                          # 只新增缺失场次
bun run sync:remote -- --dataset nonoka      # 只同步一位
bun run sync:remote -- --update-existing     # 允许按 hash 刷新已有场次
bun run sync:remote -- --recent-days 30 --update-existing
```

它只读 `.env` 的线上 `DATABASE_URL` / `R2_*`，刻意忽略 `.env.local` 与 `.dev.vars`，并在子进程里设置 `LOCAL=0`；`.env` 指向本机时直接拒绝执行。

默认策略：

- 先查线上已有 `streams.video_id`，只把本地缺失的 ID 传给 ingest / verify / publish；已有场次不读不写。
- 候选窗口默认最近 7 天开播的 pack（`video.startedAt`）；历史场次视为已同步。`--recent-days 0` 检查全部。
- `--update-existing` 才按 `content_hash` 重写已有场次；`--force` 等价于全量重写。
- 逐字稿独立处理：数量有差异时用空 ID 文件只同步 `transcripts` 元数据，不碰 pack。

执行前会做一次只读的数量对比：本地 pack / 封面 / 表情 / 逐字稿 vs 线上 `streams`、`transcripts` 与对象存储 `list()`。`--skip-compare` 可跳过列桶，但仍会查新增 ID。

顺序固定为：

1. `db:migrate`：先应用 `drizzle/` 迁移，线上库 schema 可能落后于本地；
2. `publish:transcripts`：正文先上传，ingest 才能把稿件元数据写进库；
3. `ingest-db --ids <新增>`：只投影新增场次（`--update-existing` 时带最近窗口内的候选 ID）；
4. `refresh-public-totals`：重算受影响成员的 `public_totals`；
5. `verify-db --ids <新增>`：只对本次写入的场次对账；
6. `publish:data --ids <新增>`：只上传这些场次的封面 / 表情 / archive，并刷新索引；
7. `purge-cache`：只失效受影响的 dataset。

上传是增量的：本地摘要 + 远端对象大小核对；本地没有摘要记录时按远端大小对齐。本地模式用的是单独的 `.publish-state.local.json`，不会影响线上增量记录。

可用 `--skip-migrate` / `--skip-transcripts` / `--skip-ingest` / `--skip-refresh` / `--skip-verify` / `--skip-publish` / `--skip-purge` / `--skip-compare` 跳过单步。缓存失效需要 `.env` 里有 `SITE_URL` 与 `PURGE_TOKEN`；缺任一时该步会跳过并提示。

`verify` 默认只警告并继续发布（`--strict-verify` 才中止）：如果本地 pack 在 ingest 之后又被更新，线上库会暂时落后，但不该因此挡住封面 / archive 上传；补完 ingest 后重跑一次 verify 即可。

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

3. `bun run db:ingest --dataset arare` 写入成员与场次；成员入口由数据库查询生成。
4. `bun run publish:assets --dataset arare` 上传封面 / 表情 / archive。
5. `bun run purge:cache --dataset arare`；刷新页面即可，不需要重新构建。

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

导入会按 manifest 补 `date` / `title`，剔除 `<!-- archive-only:start -->` … `<!-- archive-only:end -->` 之间的归档段落；会员限定场次默认拒绝，确需例外加 `--allow-member-only`。

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

完整字段、命令与常见问题见 [content/transcripts/README.md](../../content/transcripts/README.md)。

### 3. 发布

```bash
bun run publish:transcripts --no-upload   # 只校验：缺 videoId / 未知 dataset / 重复 videoId 都会列出来
bun run publish:transcripts               # 增量上传
bun run publish:transcripts --force       # 忽略 data/.publish-state.json，全量重传
```

产物：

```text
<base>/<datasetId>/transcripts/<videoId>.json   # { frontmatter, markdown, updatedAt }
```

- 正文由 Worker 的 `/api/transcripts/:datasetId/:videoId` 从 R2 binding 读取；开发环境没有 R2 时回退到本地 Markdown 快照。
- `ingest-db` 把 frontmatter 写入 `transcripts` 表；单场页与索引页查库决定「有没有稿」。
- 单篇失败只记日志，不阻塞其余稿件；退出码仍为 1，CI 会拦住。
- 发布后执行 `bun run purge:cache --tags transcripts`（或 `--dataset <id>`），不需要重新构建前端。

## 派生数据从哪来

不需要手工维护。`ingest-db` 用 `buildStreamSummary` 从每个 pack 抽出摘要，写入 `streams` 表；
`aggregateDataset` 在成员全部写完时重算 `dataset_insights`。`subject` / `scope` / `note` 来自 `data-sources.json`。

`rank` 不落库，查询时用窗口函数计算；`count` / `generatedAt` 由数据库聚合与 `ingest_reports` 体现。

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
bun run db:ingest -- --dataset <id>
bun run db:verify -- --dataset <id>
bun run dev
```

## 数据体积与 Git

- **git 里不存数据**：只有 `data-sources.json` 和 `data/README.md`。
- 单个 dataset 约 300 场、均 26 KB；几千场也不会撑大仓库。
- `data/<id>/` 下的 pack、manifest、insights 都是本地暂存/派生物，已 gitignore。
- `public/data/` 已删除；页面不再需要构建期快照。
- 回滚数据靠 Neon 分支 / 时间点恢复与 R2 版本控制，不是 `git revert`。

## 隐私与版权

- 会员限定 / 会限场次照常抓取与入库；封面、标题、时间等元数据可公开，弹幕、评论、SC 等明细默认隐藏；**会限场次不推送逐字稿**，稿留在归档侧（`transcript:import` 默认拒绝，确需例外加 `--allow-member-only`）。
- 原始内容版权归权利人，详见 [NOTICE.md](../../NOTICE.md)。
- 不要把包含个人隐私的原始抓取（cookie、邮箱、付款信息）放进仓库；datapack 只应包含聚合后的公开字段。
