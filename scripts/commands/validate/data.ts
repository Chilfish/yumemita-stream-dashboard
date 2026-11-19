/**
 * 校验本地 datapack（唯一真源）：schema、文件名与 video.id 一致、可选 HEAD 远端 archive。
 *
 * 整站对账以 `db verify` 为准；这里只保证 pack 能被 ingest 正常消费。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { safeParse } from 'valibot'
import { Option } from 'commander'
import { type CommandSpec, CliError } from '@chilfish/devkit/cli'
import { DatapackSchema, formatIssues } from '../../lib/validate-schema.ts'

const APP_ROOT = resolve(import.meta.dir, '..', '..', '..')

interface DatasetConfig {
  datasets?: { id: string }[]
}

interface Target {
  datasetId: string
  videoId: string
}

function rel(path: string): string {
  return relative(APP_ROOT, path).split(sep).join('/')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 并发 HEAD 远端 archive 对象，返回不可达数量。 */
async function checkRemoteObjects(
  remoteBase: string,
  targets: Target[],
  errors: string[],
): Promise<number> {
  if (!remoteBase) {
    throw new CliError('--remote 需要设置 DATAPACK_BASE（对象存储公开根地址）', {
      code: 'MISSING_ENV',
      exitCode: 3,
      hint: '在 .dev.vars 里配置 DATAPACK_BASE；只查本地就去掉 --remote',
    })
  }

  const urls = targets.map(({ datasetId, videoId }) => `${remoteBase}/archive/${datasetId}/${videoId}.datapack.json`)
  const failures: string[] = []
  let cursor = 0

  const workers = Array.from({ length: Math.min(8, urls.length) }, async () => {
    for (;;) {
      const url = urls[cursor]
      cursor += 1
      if (!url) return
      try {
        const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15_000) })
        if (!response.ok) failures.push(`${url} -> HTTP ${response.status}`)
      }
      catch (error) {
        failures.push(`${url} -> ${errorMessage(error)}`)
      }
    }
  })
  await Promise.all(workers)

  if (failures.length > 0) {
    errors.push(`${failures.length}/${urls.length} 个 archive 对象不可达`)
    errors.push(...failures.slice(0, 20))
  }
  return urls.length
}

export const validateDataSpec: CommandSpec = {
  id: 'validate.data',
  description: '校验本地 datapack：schema、文件名与 video.id 一致',
  examples: [
    'bun run ymmt validate data',
    'bun run ymmt validate data --remote',
    'bun run ymmt validate data --json',
  ],
  options: [new Option('--remote', '额外 HEAD 对象存储上的 archive 对象')],
  async run(ctx) {
    const errors: string[] = []

    const readJson = (path: string): unknown | null => {
      try {
        return JSON.parse(readFileSync(path, 'utf8')) as unknown
      }
      catch (error) {
        errors.push(`${rel(path)}: ${errorMessage(error)}`)
        return null
      }
    }

    const config = readJson(join(APP_ROOT, 'data-sources.json')) as DatasetConfig | null
    if (!config || !Array.isArray(config.datasets) || config.datasets.length === 0) {
      throw new CliError('data-sources.json 里没有 datasets', {
        code: 'EMPTY_CONFIG',
        hint: '检查 data-sources.json 的 datasets 数组',
      })
    }

    const targets: Target[] = []
    for (const dataset of config.datasets) {
      const dir = join(APP_ROOT, 'data', dataset.id)
      if (!existsSync(dir)) {
        errors.push(`缺少 ${rel(dir)}`)
        continue
      }

      const files = readdirSync(dir).filter(name => name.endsWith('.datapack.json'))
      if (files.length === 0) {
        errors.push(`${dataset.id}: 目录里没有 datapack`)
        continue
      }

      for (const name of files) {
        const path = join(dir, name)
        const videoId = basename(name, '.datapack.json')
        const pack = readJson(path)
        if (pack === null) continue

        const result = safeParse(DatapackSchema, pack)
        if (!result.success) {
          errors.push(...formatIssues(result).map(issue => `${rel(path)}: ${issue}`))
          continue
        }
        if (result.output.video?.id !== videoId) {
          errors.push(`${rel(path)}: video.id (${result.output.video?.id ?? '缺失'}) 与文件名 ${videoId} 不一致`)
          continue
        }
        targets.push({ datasetId: dataset.id, videoId })
      }
    }

    const remoteCount = ctx.flag('remote')
      ? await checkRemoteObjects((process.env.DATAPACK_BASE ?? '').replace(/\/+$/, ''), targets, errors)
      : 0

    if (errors.length > 0) {
      for (const error of errors) ctx.log.error(error)
      return {
        exitCode: 1,
        data: { checked: targets.length, problems: errors.length, errors },
      }
    }

    const remoteNote = ctx.flag('remote') ? `，archive ${remoteCount} 个对象可达` : ''
    ctx.log.info(`OK：${targets.length} 场${remoteNote}`)
    return { data: { checked: targets.length, problems: 0, remoteObjects: remoteCount } }
  },
}
