import { DATABASE_URL } from 'astro:env/server'
import { createDb } from './connection'

export const db = createDb(DATABASE_URL ?? '')
