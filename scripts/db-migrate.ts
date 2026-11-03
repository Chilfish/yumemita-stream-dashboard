import { Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { migrate } from 'drizzle-orm/neon-serverless/migrator'
import { loadEnvFiles, requireEnv } from './lib/env.ts'

loadEnvFiles()

const pool = new Pool({ connectionString: requireEnv('DATABASE_URL') })
const db = drizzle({ client: pool })

try {
  await migrate(db, { migrationsFolder: 'drizzle' })
  console.log('migration complete')
}
finally {
  await pool.end()
}
