import type { CommandGroup } from '@chilfish/devkit/cli'
import { validateContentSpec } from './content.ts'
import { validateDataSpec } from './data.ts'

/** `validate` 分组：数据与内容校验。 */
export const validateGroup: CommandGroup = {
  name: 'validate',
  description: '校验：datapack schema、v2 数据自洽',
  commands: [validateDataSpec, validateContentSpec],
}
