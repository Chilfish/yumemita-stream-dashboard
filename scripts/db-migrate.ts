import { isLocalDatabaseUrl } from '../src/db/connection.ts'
import { loadEnvFiles, requireEnv } from './lib/env.ts'

loadEnvFiles()

const url = requireEnv('DATABASE_URL')

if (isLocalDatabaseUrl(url)) {
  const { drizzle } = await import('drizzle-orm/node-postgres')
  const { migrate } = await import('drizzle-orm/node-postgres/migrator')
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: url })

  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: 'drizzle' })
    console.log('migration complete（local postgres）')
  }
  finally {
    await pool.end()
  }
}
else {
  const { Pool } = await import('@neondatabase/serverless')
  const { drizzle } = await import('drizzle-orm/neon-serverless')
  const { migrate } = await import('drizzle-orm/neon-serverless/migrator')
  const pool = new Pool({ connectionString: url })
  const db = drizzle({ client: pool })

  try {
    await migrate(db, { migrationsFolder: 'drizzle' })
    console.log('migration complete')
  }
  finally {
    await pool.end()
  }
}
