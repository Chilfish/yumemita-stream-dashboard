import { DATABASE_URL, NEON_HTTP_ENDPOINT } from 'astro:env/server'
import { createDb } from './connection'

export const db = createDb(DATABASE_URL ?? '', NEON_HTTP_ENDPOINT || undefined)
