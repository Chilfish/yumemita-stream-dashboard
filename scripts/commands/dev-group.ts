import { createDevCommands } from '@chilfish/devkit/commands'
import { devkit } from '../dev.config.ts'

/**
 * `dev` 分组由 devkit 生成，这里只保留 ymmt 既有的中文帮助文案与 `--local` 开关，
 * 使 `describe --json` 与改造前一致。
 */
export const devGroup = createDevCommands(devkit, {
  serverLocalFlag: true,
  strings: {
    groupDescription: '本地开发：Astro、Postgres、Neon HTTP 代理、SILO 对象存储',
    commands: {
      server: {
        description: '启动开发服务器：先拉起 Postgres / 库 / 迁移 / 代理，再跑 Astro dev',
        details: [
          '等同于原来的 `bun run dev`。Postgres 与开发代理是独立后台进程：Astro 退出后继续运行，重复执行只会复用它们。',
          '',
          '透传 Astro 参数：commander 需要认识所有选项，而 Astro 的 `--port` / `--host` 之类它不认识，',
          '所以用 `--` 分隔——`--` 之后的参数会进 `ctx.args` 并原样交给 `astro dev`；',
          '没有 `--` 时退回读 `process.argv` 里 `server` / `dev` 之后的尾巴（剔掉 ymmt 自己的 `--local` / `--json` / `--quiet` / `--dry-run` / `--log-level` / `--log-file`）。',
          '',
          '  bun run ymmt dev server -- --port 4322 --host 0.0.0.0',
          '  bun run ymmt dev server --local -- --port 4322',
          '',
          '`--local` 等价于 `LOCAL=1`：数据库、对象存储与媒体地址一起切到本机。',
          '全局 `--dry-run` 只做本地服务就绪检查，不启动 Astro。',
        ].join('\n'),
        examples: [
          'bun run dev',
          'bun run ymmt dev server',
          'bun run ymmt dev server --local',
          'bun run ymmt dev server -- --port 4322',
        ],
        optionDescriptions: {
          local: '等价于 LOCAL=1：数据库、对象存储与媒体地址都切到本机',
        },
      },
      db: {
        description: '本地库初始化：启动 Postgres、建库、跑迁移、对齐 .dev.vars',
        details: '不启动 Astro。默认地址 `postgres://postgres@localhost:5432/ymmt_dev`。\n'
          + '全局 `--dry-run` 只报告将要执行的步骤，不启服务、不写库、不改 `.dev.vars`。',
        examples: [
          'bun run ymmt dev db',
          'bun run ymmt dev db --url postgres://postgres@localhost:5432/ymmt_dev',
        ],
        optionDescriptions: {
          url: '目标数据库地址，默认本机 ymmt_dev',
        },
      },
      proxy: {
        description: '前台启动 Neon HTTP 兼容代理，把 /sql 转发到本机 Postgres',
        details: 'workerd 不能直连 TCP，astro dev / preview 需要它。只接受本机 `DATABASE_URL`，\n'
          + '避免误把线上库暴露到 localhost。服务在前台运行，Ctrl-C 结束。\n'
          + '`bun run ymmt dev` 会按需自动拉起同一个代理，平时不需要单独跑。',
        examples: [
          'bun run ymmt dev proxy',
          'bun run ymmt dev proxy --port 4444',
        ],
        optionDescriptions: {
          port: '监听端口，默认 DEV_DB_PROXY_PORT 或 4444',
        },
      },
      storage: {
        description: '启动本地对象存储（SILO）并准备桶，不启动 Astro',
        details: '只接受 `LOCAL=1`（可写在 `.dev.vars`）：对象存储端点必须是本机地址。\n'
          + '`bun run ymmt dev` 在本地模式下会自动走同一条路径；单独跑 publish / fetch 之前也可以先用它确认端点、桶与匿名读就绪。',
        examples: [
          'bun run ymmt dev storage',
          'LOCAL=1 bun run ymmt dev storage --json',
        ],
      },
    },
  },
})

// devkit 的命令 spec 用通用名 `args...`；保留 ymmt 原有的 `astroArgs...` 占位名。
const serverCommand = devGroup.commands.find(command => command.id === 'dev.server')
if (serverCommand) {
  serverCommand.arguments = [{
    name: 'astroArgs...',
    description: '`--` 之后原样透传给 astro dev 的参数',
    required: false,
  }]
}
