#!/usr/bin/env bun
/**
 * 把本地已经有的单场 pack 推到线上（Neon + R2），不重抓素材。
 *
 *   bun run ymmt publish push Jih2ArVViRo
 *   bun run ymmt publish push "https://www.youtube.com/watch?v=Jih2ArVViRo" --dry-run
 *   bun run ymmt publish push Jih2ArVViRo --dataset other
 *
 * 用途：`data official --no-online`、`data refetch --no-online` 或手工放进 `data/`
 * 之后补推线上。与 `publish sync` 的区别是不按日期窗口筛候选，只处理指定的这一场；
 * 与 `data refetch` 的区别是不重抓素材，pack 是什么就推什么。
 *
 * 顺序：线上 ingest → 刷新公开汇总 → 定向 verify → publish data → purge。
 * 线上目标只认 `.dev.vars.prod`，执行期间强制 `LOCAL=0`。
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Option } from 'commander'
import { and, eq } from 'drizzle-orm'
import { createDb } from '@/db/connection.ts'
import { streams } from '@/db/schema.ts'
import { type CommandSpec, CliError, UsageError, type Logger } from '@chilfish/devkit/cli'
import { devkit } from '../../dev.config.ts'
import { findDatasetByLocalPack, packPath, readDatasets } from '@scripts/lib/dataset-locate.ts'
import { applyOnlineEnv, readOnlineTarget } from '@scripts/lib/online-env.ts'
import { parseVideoRef } from '@scripts/lib/video-ref.ts'
import { runIngest } from '../db/ingest.ts'
import { runRefreshTotals } from '../db/totals.ts'
import { runVerify } from '../db/verify.ts'
import { runPublishData } from './data.ts'
import { runPurge } from './purge.ts'

const APP_ROOT = resolve(import.meta.dir, '../../..')

export interface PushOptions {
  ref: string
  /** 跳过本地 pack 反查，直接指定 dataset。 */
  dataset?: string
  /** 默认 true；线上写入后做一次定向对账。 */
  verify?: boolean
  dryRun?: boolean
  log: Logger
}

export interface PushResult {
  videoId: string
  dataset: string
  pack: string
  /** dry-run 时线上是否已有这一场；真实执行时为 null。 */
  remoteExisted: boolean | null
  dryRun: boolean
  steps: string[]
  verifyProblems: number
}

function assertStep(result: { exitCode: number }, label: string, hint: string): void {
  if (result.exitCode === 0)
    return
  throw new CliError(`${label} 失败（exit ${result.exitCode}）`, { hint })
}

/** 线上是否已有这场；dry-run 用来说明是新增还是覆盖。 */
async function remoteHasStream(
  databaseUrl: string,
  datasetId: string,
  videoId: string,
): Promise<boolean> {
  const db = createDb(databaseUrl)
  const rows = await db
    .select({ videoId: streams.videoId })
    .from(streams)
    .where(and(eq(streams.datasetId, datasetId), eq(streams.videoId, videoId)))
  return rows.length > 0
}

