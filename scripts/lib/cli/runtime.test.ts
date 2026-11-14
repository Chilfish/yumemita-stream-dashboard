import { describe, expect, it } from 'vitest'
import { Option } from 'commander'
import { CliError, ConfigError, EXIT_CODES, UsageError, requireEnvVar } from './exit.ts'
import { buildEnvelope, serializeEnvelope } from './envelope.ts'
import { createLogger } from './logger.ts'
import { buildCli, describeCli, type CliGroup } from './runtime.ts'

describe('exit codes', () => {
  it('CliError 默认走运行期失败', () => {
    const error = new CliError('坏了')
    expect(error.exitCode).toBe(EXIT_CODES.failure)
    expect(error.code).toBe('FAILED')
  })

  it('UsageError 映射到退出码 2', () => {
    expect(new UsageError('缺参数').exitCode).toBe(EXIT_CODES.usage)
  })

  it('ConfigError 映射到退出码 3', () => {
    expect(new ConfigError('缺变量').exitCode).toBe(EXIT_CODES.config)
  })

  it('requireEnvVar 缺失时抛 ConfigError 并带 hint', () => {
    const saved = process.env.YMMT_TEST_MISSING
    delete process.env.YMMT_TEST_MISSING
    try {
      expect(() => requireEnvVar('YMMT_TEST_MISSING', '把这个配上')).toThrowError(/缺少环境变量/)
      try {
        requireEnvVar('YMMT_TEST_MISSING', '把这个配上')
      }
      catch (error) {
        expect(error).toBeInstanceOf(ConfigError)
        expect((error as ConfigError).hint).toBe('把这个配上')
        expect((error as ConfigError).exitCode).toBe(EXIT_CODES.config)
      }
    }
    finally {
      if (saved !== undefined) process.env.YMMT_TEST_MISSING = saved
    }
  })
})

describe('envelope', () => {
  const meta = { mode: 'local' as const, durationMs: 12, dryRun: false, version: '0.1.0' }

  it('成功时 data 有值、error 为 null', () => {
    const envelope = buildEnvelope({ command: 'db.ingest', ok: true, data: { processed: 3 }, meta })
    expect(envelope.ok).toBe(true)
    expect(envelope.data).toEqual({ processed: 3 })
    expect(envelope.error).toBeNull()
  })

  it('失败时 data 为 null、error 带 code 与 hint', () => {
    const envelope = buildEnvelope({
      command: 'db.ingest',
      ok: false,
      error: { code: 'MISSING_ENV', message: '缺少 DATABASE_URL', hint: 'bun run dev:db' },
      meta,
    })
    expect(envelope.data).toBeNull()
    expect(envelope.error?.code).toBe('MISSING_ENV')
    expect(envelope.error?.hint).toBe('bun run dev:db')
  })

  it('序列化成单行 JSON', () => {
    const line = serializeEnvelope(buildEnvelope({ command: 'db.latest', ok: true, data: { videoId: 'abc' }, meta }))
    expect(line.includes('\n')).toBe(false)
    expect(JSON.parse(line).data.videoId).toBe('abc')
  })
})

describe('logger', () => {
  function collect(): { lines: string[], write: (stream: 'out' | 'err', line: string) => void } {
    const lines: string[] = []
    return {
      lines,
      write: (stream, line) => lines.push(`${stream}:${line}`),
    }
  }

  it('日志走 stderr，output 走 stdout', () => {
    const sink = collect()
    const log = createLogger({ name: 'db.ingest', write: sink.write })
    log.info('开始')
    log.output('Dg2JRU4ANks')
    expect(sink.lines).toEqual(['err:[db.ingest] 开始', 'out:Dg2JRU4ANks'])
  })

  it('silentOutput 丢弃 output，避免 --json 时污染 stdout', () => {
    const sink = collect()
    const log = createLogger({ name: 'db.latest', silentOutput: true, write: sink.write })
    log.output('abc')
    expect(sink.lines).toEqual([])
  })

  it('--quiet 只保留 warn 与 error', () => {
    const sink = collect()
    const log = createLogger({ name: 'db.ingest', quiet: true, write: sink.write })
    log.info('信息')
    log.warn('警告')
    log.error('错误')
    expect(sink.lines).toHaveLength(2)
    expect(sink.lines[0]).toContain('警告')
  })

  it('level=warn 抑制 info 但保留 warn', () => {
    const sink = collect()
    const log = createLogger({ name: 'db.ingest', level: 'warn', write: sink.write })
    log.info('信息')
    log.warn('警告')
    expect(sink.lines).toEqual(['err:[db.ingest] WARN 警告'])
  })
})

describe('describe', () => {
  const groups: CliGroup[] = [
    {
      name: 'db',
      description: '数据库',
      commands: [
        {
          id: 'db.ingest',
          description: '写入数据库',
          options: [new Option('--dataset <id>', '只处理一个 dataset')],
          async run() {},
        },
      ],
    },
  ]

  it('输出命令树、全局选项与退出码', () => {
    const tree = describeCli(groups, '0.1.0')
    expect(tree.exitCodes.map(item => item.code)).toEqual([0, 1, 2, 3])
    expect(tree.globalOptions.some(option => option.flags === '--json')).toBe(true)
    expect(tree.groups[0]?.commands[0]?.id).toBe('db.ingest')
    expect(tree.groups[0]?.commands[0]?.options[0]?.flags).toBe('--dataset <id>')
  })

  it('每层命令都挂了 --json 与 --help', () => {
    const program = buildCli(groups, '0.1.0')
    const db = program.commands.find(command => command.name() === 'db')
    const ingest = db?.commands.find(command => command.name() === 'ingest')
    const longsOf = (command: typeof program): (string | undefined)[] => (
      command.createHelp().visibleOptions(command).map(option => option.long)
    )
    expect(longsOf(program)).toContain('--json')
    expect(db && longsOf(db)).toContain('--json')
    expect(ingest && longsOf(ingest)).toContain('--json')
    expect(ingest && longsOf(ingest)).toContain('--help')
  })
})
