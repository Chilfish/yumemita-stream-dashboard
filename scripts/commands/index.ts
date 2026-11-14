import type { CliGroup, CommandSpec } from '../lib/cli/runtime.ts'
import { dataGroup } from './data/index.ts'
import { dbGroup } from './db/index.ts'
import { deploySpec } from './deploy.ts'
import { devGroup } from './dev/index.ts'
import { publishGroup } from './publish/index.ts'
import { testGroup } from './test/index.ts'
import { toolGroup } from './tool/index.ts'
import { transcriptGroup } from './transcript/index.ts'
import { validateGroup } from './validate/index.ts'

/** 带分组的命令。 */
export const groups: CliGroup[] = [
  dataGroup,
  dbGroup,
  publishGroup,
  transcriptGroup,
  validateGroup,
  testGroup,
  devGroup,
  toolGroup,
]

/** 不带分组的顶层命令。 */
export const rootCommands: CommandSpec[] = [deploySpec]
