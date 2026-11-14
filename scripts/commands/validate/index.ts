import type { CliGroup } from '../../lib/cli/runtime.ts'
import { validateContentSpec } from './content.ts'
import { validateDataSpec } from './data.ts'

/** `validate` 分组：数据与内容校验。 */
export const validateGroup: CliGroup = {
  name: 'validate',
  description: '校验：datapack schema、v2 数据自洽',
  commands: [validateDataSpec, validateContentSpec],
}
