const RELAY_URL = 'http://localhost:3100'

/**
 * Generate an embedding vector for the given text via the relay server.
 * Falls back to null if the relay is unavailable (offline mode).
 */
export async function generateEmbedding(text: string): Promise<Float32Array | null> {
  try {
    const resp = await fetch(`${RELAY_URL}/memory/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'attacca-relay-service'
      },
      body: JSON.stringify({ text })
    })

    if (!resp.ok) {
      console.warn(`[memory] Embedding request failed: ${resp.status}`)
      return null
    }

    const data = await resp.json() as { success: boolean; embedding?: number[]; error?: string }
    if (!data.success || !data.embedding) {
      console.warn('[memory] Embedding response missing data:', data.error)
      return null
    }

    return new Float32Array(data.embedding)
  } catch (err) {
    console.warn('[memory] Embedding unavailable (relay offline):', (err as Error).message)
    return null
  }
}

/** Convert Float32Array to Buffer for SQLite storage */
export function float32ToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)
}

/** Convert Buffer back to Float32Array */
export function bufferToFloat32(buf: Buffer): Float32Array {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Float32Array(ab)
}
