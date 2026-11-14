import { Command, CommanderError, Help, Option } from 'commander'
import { buildEnvelope, serializeEnvelope, type CommandResult, type EnvelopeError } from './envelope.ts'
import { CliError, EXIT_CODES, UsageError } from './exit.ts'
import { createLogger, type LogLevel, type Logger } from './logger.ts'
import { loadEnvFiles } from '../env.ts'
import { describeEnvironment, isLocalMode } from '../local-config.ts'

/** commander 的帮助标题与提示默认是英文；统一换成中文。 */
const HELP_TITLES: Record<string, string> = {
  'Usage:': '用法：',
  'Options:': '选项：',
  'Global Options:': '全局选项：',
  'Commands:': '命令：',
  'Arguments:': '参数：',
}

/** 帮助正文里需要中文化的小片段。 */
function localizeHelpText(text: string): string {
  return text
    .replace(/^(用法：|命令：|选项：|全局选项：|参数：) /gm, '$1')
    .replace(/display help for command/g, '显示某条命令的帮助')
    .replace(/\((choices|default): ([^()]*)\)/g, (_match, label: string, value: string) => (
      `（${label === 'choices' ? '可选' : '默认'}：${value}）`
    ))
}

class ChineseHelp extends Help {
  override styleTitle(text: string): string {
    return super.styleTitle(HELP_TITLES[text] ?? text)
  }

  override formatHelp(cmd: Command, helper: Help): string {
    return localizeHelpText(super.formatHelp(cmd, helper))
  }
}

/** 帮助与全局选项都要挂到每一层命令上：commander 不会自动继承。 */
function applySharedSettings(command: Command): void {
  // commander 的 configureHelp 只合并自有属性，类方法不会被复制，必须让每一层实例化自己的 Help。
  command.createHelp = (): Help => new ChineseHelp()
  command.helpOption('-h, --help', '显示帮助')
  addGlobalOptions(command)
  command.exitOverride()
  command.configureOutput({
    writeOut: text => process.stdout.write(text),
    writeErr: text => process.stderr.write(text),
  })
  // 内置 help 子命令是惰性创建的；在每次要呈现帮助前把它翻成中文。
  const originalHelp = command.helpInformation.bind(command)
  command.helpInformation = (context?: unknown): string => {
    for (const child of command.commands) {
      if (child.name() === 'help') child.description('显示某条命令的帮助')
    }
    return originalHelp(context as Parameters<typeof originalHelp>[0])
  }
}


/** 一条命令的静态描述，runtime 用它生成 commander 子命令与 describe 输出。 */
export interface CommandSpec<T = unknown> {
  /** 稳定 id，形如 `db.ingest`，写进信封与日志前缀。 */
  id: string
  /** 一行说明，中文，动词开头。 */
  description: string
  /** 更长的说明，`--help` 的正文。 */
  details?: string
  /** 用法示例，`--help` 的 Examples 段。 */
  examples?: string[]
  /** 额外选项；全局选项（--json / --quiet / --log-level / --log-file / --dry-run）由 runtime 注入。 */
  options?: Option[]
  /** 位置参数，如 `transcript new <videoId>`。 */
  arguments?: { name: string, description: string, required?: boolean }[]
  /** 业务实现。dry-run 时 runtime 传入 ctx.dryRun，命令自己保证只读。 */
  run: (ctx: CommandContext) => Promise<CommandResult<T> | void>
}

export interface CommandContext {
  /** 解析后的业务选项（不含全局选项）。 */
  options: Record<string, unknown>
  /** 位置参数，按 spec.arguments 顺序。 */
  args: string[]
  /** 日志器，前缀为命令 id。 */
  log: Logger
  /** 是否 dry-run；命令内不得写库 / 写对象存储 / 写本地文件。 */
  dryRun: boolean
  /** 是否 JSON 输出模式；为真时不要往 stdout 写任何别的东西。 */
  json: boolean
  /** 读取一个必填字符串选项，缺失或空时抛 UsageError。 */
  requireString(name: string): string
  /** 读取一个整数选项并校验下界。 */
  integer(name: string, fallback: number, min?: number): number
  /** 读取一个布尔选项。 */
  flag(name: string): boolean
}

type RuntimeFlag = 'json' | 'quiet' | 'dryRun' | 'logLevel' | 'logFile'

const GLOBAL_OPTION_KEYS = new Set<RuntimeFlag>(['json', 'quiet', 'dryRun', 'logLevel', 'logFile'])

interface GlobalValues {
  json: boolean
  quiet: boolean
  dryRun: boolean
  logLevel: LogLevel
  logFile?: string
}

function readGlobal(command: Command): GlobalValues {
  const options = command.optsWithGlobals() as Record<string, unknown>
  const level = options.logLevel
  if (level !== undefined && level !== 'debug' && level !== 'info' && level !== 'warn' && level !== 'error') {
    throw new UsageError(`--log-level 只能是 debug / info / warn / error，收到 ${String(level)}`, {
      context: { option: 'logLevel', value: level },
    })
  }
  return {
    json: options.json === true || process.env.YMMT_JSON === '1',
    quiet: options.quiet === true,
    dryRun: options.dryRun === true,
    logLevel: (level ?? 'info') as LogLevel,
    logFile: typeof options.logFile === 'string' ? options.logFile : undefined,
  }
}

