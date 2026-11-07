import process from 'node:process'
import { defineConfig } from 'drizzle-kit'
import { loadEnvFiles } from './scripts/lib/env.ts'

// drizzle-kit 不读环境文件；与脚本共用同一个加载器（默认 .dev.vars）。
loadEnvFiles()

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
})