export async function runPush(options: PushOptions): Promise<{ exitCode: number, data?: PushResult }> {
  const { log } = options
  const videoId = parseVideoRef(options.ref)
  const datasets = readDatasets(APP_ROOT)
  if (datasets.length === 0)
    throw new CliError('data-sources.json 里没有 datasets', { hint: '先配置成员与官方账号' })

  let dataset
  if (options.dataset) {
    dataset = datasets.find(item => item.id === options.dataset)
    if (!dataset) {
      throw new UsageError(`data-sources.json 里没有 dataset：${options.dataset}`, {
        hint: `可用：${datasets.map(item => item.id).join(', ')}`,
      })
    }
  }
  else {
    dataset = findDatasetByLocalPack(datasets, APP_ROOT, videoId)
    if (!dataset) {
      throw new CliError(`本地没有 ${videoId} 的 datapack`, {
        hint: '先抓取（data official / data fetch / data refetch），或用 --dataset 指定归属',
        context: { videoId },
      })
    }
  }

  const pack = packPath(APP_ROOT, dataset, videoId)
  if (!existsSync(pack)) {
    throw new CliError(`${dataset.id} 下没有 ${videoId} 的 datapack`, {
      hint: `确认 data/${dataset.id}/${videoId}.datapack.json 存在；缺素材用 data refetch`,
      context: { dataset: dataset.id, videoId, pack },
    })
  }

  const target = readOnlineTarget({ config: devkit, cwd: APP_ROOT })
  const host = new URL(target.databaseUrl).host
  const idsDir = join(APP_ROOT, 'temp', 'push')
  const idsFile = join(idsDir, `${videoId}.txt`)
  const steps = ['online-ingest', 'refresh', ...(options.verify === false ? [] : ['verify']), 'publish', 'purge']
  const remoteExisted = await remoteHasStream(target.databaseUrl, dataset.id, videoId)

  log.info(`线上目标：${host} · r2://${target.bucket}`)
  log.info(
    `${dataset.label}（${dataset.id}）/ ${videoId}：`
    + `${remoteExisted ? '线上已有，按内容 hash 覆盖' : '线上没有，将新增'}`,
  )
  log.info(`步骤：${steps.join(' → ')}`)

  if (options.dryRun) {
    log.info('dry-run：未执行任何写入')
    return {
      exitCode: 0,
      data: { videoId, dataset: dataset.id, pack, remoteExisted, dryRun: true, steps, verifyProblems: 0 },
    }
  }

  mkdirSync(idsDir, { recursive: true })
  writeFileSync(idsFile, `${videoId}\n`, 'utf8')

  let verifyProblems = 0
  const restoreEnv = applyOnlineEnv({ config: devkit, target })
  try {
    assertStep(
      await runIngest(['--dataset', dataset.id, '--ids', idsFile]),
      '线上 ingest',
      `LOCAL=0 bun run ymmt db ingest --dataset ${dataset.id} --ids ${idsFile} --log-level debug`,
    )

    assertStep(
      await runRefreshTotals({ dataset: dataset.id, log: log.child('refresh-public-totals') }),
      '刷新公开汇总',
      `LOCAL=0 bun run ymmt db totals --dataset ${dataset.id} --log-level debug`,
    )

    if (options.verify !== false) {
      const verified = await runVerify({ dataset: dataset.id, idsFile, log })
      verifyProblems = verified.data.problems
      if (verifyProblems > 0)
        log.warn(`定向对账有 ${verifyProblems} 个问题；线上已写入，明细见上面的 db.verify 日志`)
      else
        log.info(`定向对账通过：${verified.data.checked} 场`)
    }

    assertStep(
      await runPublishData({ dataset: dataset.id, ids: idsFile, log }),
      '发布索引与 archive',
      `LOCAL=0 bun run ymmt publish data --dataset ${dataset.id} --ids ${idsFile} --log-level debug`,
    )

    assertStep(
      await runPurge({ dataset: [dataset.id], video: [videoId], log }),
      '缓存失效',
      `LOCAL=0 bun run ymmt publish purge --dataset ${dataset.id} --video ${videoId} --log-level debug`,
    )
  }
  finally {
    restoreEnv()
  }

  log.line(`已推送：${dataset.label} / ${videoId}`)
  return {
    exitCode: verifyProblems > 0 ? 1 : 0,
    data: { videoId, dataset: dataset.id, pack, remoteExisted, dryRun: false, steps, verifyProblems },
  }
}

/** `publish push`：把本地已有场次推到线上，不重抓素材。 */
export const publishPushSpec: CommandSpec<PushResult> = {
  id: 'publish.push',
  description: '推送单场到线上：本地 pack 已在，只做入库 → 汇总 → 对账 → 发布 → 失效缓存',
  details: '按本地 pack 反查 dataset（或用 --dataset 指定），只处理这一场，不重抓素材。\n'
    + '线上目标只认 .dev.vars.prod；执行期间强制 LOCAL=0。\n'
    + '适合 data official --no-online / data refetch --no-online 之后补推；需要重抓素材时改用 data refetch。',
  examples: [
    'bun run ymmt publish push Jih2ArVViRo',
    'bun run ymmt publish push "https://www.youtube.com/watch?v=Jih2ArVViRo"',
    'bun run ymmt publish push Jih2ArVViRo --dry-run',
    'bun run ymmt publish push Jih2ArVViRo --dataset other --no-verify',
  ],
  arguments: [
    { name: 'video', description: 'YouTube 链接或 11 位视频 ID', required: true },
  ],
  options: [
    new Option('--dataset <id>', '跳过本地 pack 推断，直接指定 dataset'),
    new Option('--no-verify', '跳过线上写入后的定向对账'),
  ],
  async run(ctx) {
    const result = await runPush({
      ref: ctx.args[0] ?? '',
      dataset: typeof ctx.options.dataset === 'string' ? ctx.options.dataset : undefined,
      verify: ctx.options.verify !== false,
      dryRun: ctx.dryRun,
      log: ctx.log,
    })
    return {
      exitCode: result.exitCode,
      data: result.data,
      summary: result.data?.dryRun
        ? 'dry-run：未执行任何写入'
        : result.data?.verifyProblems
          ? `已推送，但对账有 ${result.data.verifyProblems} 个问题`
          : '已推送到线上',
    }
  },
}
