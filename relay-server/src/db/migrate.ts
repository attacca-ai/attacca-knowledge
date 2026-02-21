import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { getPool, closePool } from './client.js'

dotenv.config()

const __dirname = dirname(fileURLToPath(import.meta.url))

async function migrate(): Promise<void> {
  console.log('[migrate] Running schema migration...')

  const schemaPath = join(__dirname, 'schema.sql')
  const sql = readFileSync(schemaPath, 'utf-8')

  const pool = getPool()

  try {
    await pool.query(sql)
    console.log('[migrate] Schema migration complete')
  } catch (err) {
    console.error('[migrate] Migration failed:', err)
    process.exit(1)
  } finally {
    await closePool()
  }
}

migrate()
