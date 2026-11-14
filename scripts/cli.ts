#!/usr/bin/env bun
/**
 * 数据流水线的唯一 CLI 入口。
 *
 *   bun scripts/cli.ts --help
 *   bun scripts/cli.ts describe --json
 *   bun run ymmt db ingest --dataset nonoka
 *
 * 命令实现在 scripts/commands/（按域分目录，各自的 index.ts 汇总成 CliGroup），
 * 参数解析 / 帮助 / 日志 / 退出码 / JSON 信封由 scripts/lib/cli/runtime.ts 统一处理。
 * 命令清单与选项见 docs/engineering/cli.md。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCli, runCli } from '@scripts/lib/cli/runtime.ts'
import { groups, rootCommands } from './commands/index.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version: string }

await runCli(buildCli(groups, packageJson.version, rootCommands), process.argv.slice(2))
