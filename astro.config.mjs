// @ts-check

import { fileURLToPath } from 'node:url'
import cloudflare from '@astrojs/cloudflare'
import { cacheCloudflare } from '@astrojs/cloudflare/cache'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, envField } from 'astro/config'
import { DEFAULT_SITE_URL } from './src/lib/site-defaults.ts'

// https://astro.build/config
export default defineConfig({
  site: process.env.SITE_URL || DEFAULT_SITE_URL,
  output: 'server',
  session: false,
  adapter: cloudflare({
    // 构建期若读取本地 / R2 资产，需要 Node 环境的 process.env 与文件系统
    prerenderEnvironment: 'node',
  }),
  cache: {
    provider: cacheCloudflare(),
  },
  routeRules: {
    '/': { maxAge: 60, swr: 300, tags: ['group'] },
    '/gallery': { maxAge: 300, swr: 600, tags: ['group', 'gallery'] },
    '/[datasetId]': { maxAge: 60, swr: 300, tags: ['datasets'] },
    '/[datasetId]/streams': { maxAge: 60, swr: 300, tags: ['datasets'] },
    '/[datasetId]/trends': { maxAge: 300, swr: 600, tags: ['datasets'] },
    '/[datasetId]/gallery': { maxAge: 300, swr: 600, tags: ['datasets'] },
    '/[datasetId]/transcripts': { maxAge: 300, swr: 600, tags: ['transcripts'] },
    '/[datasetId]/stream/[videoId]': { maxAge: 300, swr: 600, tags: ['streams'] },
    '/[datasetId]/stream/[videoId].md': { maxAge: 300, swr: 600, tags: ['streams'] },
    '/sitemap.xml': { maxAge: 300, swr: 600, tags: ['sitemap'] },
    '/llms.txt': { maxAge: 300, swr: 600, tags: ['llms'] },
  },
  build: {
    // 字体与 Tailwind 的 CSS 体积较大；外链后由浏览器跨路由复用并长期缓存。
    inlineStylesheets: 'never',
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
  env: {
    schema: {
      DATABASE_URL: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      R2_ACCOUNT_ID: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      R2_ACCESS_KEY_ID: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      R2_SECRET_ACCESS_KEY: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      R2_BUCKET: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      R2_PREFIX: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      PURGE_TOKEN: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      PUBLIC_R2_BASE: envField.string({
        context: 'client',
        access: 'public',
        optional: true,
      }),
    },
  },
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  },
})
