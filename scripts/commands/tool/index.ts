import type { CliGroup } from '../../lib/cli/runtime.ts'
import { toolCookiesSpec } from './cookies.ts'
import { toolMihomoSpec } from './mihomo.ts'

/** `tool` 分组：外部工具与凭据。 */
export const toolGroup: CliGroup = {
  name: 'tool',
  description: '外部工具：YouTube cookie 导出、mihomo 配置',
  commands: [toolCookiesSpec, toolMihomoSpec],
}
