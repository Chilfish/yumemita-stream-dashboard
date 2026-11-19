import { defineDevkit } from '@chilfish/devkit'

export const devkit = defineDevkit({
  identity: {
    name: 'ymmt',
    description: '夢限大みゅーたいぷ 数据流水线',
    helpHint: 'bun run ymmt',
    jsonEnvVar: 'YMMT_JSON',
  },
  env: { file: '.dev.vars', localFlag: 'LOCAL', onlineSuffix: '_ONLINE' },
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
