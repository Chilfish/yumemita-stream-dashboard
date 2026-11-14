import type { CliGroup } from '../../lib/cli/runtime.ts'
import { transcriptImportSpec } from './import.ts'
import { transcriptNewSpec } from './new.ts'

/** `transcript` 分组：逐字稿新建与导入。 */
export const transcriptGroup: CliGroup = {
  name: 'transcript',
  description: '逐字稿：按模板新建、导入已写好的 Markdown',
  commands: [transcriptNewSpec, transcriptImportSpec],
}
