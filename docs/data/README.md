# 数据文档（Data）

本目录记录数据模型、加数据流程与抓取进度。当前数据链路是「本地 pack → R2 JSON → 浏览器运行时读取」；迁移目标是「PostgreSQL 查询 + R2 对象」，见 [astro-ssr-migration.md](../planning/astro-ssr-migration.md)。

## 文档索引

| 文档 | 说明 | 何时阅读 |
| --- | --- | --- |
| [data-model.md](./data-model.md) | manifest / datapack / insights / group-* 的字段、口径、版本演进 | 读写 JSON、排查数据问题 |
| [adding-data.md](./adding-data.md) | 加场次、加成员、加逐字稿、数据校验 | 数据有更新 |
| [data-progress.md](./data-progress.md) | 五位成员的抓取进度、跳过判定、下一批候选 | 继续补历史场次 |

相关文档：

- [engineering/deployment.md](../engineering/deployment.md)：R2 发布、缓存、定时任务
- [engineering/troubleshooting.md](../engineering/troubleshooting.md)：数据异常与口径排查
- [scripts/README.md](../../scripts/README.md)：抓取、封面、表情、逐字稿脚本
- [content/transcripts/README.md](../../content/transcripts/README.md)：逐字稿字段与命令

## 当前链路

```text
data/<id>/*.datapack.json          本地暂存（gitignore）
        │  bun run publish:data
        ▼
R2  index.json
    <id>/manifest.json
    <id>/insights.json
    <id>/<videoId>.datapack.json
    <id>/thumbs/<videoId>.jpg + 480/960/1280w webp
    <id>/transcripts/<videoId>.json
    group-summary.json / group-gallery.json
        │  页面运行时读取
        ▼
组首页 / 成员页 / 场次 / 单场 / 趋势 / 相册 / 对比
```

## 约定

1. **单一真源**：`data/<id>/*.datapack.json` 是唯一真源；manifest / insights / 组级文件全部由 `publish:data` 派生，不手改。
2. **git 不存数据**：只有 `data-sources.json`、`data/README.md` 和手写逐字稿进 git；`data/` 其余、`public/data/`、`dist/` 都不提交。
3. **时间一律 JST**：`startedAt` 取开播时刻，不是公开时刻。
4. **不换算汇率**：SC / 贴纸按币种分列。
5. **迁移期**：PostgreSQL 表结构与 ingest 流程写在 `planning/astro-ssr-migration.md`，不要写成当前实现。
6. **加数据后必跑**：`validate:data`；发布后 `validate:data --remote`。

## 常用命令

```bash
bun run add:datapack <id> <pack>   # 加一份 pack，更新本地 manifest
bun run publish:data               # 重建 manifest + insights 并上传 R2
bun run validate:data              # 校验引用链
bun run validate:data -- --remote  # 逐条 HEAD 远端对象
bun run fetch:thumbs --dataset <id>
bun run fetch:emoji --dataset <id>
bun run publish:transcripts
```

补历史、重抓、补弹幕等一次性脚本见 [scripts/README.md](../../scripts/README.md)。
