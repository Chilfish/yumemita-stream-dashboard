#!/usr/bin/env bun
/**
 * 数据流水线的唯一 CLI 入口。
 *
 *   bun scripts/cli.ts --help
 *   bun scripts/cli.ts describe --json
 *   bun run ymmt db ingest --dataset nonoka
 *
 * 命令实现在 scripts/commands/（按域分目录，各自的 index.ts 汇总成 CommandGroup），
 * 参数解析 / 帮助 / 日志 / 退出码 / JSON 信封由 @chilfish/devkit/cli 统一处理。
 * 命令清单与选项见 docs/engineering/cli.md。
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCli, runCli } from '@chilfish/devkit/cli'
import { groups, rootCommands } from './commands/index.ts'
import { devkit } from './dev.config.ts'

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version: string }

/** 保持改造前的 describe 契约：退出码与全局选项仍用中文。 */
const labels = {
  exitCodes: [
    { code: 0, meaning: '成功 / 已收敛' },
    { code: 1, meaning: '运行期失败（部分批次失败也算）' },
    { code: 2, meaning: '用法错误：未知参数、缺必填、非法取值' },
    { code: 3, meaning: '配置缺失：DATABASE_URL / R2_* / SITE_URL 未配置' },
  ],
  globalOptions: [
    { flags: '--json', description: '输出单行 JSON 信封到 stdout' },
    { flags: '--quiet', description: '只保留警告与错误' },
    { flags: '--dry-run', description: '只读：不写库、不写对象存储、不改本地文件' },
    { flags: '--log-level <level>', description: 'debug / info / warn / error，默认 info' },
    { flags: '--log-file <path>', description: '把日志以 NDJSON 追加写入文件' },
    { flags: '-h, --help', description: '显示帮助' },
    { flags: '-V, --version', description: '显示版本' },
  ],
}

await runCli(
  buildCli({ config: devkit, version: packageJson.version, groups, rootCommands, labels }),
  process.argv.slice(2),
)
