// @ts-check

import { fileURLToPath } from 'node:url'
import cloudflare from '@astrojs/cloudflare'
import { cacheCloudflare } from '@astrojs/cloudflare/cache'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, envField } from 'astro/config'
import { loadEnv } from 'vite'
import { DEFAULT_SITE_URL } from './src/lib/site-defaults.ts'
import { loadPreviewData, loadEmojiIndex } from './scripts/lib/live-chat-preview-data.ts'

// Bun / CI 未必把 .env 注入 process.env；显式读一次，避免 SITE_URL 静默回退。
const mode = process.env.NODE_ENV === 'development' ? 'development' : 'production'
const fileEnv = loadEnv(mode, process.cwd(), '')
const siteUrl = (process.env.SITE_URL || fileEnv.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, '')
if (!process.env.PUBLIC_R2_BASE && !fileEnv.PUBLIC_R2_BASE) {
  console.warn('[astro.config] PUBLIC_R2_BASE 未设置：构建产物会回退到 /data/，线上封面 / 表情会 404')
}

// 开发预览：workerd 里没有真实文件系统，改由 Vite 的 Node 中间件读 temp/youtube-live。
const liveChatRoot = fileURLToPath(new URL('./temp/youtube-live', import.meta.url))
const liveChatEmojiBase = (process.env.PUBLIC_R2_BASE || fileEnv.PUBLIC_R2_BASE || 'https://ymmt-s3.chilfish.top').replace(/\/+$/, '')

function liveChatPreviewPlugin() {
  return {
    name: 'live-chat-preview',
    apply: 'serve',
    /** @param {import('vite').ViteDevServer} server */
    configureServer(server) {
      server.middlewares.use('/dev/live-chat-emoji-index', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const dataset = url.searchParams.get('dataset') ?? ''
        try {
          const names = await loadEmojiIndex(liveChatRoot, dataset, liveChatEmojiBase)
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify({ names }))
        }
        catch {
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ names: {} }))
        }
      })
      server.middlewares.use('/dev/live-chat-data', async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        try {
          const data = await loadPreviewData(liveChatRoot, url.searchParams.get('session'))
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.setHeader('cache-control', 'no-store')
          res.end(JSON.stringify(data))
        }
        catch (error) {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({
            root: liveChatRoot,
            sessions: [],
            session: null,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
      })
    },
  }
}

// https://astro.build/config
export default defineConfig({
  site: siteUrl,
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
    // 数据只在 ingest 时变，ingest 成功后会按 tag purge；TTL 只做兜底。
    // 日历依赖请求时刻的直播状态，保持短 TTL。
    '/': { maxAge: 3600, swr: 86400, tags: ['group'] },
    '/gallery': { maxAge: 3600, swr: 86400, tags: ['group', 'gallery'] },
    '/calendar': { maxAge: 60, swr: 300, tags: ['group', 'schedule'] },
    '/[datasetId]': { maxAge: 3600, swr: 86400, tags: ['datasets'] },
    '/[datasetId]/calendar': { maxAge: 60, swr: 300, tags: ['datasets', 'schedule'] },
    '/[datasetId]/streams': { maxAge: 3600, swr: 86400, tags: ['datasets'] },
    '/[datasetId]/trends': { maxAge: 3600, swr: 86400, tags: ['datasets'] },
    '/[datasetId]/gallery': { maxAge: 3600, swr: 86400, tags: ['datasets'] },
    '/about': { maxAge: 3600, swr: 86400, tags: ['group'] },
    '/[datasetId]/transcripts': { maxAge: 3600, swr: 86400, tags: ['transcripts'] },
    '/[datasetId]/stream/[videoId]': { maxAge: 3600, swr: 86400, tags: ['streams'] },
    '/[datasetId]/stream/[videoId].md': { maxAge: 3600, swr: 86400, tags: ['streams'] },
    '/sitemap.xml': { maxAge: 3600, swr: 86400, tags: ['sitemap'] },
    '/llms.txt': { maxAge: 3600, swr: 86400, tags: ['llms'] },
  },
  build: {
    // 字体与 Tailwind 的 CSS 体积较大；外链后由浏览器跨路由复用并长期缓存。
    inlineStylesheets: 'never',
  },
  prefetch: {
    // 只预取显式标记的导航链接；prefetchAll 会让侧栏每次悬停都触发一轮 SSR。
    prefetchAll: false,
    defaultStrategy: 'hover',
  },
  env: {
    schema: {
      DATABASE_URL: envField.string({
        context: 'server',
        access: 'secret',
        optional: true,
      }),
      /** 本地开发：指向 `bun run dev:db:proxy` 的 Neon HTTP 兼容端点。 */
      NEON_HTTP_ENDPOINT: envField.string({
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
      MEMBER_ONLY_KEY: envField.string({
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
    plugins: [tailwindcss(), liveChatPreviewPlugin()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  },
})
