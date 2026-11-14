import type { CliGroup } from '../../lib/cli/runtime.ts'
import { devDbSpec } from './db.ts'
import { devProxySpec } from './proxy.ts'
import { devServerSpec } from './server.ts'
import { devStorageSpec } from './storage.ts'

/** `dev` 分组：本地开发环境。 */
export const devGroup: CliGroup = {
  name: 'dev',
  description: '本地开发：Astro、Postgres、Neon HTTP 代理、SILO 对象存储',
  commands: [devServerSpec, devDbSpec, devProxySpec, devStorageSpec],
}
