import process from 'node:process'
import { defineConfig } from 'drizzle-kit'
import { loadEnvFile } from '@chilfish/devkit/env'
import { devkit } from './scripts/dev.config.ts'

// drizzle-kit 不读环境文件；与脚本共用同一个加载器（默认 .dev.vars）。
loadEnvFile({ config: devkit })

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
})
