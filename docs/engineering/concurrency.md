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
| `data/vstats.ts` | `--concurrency` | 单场页请求，任务内 sleep 300ms |
| `data/danmaku.ts` | `--concurrency` | 回放采集 |
| `validate/data.ts` | 8 | `--remote` 的 HEAD 探测 |
| `lib/restore-datapacks.ts` | 8 | 从对象存储恢复本地 pack |
| `oneoff/backfill-owner-chats.ts`、`oneoff/backfill-author-id.ts` | 参数 | 一次性回填 |

## 验证

```bash
bun run test -- tests/scripts/lib/pool.test.ts   # 并发上限、失败聚合、重试、key
```

`tests/scripts/lib/pool.test.ts` 覆盖并发上限、单项失败、默认下标 key、自定义 key 与重试；
改动 `pool.ts` 时先让这组测试通过。
