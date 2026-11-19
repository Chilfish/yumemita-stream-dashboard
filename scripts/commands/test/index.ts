import type { CommandGroup } from '@chilfish/devkit/cli'
import { testPerfSpec } from './perf.ts'
import { testSmokeSpec } from './smoke.ts'

/** `test` 分组：路由与页面性能冒烟。 */
export const testGroup: CommandGroup = {
  name: 'test',
  description: '冒烟：路由可达性、页面性能',
  commands: [testSmokeSpec, testPerfSpec],
}
