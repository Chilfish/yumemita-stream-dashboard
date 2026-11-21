import type { CommandGroup } from '@chilfish/devkit/cli'
import { dataDanmakuSpec } from './danmaku.ts'
import { dataDatapackSpec } from './datapack.ts'
import { dataEmojiSpec } from './emoji.ts'
import { dataFetchSpec } from './fetch.ts'
import { dataLiveChatSpec } from './live-chat.ts'
import { dataOfficialSpec } from './official.ts'
import { dataRefetchSpec } from './refetch.ts'
import { dataThumbnailsSpec } from './thumbnails.ts'
import { dataUpdateSpec } from './update.ts'
import { dataVstatsSpec } from './vstats.ts'

/** `data` 分组：抓取、补数据、生成 datapack。 */
export const dataGroup: CommandGroup = {
  name: 'data',
  description: '抓取与补数据：每日增量、频道补齐、弹幕 / 封面 / 表情 / VSTATS',
  commands: [
    dataUpdateSpec,
    dataFetchSpec,
    dataRefetchSpec,
    dataOfficialSpec,
    dataVstatsSpec,
    dataThumbnailsSpec,
    dataEmojiSpec,
    dataDanmakuSpec,
    dataLiveChatSpec,
    dataDatapackSpec,
  ],
}
