import { handle } from '@astrojs/cloudflare/handler'

import { blockedBotResponse, isBlockedBot } from './lib/bot-filter'

export default {
  fetch(request: Request, env: unknown, ctx: unknown) {
    // 放在 Astro 之前：AI 抓取机器人不触发 SSR、不查库，也不占 CPU 配额。
    if (isBlockedBot(request.headers.get('user-agent'))) {
      return blockedBotResponse()
    }
    return handle(request, env as never, ctx as never)
  },
}
