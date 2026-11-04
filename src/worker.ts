import { handle } from '@astrojs/cloudflare/handler'

export default {
  fetch(request: Request, env: unknown, ctx: unknown) {
    return handle(request, env as never, ctx as never)
  },
}
