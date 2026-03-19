import { getMemoryDb } from './db'
import { generateEmbedding, float32ToBuffer, EMBEDDING_DIMS } from './embeddings'

/**
 * Regenerates all embeddings using the local model (384 dims).
 * Called once on first launch after upgrade from 1536-dim OpenAI embeddings.
 * Runs in background — does not block app startup.
 */
export async function migrateEmbeddings(): Promise<{ migrated: number; failed: number }> {
  const db = getMemoryDb()
  const rows = db
    .prepare('SELECT id, content, summary, embedding FROM memories WHERE superseded_by IS NULL')
    .all() as Array<{ id: string; content: string; summary: string; embedding: Buffer | null }>

  let migrated = 0
  let failed = 0

  for (const row of rows) {
    // Check if embedding exists and is already the correct dimension
    if (row.embedding) {
      const dims = row.embedding.byteLength / 4 // Float32 = 4 bytes
      if (dims === EMBEDDING_DIMS) continue // already correct
    }

    const text = `${row.summary}\n${row.content}`
    const emb = await generateEmbedding(text)
    if (emb) {
      db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(float32ToBuffer(emb), row.id)
      migrated++
    } else {
      failed++
    }
  }

  return { migrated, failed }
}

/**
 * Generates embeddings for memories that were saved without them (offline captures).
 * Called periodically by the background scheduler.
 */
export async function backfillEmbeddings(): Promise<{ filled: number; failed: number }> {
  const db = getMemoryDb()
  const rows = db
    .prepare('SELECT id, content, summary FROM memories WHERE embedding IS NULL AND superseded_by IS NULL')
    .all() as Array<{ id: string; content: string; summary: string }>

  if (rows.length === 0) return { filled: 0, failed: 0 }

  let filled = 0
  let failed = 0

  for (const row of rows) {
    const text = `${row.summary}\n${row.content}`
    const emb = await generateEmbedding(text)
    if (emb) {
      db.prepare('UPDATE memories SET embedding = ? WHERE id = ?').run(float32ToBuffer(emb), row.id)
      filled++
    } else {
      failed++
    }
  }

  console.log(`[memory] Backfill: ${filled} filled, ${failed} failed`)
  return { filled, failed }
}
