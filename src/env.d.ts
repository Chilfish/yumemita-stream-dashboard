/// <reference types="astro/client" />

declare module 'cloudflare:workers' {
  /** Cloudflare Worker 绑定；只有运行在 workerd 时才能读取。 */
  export const env: Record<string, unknown>
}

declare namespace App {
  interface Locals {
    requestId: string
    startedAt: number
  }
}
