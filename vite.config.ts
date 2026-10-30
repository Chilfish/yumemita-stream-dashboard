import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/** 把子路径 base 与数据源 preconnect 注入 index.html（静态生成脚本复用同一份 HTML）。 */
function seoHeadPlugin(base: string, dataBase: string): Plugin {
  let dataOrigin = ''
  try {
    dataOrigin = dataBase ? new URL(dataBase).origin : ''
  } catch {
    dataOrigin = ''
  }

  const siteBase = base.replace(/\/+$/, '')

  return {
    name: 'seo-head',
    transformIndexHtml(html) {
      let output = html.replaceAll('__SITE_BASE__', siteBase)

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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Defaults to '/' for local dev / root hosting. Set VITE_BASE to '/<path>/'
  // when the site is served from a subpath.
  const base = env.VITE_BASE ?? process.env.VITE_BASE ?? '/'

  return {
    base,
    plugins: [
      react(),
      tailwindcss(),
      seoHeadPlugin(base, env.VITE_DATAPACK_BASE ?? ''),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }
})