function addGlobalOptions(command: Command): Command {
  return command
    .addOption(new Option('--json', '输出单行 JSON 信封（{ok,command,data,error,meta}）到 stdout'))
    .addOption(new Option('--quiet', '只保留警告与错误'))
    .addOption(new Option('--dry-run', '只读：不写库、不写对象存储、不改本地文件'))
    .addOption(
      new Option('--log-level <level>', '日志等级：debug / info / warn / error，默认 info'),
    )
    .addOption(new Option('--log-file <path>', '把日志以 NDJSON 追加写入文件'))
}

/** 去掉全局选项后的剩余选项，作为命令自己的 options 交给 run。 */
function commandOptions(command: Command): Record<string, unknown> {
  const raw = command.opts() as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (GLOBAL_OPTION_KEYS.has(key as RuntimeFlag)) continue
    result[key] = value
  }
  return result
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)
}

function createContext(spec: CommandSpec, command: Command, globals: GlobalValues): CommandContext {
  const options = commandOptions(command)
  const log = createLogger({
    name: spec.id,
    level: globals.logLevel,
    quiet: globals.quiet,
    file: globals.logFile,
    silentOutput: globals.json,
  })

  return {
    options,
    args: command.args.slice(),
    log,
    dryRun: globals.dryRun,
    json: globals.json,
    requireString(name) {
      const value = options[name]
      if (typeof value !== 'string' || value.length === 0) {
        throw new UsageError(`缺少 --${kebab(name)}`, {
          hint: `看 bun run ymmt ${spec.id.replaceAll('.', ' ')} --help`,
          context: { option: name },
        })
      }
      return value
    },
    integer(name, fallback, min = 0) {
      const raw = options[name]
      if (raw === undefined) return fallback
      const value = Number(raw)
      if (!Number.isInteger(value) || value < min) {
        throw new UsageError(`--${kebab(name)} 需要是 >= ${min} 的整数`, {
          context: { option: name, value: raw },
        })
      }
      return value
    },
    flag(name) {
      return options[name] === true
    },
  }
}

