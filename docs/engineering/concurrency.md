# 批处理并发

> 最后更新：2026-11-23
>
> 所有分批任务（抓取、发布、校验）的并发都走同一个入口，不要在命令里再手写 worker 循环。

## 入口

`scripts/lib/pool.ts` 有两层：

| 导出 | 用途 |
| --- | --- |
| `runPool(items, concurrency, task, options)` | 项目里的默认用法：有界并发跑一批任务，单项失败只记录 |
| `runPoolPipeline` | 需要 stage 名 / 事件 / 快照等 pipeline 细节时直接调 |

两者都建立在 `@chilfish/devkit/pipeline` 的 `runPipeline` 之上，因此共享同一套状态机与语义：

- **有界并发**：`concurrency` 是同时在飞的上限，不是分片大小。
- **单项失败不中断批次**：失败项记入 `result.failures`，其余项继续跑完；
  返回 `{ total, succeeded, failed, failures }`。
- **重试与超时**：`retries` 是首次失败后的额外尝试次数，`timeoutMs` 按单次尝试计时；
  超时会 abort `ctx.signal`，长时间 I/O 的任务应在合适的检查点检查它。
- **key**：默认用数组下标。pipeline 默认 `JSON.stringify(item)`，但上传项常带
  `Uint8Array`，既慢又可能重键；需要稳定标识时传 `key`（如 `videoId`）。
- **onFailure**：每项失败时回调，用来沿用现有的逐条 `log.warn`。

## 用法

```ts
import { runPool } from '@scripts/lib/pool.ts'

const result = await runPool(pending, concurrency, async (id) => {
  await downloadOne(id)
}, {
  name: 'thumbnails',
  key: id => id,
  onFailure: failure => log.warn(`${failure.key} 失败：${failure.error}`),
})

log.info(`成功 ${result.succeeded} / 失败 ${result.failed}`)
```

需要把失败原因写进自己的统计时，在 `task` 里 `try/catch` 并计数，或者读 `result.failures`；
两种都行，但不要同时抛错又在外面计数两次。

## 不该做的

- 不要在命令里再写 `cursor` + `Array.from({ length })` 的 worker 循环。
- 不要用 `Promise.all(items.map(task))` 跑大批量：没有并发上限。
- 不要为了「快」把 `concurrency` 调到抓取源的限流阈值之上；YouTube 与 VSTATS 会直接 429。
- 下载类任务的请求间隔（如 `vstats` 的 300ms）放在 `task` 里，不靠降低并发来模拟。

## 现有调用点

| 位置 | 并发 | 说明 |
| --- | --- | --- |
| `publish/data.ts` | 4 / 8 / 2 | 封面变体、datapack、索引分批上传 |
| `publish/transcripts.ts` | 4 | 逐字稿正文上传 |
| `data/emoji.ts`、`data/thumbnails.ts` | 4 | 镜像图片 |
| `data/fetch.ts` | `--meta-concurrency` / `--concurrency` | 元信息与媒体 |
| `data/update.ts` | `--dataset-concurrency` | 成员之间并发；每个成员分到的并发 = `--concurrency / --dataset-concurrency` |
| `data/vstats.ts` | `--concurrency` | 单场页请求，任务内 sleep 300ms |
| `data/danmaku.ts` | `--concurrency` | 回放采集 |
| `validate/data.ts` | 8 | `--remote` 的 HEAD 探测 |
| `lib/restore-datapacks.ts` | 8 | 从对象存储恢复本地 pack |
| `oneoff/backfill-owner-chats.ts`、`oneoff/backfill-author-id.ts` | 参数 | 一次性回填 |

## `data update` 的两阶段编排

成员之间并发，但不是整条链路并发：

1. **抓取阶段（并发）**：频道差集 → `fetch` → VSTATS → 封面。各成员互不依赖。
   - 每个成员按 `--concurrency / --dataset-concurrency` 均摊并发，总请求量不随成员数放大。
   - 状态文件按 dataset 分名（`fetch-<id>.log` / `fetch-<id>-progress.json` /
     `channel-ids-<id>.txt`），不会互相覆盖。
   - cookie 只导出一次，整轮复用（`cookieMaxAgeMs`）。
2. **写库与发布（串行）**：ingest → publish → 逐字稿 → purge。这几步共享
   `data/.publish-state*.json` 与远端桶列举，并发会互相踩；桶只列一次，各成员复用
   `remoteSizes`。

阶段之间用 `MemberWork` 交接：第一阶段只决定「这一位要动哪些 id」，第二阶段按顺序执行。

## 重复抓取的三个来源

`data update` 的可重入性取决于三件事，改动时别破坏：

- **差集基线是数据库**：`planDataset` 的 `knownIds` 来自 `DATABASE_URL` 指向的库。本地跑完
  只写了本地库，线上库没有这些行，第二次（尤其是 CI）仍会判成新场次。本地 → 线上走
  `publish sync`，不要重跑 `data update`。
- **素材判定看 `--root`**：`fetch` 用 `<root>/<日期>_<label>_<videoId>/` 下的
  `meta/info.json`、`danmaku_*.jsonl`、`comments_*.json` 决定跳过。换机器 / 换 root 就没有
  这些文件，整套重下。
- **哨兵有 TTL**：`vstats-unavailable.txt` / `chat-unavailable.txt` 30 天过期
  （`SENTINEL_TTL_DAYS`）。VSTATS 补抓会读写同一份哨兵，已判「未收录」的场次不再占用每轮配额；
  日常「缺弹幕」重抓走 `noReset`，不会清掉评论 / VSTATS / 哨兵，只有显式 `--force` 才清空重下。

## 验证

```bash
bun run test -- tests/scripts/lib/pool.test.ts   # 并发上限、失败聚合、重试、key
```

`tests/scripts/lib/pool.test.ts` 覆盖并发上限、单项失败、默认下标 key、自定义 key 与重试；
改动 `pool.ts` 时先让这组测试通过。
