#!/usr/bin/env bun
/**
 * 数据流水线的唯一 CLI 入口。
 *
 *   bun scripts/cli.ts --help
 *   bun scripts/cli.ts describe --json
 *   bun scripts/cli.ts db latest
 *   bun run ymmt db ingest --dataset nonoka
 *
 * 命令实现在 scripts/commands/，参数解析 / 帮助 / 日志 / 退出码 / JSON 信封由
 * scripts/lib/cli/runtime.ts 统一处理。命令清单与选项见 docs/engineering/cli.md。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCli, runCli, type CliGroup } from './lib/cli/runtime.ts'
import { dbLatestSpec } from './commands/db/latest.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const packageJson = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version: string }

const groups: CliGroup[] = [
  {
    name: 'db',
    description: '数据库：ingest、对账、迁移、压测',
    commands: [dbLatestSpec],
  },
]

await runCli(buildCli(groups, packageJson.version), process.argv.slice(2))