function toEnvelopeError(error: unknown): { payload: EnvelopeError, exitCode: number } {
  if (error instanceof CliError) {
    return {
      payload: {
        code: error.code,
        message: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
        ...(error.context ? { context: error.context } : {}),
      },
      exitCode: error.exitCode,
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { payload: { code: 'FAILED', message }, exitCode: EXIT_CODES.failure }
}

function buildMeta(globals: GlobalValues, startTime: number): {
  mode: 'local' | 'remote'
  durationMs: number
  dryRun: boolean
  version: string
} {
  return {
    mode: isLocalMode(process.env) ? 'local' : 'remote',
    durationMs: Date.now() - startTime,
    dryRun: globals.dryRun,
    version: VERSION,
  }
}

/** 给一条命令挂上统一的执行包装：环境横幅、信封、退出码。 */
function attachRunner(command: Command, spec: CommandSpec, startTime: number): Command {
  command.action(async (...actionArgs: unknown[]) => {
    // commander 把声明的位置参数、options、该 Command 依次传入；最后一个总是该 Command。
    const self = actionArgs[actionArgs.length - 1] as Command
    let globals: GlobalValues
    let ctx: CommandContext
    try {
      globals = readGlobal(self)
      ctx = createContext(spec, self, globals)
    }
    catch (error) {
      // 连上下文都建不出来时，直接按用法错误退出（此时还谈不上日志格式）。
      const { payload, exitCode } = toEnvelopeError(error)
      process.stderr.write(`${payload.message}\n`)
      if (payload.hint) process.stderr.write(`下一步：${payload.hint}\n`)
      process.exitCode = exitCode
      return
    }

    loadEnvFiles({ log: false })
    if (!globals.json) ctx.log.info(describeEnvironment(process.env))

    try {
      const result = (await spec.run(ctx)) ?? {}
      const ok = (result.exitCode ?? EXIT_CODES.ok) === 0
      if (globals.json) {
        process.stdout.write(`${serializeEnvelope(buildEnvelope({
          command: spec.id,
          ok,
          data: result.data,
          meta: buildMeta(globals, startTime),
        }))}\n`)
      }
      else if (result.summary) {
        ctx.log.line(result.summary)
      }
      process.exitCode = result.exitCode ?? EXIT_CODES.ok
    }
    catch (error) {
      const { payload, exitCode } = toEnvelopeError(error)
      if (globals.json) {
        process.stdout.write(`${serializeEnvelope(buildEnvelope({
          command: spec.id,
          ok: false,
          error: payload,
          meta: buildMeta(globals, startTime),
        }))}\n`)
      }
      else {
        ctx.log.error(payload.message)
        if (payload.hint) ctx.log.line(`下一步：${payload.hint}`)
        if (globals.logLevel === 'debug' && error instanceof Error && error.stack) {
          ctx.log.debug(error.stack)
        }
      }
      process.exitCode = exitCode
    }
  })
  return command
}

let VERSION = '0.1.0'

export function setVersion(version: string): void {
  VERSION = version
}

/** 把 spec 建成 commander 子命令并挂到 parent 上。 */
export function registerCommand(parent: Command, spec: CommandSpec): Command {
  const startTime = Date.now()
  const name = spec.id.split('.').at(-1) ?? spec.id
  const command = parent.command(name).description(spec.description)
  applySharedSettings(command)
  const helpExtras: string[] = []
  if (spec.details) helpExtras.push(spec.details)
  if (spec.examples && spec.examples.length > 0) {
    helpExtras.push(`示例：\n${spec.examples.map(line => `  ${line}`).join('\n')}`)
  }
  if (helpExtras.length > 0) command.addHelpText('after', `\n${helpExtras.join('\n\n')}`)
  for (const option of spec.options ?? []) command.addOption(option)
  for (const argument of spec.arguments ?? []) {
    if (argument.required === false) command.argument(`[${argument.name}]`, argument.description)
    else command.argument(`<${argument.name}>`, argument.description)
  }
  return attachRunner(command, spec, startTime)
}

export interface CliGroup {
  /** 一级分组名，如 `data`。 */
  name: string
  description: string
  commands: CommandSpec[]
}

export interface DescribeCommand {
  id: string
  description: string
  details?: string
  examples?: string[]
  options: { flags: string, description: string, default?: unknown, choices?: string[] }[]
  arguments: { name: string, description: string, required: boolean }[]
}

/** 命令树的结构化描述，`describe` 子命令与文档生成共用。 */
export function describeCli(groups: CliGroup[], version: string): {
  name: string
  version: string
  exitCodes: { code: number, meaning: string }[]
  globalOptions: { flags: string, description: string }[]
  groups: { name: string, description: string, commands: DescribeCommand[] }[]
} {
  return {
    name: 'ymmt',
    version,
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
    groups: groups.map(group => ({
      name: group.name,
      description: group.description,
      commands: group.commands.map(spec => ({
        id: spec.id,
        description: spec.description,
        ...(spec.details ? { details: spec.details } : {}),
        ...(spec.examples ? { examples: spec.examples } : {}),
        options: (spec.options ?? []).map(option => ({
          flags: option.flags,
          description: option.description,
          ...(option.defaultValue !== undefined ? { default: option.defaultValue } : {}),
          ...(option.argChoices ? { choices: option.argChoices } : {}),
        })),
        arguments: (spec.arguments ?? []).map(argument => ({
          name: argument.name,
          description: argument.description,
          required: argument.required !== false,
        })),
      })),
    })),
  }
}

/** 构建整个 CLI 树。 */
export function buildCli(groups: CliGroup[], version: string): Command {
  setVersion(version)
  const program = new Command()
  program
    .name('ymmt')
    .description('夢限大みゅーたいぷ 数据流水线')
    .version(version, '-V, --version', '显示版本')
    .showHelpAfterError('（加 --help 看完整用法）')
  applySharedSettings(program)
  program.enablePositionalOptions()

  const describeCommand = program
    .command('describe')
    .description('输出完整命令树（JSON），供 agent 自举，不用读源码')
  applySharedSettings(describeCommand)
  describeCommand.action(() => {
    process.stdout.write(`${JSON.stringify(describeCli(groups, version), null, 2)}\n`)
  })

  for (const group of groups) {
    const groupCommand = program.command(group.name).description(group.description)
    applySharedSettings(groupCommand)
    for (const spec of group.commands) registerCommand(groupCommand, spec)
  }

  return program
}

/**
 * 执行 CLI 并统一处理 commander 自身的错误（--help / --version / 参数错误）。
 *
 * commander 默认会 `process.exit`，这里改成：
 * - --help / --version：正常退出 0；
 * - 未知命令 / 未知选项 / 缺参数：退出 2，并把提示写到 stderr。
 */
export async function runCli(program: Command, argv: string[]): Promise<void> {
  // 内置 help 子命令是惰性创建的，解析前才有；统一翻成中文说明。
  program.commands.forEach((command) => {
    if (command.name() === 'help') command.description('显示某条命令的帮助')
  })
  try {
    await program.parseAsync(argv, { from: 'user' })
  }
  catch (error) {
    if (error instanceof CommanderError) {
      const helpCodes = new Set(['commander.helpDisplayed', 'commander.help', 'commander.version'])
      if (helpCodes.has(error.code)) {
        process.exitCode = EXIT_CODES.ok
        return
      }
      // 参数/命令错误：commander 已经把提示写到 stderr。
      process.exitCode = EXIT_CODES.usage
      return
    }
    throw error
  }
}
