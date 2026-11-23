import { defineDevkit } from '@chilfish/devkit'

export const devkit = defineDevkit({
  identity: {
    name: 'ymmt',
    description: '夢限大みゅーたいぷ 数据流水线',
    helpHint: 'bun run ymmt',
    jsonEnvVar: 'YMMT_JSON',
  },
  // 每个环境一个文件：`.dev.vars` 是 base，`LOCAL=1` 叠加 `.dev.vars.dev`，
  // `LOCAL=0` 叠加 `.dev.vars.prod`；线上值不再写成 `*_ONLINE`。
  env: { file: '.dev.vars', localFlag: 'LOCAL' },
  database: {
    localUrl: 'postgres://postgres@localhost:5432/ymmt_dev',
    proxyEndpoint: 'http://127.0.0.1:4444/sql',
    migrations: 'drizzle',
  },
  storage: {
    bucket: 'yumemita-data',
    dataDir: 'temp/silo-data',
    publicBaseEnv: 'PUBLIC_R2_BASE',
  },
  paths: { logs: 'temp' },
  dev: {
    servers: [{ name: 'astro', runtime: 'node', command: 'astro', args: ['dev'] }],
  },
})
