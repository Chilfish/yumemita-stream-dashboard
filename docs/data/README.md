# 数据文档（Data）

本目录记录数据模型、加数据流程与抓取进度。当前数据链路是「本地 pack → PostgreSQL 查询 + R2 对象」，见 [astro-ssr-migration.md](../archive/astro-ssr-migration.md)。

## 文档索引

| 文档 | 说明 | 何时阅读 |
| --- | --- | --- |
| [datapack.md](./datapack.md) | 一场直播的数据包结构、会话目录、字段与口径 | 读写 datapack、判断抓取口径 |
| [data-model.md](./data-model.md) | manifest / datapack / insights / group-* 的字段、口径、版本演进 | 读写 JSON、排查数据问题 |
| [chat-events.md](./chat-events.md) | 弹幕 / 事件的完整字段、事件类型、合并去重、表情索引与限制 | 读写 jsonl、做弹幕时间线、查事件口径 |
| [adding-data.md](./adding-data.md) | 加场次、加成员、加逐字稿、数据校验 | 数据有更新 |
| [data-progress.md](./data-progress.md) | 五位成员的抓取进度、跳过判定、下一批候选 | 继续补历史场次 |

相关文档：

- [engineering/cli.md](../engineering/cli.md)：脚本入口、命令树、`--json` 信封
- [engineering/deployment.md](../engineering/deployment.md)：R2 发布、缓存、数据更新工作流
- [engineering/troubleshooting.md](../engineering/troubleshooting.md)：数据异常与口径排查
- [scripts/README.md](../../scripts/README.md)：脚本目录结构与一次性补丁入口
- [content/transcripts/README.md](../../content/transcripts/README.md)：逐字稿字段与命令

## 当前链路

```text
data/<id>/*.datapack.json          本地暂存（gitignore）
        ├─ bun run ymmt db ingest
        │     ▼
        │   Neon PostgreSQL（streams / details / insights / transcripts）
        │
        └─ bun run ymmt publish data --assets-only + publish transcripts
              ▼
            R2  <id>/thumbs/<videoId>.jpg + 480/960/1280w webp
                emojis/<id>/*
                archive/<id>/<videoId>.datapack.json
                <id>/transcripts/<videoId>.json
        │
        ▼
请求期 SSR：组首页 / 成员页 / 场次 / 单场 / 趋势 / 相册 / 对比
```

## 约定

1. **单一真源**：`data/<id>/*.datapack.json` 是唯一真源；`streams` / `dataset_insights` 由 `db ingest` 派生，不手改。
2. **git 不存数据**：只有 `data-sources.json`、`data/README.md` 和手写逐字稿进 git；`data/` 其余、`dist/` 都不提交。
3. **时间一律 JST**：`startedAt` 取开播时刻，不是公开时刻。
4. **不换算汇率**：SC / 贴纸按币种分列。
5. **表结构**：以 `src/db/schema.ts` 与 `archive/astro-ssr-migration.md` 为准。
6. **加数据后必跑**：`db ingest` → `db verify`；发布资产后按 tag purge。

## 常用命令

完整命令树与选项见 [engineering/cli.md](../engineering/cli.md)。

```bash
bun run ymmt data datapack <会话目录>     # 合并一场素材，更新本地 manifest
bun run ymmt db ingest --dataset <id>     # 投影到 PostgreSQL
bun run ymmt db verify --dataset <id>     # 与 pack 字段级对账
bun run ymmt publish data --assets-only --dataset <id>  # 封面 / 表情 / archive → R2
bun run ymmt data thumbnails --dataset <id>
bun run ymmt data emoji --dataset <id>
bun run ymmt data live-chat --video <videoId>   # 开播前 / 直播中 / 已结束时抓回放
bun run ymmt data danmaku --dataset <id> --video <videoId>  # 单场补弹幕（回放）
bun run ymmt publish transcripts
bun run ymmt publish purge --dataset <id>  # 失效 Workers Cache
```

补历史、重抓、补弹幕等一次性脚本见 [scripts/README.md](../../scripts/README.md)。
