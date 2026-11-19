import type { CommandGroup } from '@chilfish/devkit/cli'
import { publishDataSpec } from './data.ts'
import { publishPurgeSpec } from './purge.ts'
import { publishSyncSpec } from './sync.ts'
import { publishTranscriptsSpec } from './transcripts.ts'

/** `publish` 分组：数据 / 逐字稿发布、远端同步与缓存失效。 */
export const publishGroup: CommandGroup = {
  name: 'publish',
  description: '发布：对象存储资产、逐字稿、远端同步、缓存失效',
  commands: [publishDataSpec, publishTranscriptsSpec, publishSyncSpec, publishPurgeSpec],
}
