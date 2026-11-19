import type { CommandGroup } from '@chilfish/devkit/cli'
import { dbBenchSpec } from './bench.ts'
import { dbIngestSpec } from './ingest.ts'
import { dbLatestSpec } from './latest.ts'
import { dbMigrateSpec } from './migrate.ts'
import { dbQuerySpec } from './query.ts'
import { dbSchedulesSpec } from './schedules.ts'
import { dbTotalsSpec } from './totals.ts'
import { dbVerifySpec } from './verify.ts'

/** `db` 分组：入库、对账、迁移、查询冒烟与压测。 */
export const dbGroup: CommandGroup = {
  name: 'db',
  description: '数据库：ingest、对账、迁移、查询冒烟与压测',
  commands: [
    dbIngestSpec,
    dbVerifySpec,
    dbMigrateSpec,
    dbQuerySpec,
    dbBenchSpec,
    dbLatestSpec,
    dbTotalsSpec,
    dbSchedulesSpec,
  ],
}
