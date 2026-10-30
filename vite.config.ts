import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { DEFAULT_SITE_URL } from './src/lib/site-defaults.ts'

/** 把子路径 base、站点地址与数据源 preconnect 注入 index.html（静态生成脚本复用同一份 HTML）。 */
function seoHeadPlugin(base: string, siteUrl: string, dataBase: string): Plugin {
  let dataOrigin = ''
  try {
    dataOrigin = dataBase ? new URL(dataBase).origin : ''
  } catch {
    dataOrigin = ''
  }

  const siteBase = base.replace(/\/+$/, '')
  const absoluteBase = `${siteUrl.replace(/\/+$/, '')}${siteBase}`

  return {
    name: 'seo-head',
    transformIndexHtml(html) {
      let output = html.replaceAll('__SITE_BASE__', siteBase).replaceAll('__SITE_URL__', absoluteBase)

      if (dataOrigin) {
        output = output.replace(
          '</head>',
          `    <link rel="preconnect" href="${dataOrigin}" crossorigin />\n    <link rel="dns-prefetch" href="${dataOrigin}" />\n  </head>`,
        )
      }

      return output
    },
  }
}

/**
 * 把逐路由的静态 head 生成挂到 build 的末尾。这样即使托管平台只跑 `vite build`，
 * 也不会漏掉 generate-seo（线上曾经因此退回未生成的空模板）。
 * 生成器是独立脚本，不随 Vite config 一起打包，避免 `import.meta.url` 被改写成临时文件。
 */
function seoGeneratePlugin(): Plugin {
  return {
    name: 'seo-generate',
    apply: 'build',
    closeBundle() {
      const script = resolve(process.cwd(), 'scripts/generate-seo.ts')
      const bun = (process.versions as Record<string, string | undefined>).bun
        ? process.execPath
        : 'bun'
      execFileSync(bun, [script], { cwd: process.cwd(), stdio: 'inherit' })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Defaults to '/' for local dev / root hosting. Set VITE_BASE to '/<path>/'
  // when the site is served from a subpath.
  const base = env.VITE_BASE ?? process.env.VITE_BASE ?? '/'
  const siteUrl = (env.VITE_SITE_URL ?? process.env.VITE_SITE_URL ?? DEFAULT_SITE_URL).replace(
    /\/+$/,
    '',
  )

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      seoHeadPlugin(base, siteUrl, env.VITE_DATAPACK_BASE ?? ''),
      seoGeneratePlugin(),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})
