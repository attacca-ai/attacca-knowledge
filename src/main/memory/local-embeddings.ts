import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { EMBEDDING_MODEL_ID } from '../lib/constants'

let embedder: any = null
let loadingPromise: Promise<any> | null = null

/**
 * Resolve the writable model cache directory.
 * Always uses {userData}/attacca-models/ because the install directory
 * (C:\Program Files\...) is read-only on Windows.
 */
function getWritableCacheDir(): string {
  return join(app.getPath('userData'), 'attacca-models')
}

/**
 * Check if bundled model weights exist in app resources (read-only).
 */
function getBundledModelDir(): string | null {
  const resourcePath = join(process.resourcesPath || '', 'models')
  if (existsSync(join(resourcePath, 'onnx'))) return resourcePath
  return null
}

/**
 * Lazy-load the embedding model. First call takes ~1-2s (ONNX init).
 * Subsequent calls return the cached pipeline instantly.
 */
async function getEmbedder(): Promise<any> {
  if (embedder) return embedder
  if (loadingPromise) return loadingPromise

  loadingPromise = (async () => {
    const { pipeline } = await import('@huggingface/transformers')
    const bundledDir = getBundledModelDir()
    const writableDir = getWritableCacheDir()

    const pipe = await pipeline('feature-extraction', EMBEDDING_MODEL_ID, {
      // Use bundled weights if available (read-only), otherwise download to writable dir
      ...(bundledDir
        ? { local_files_only: true, cache_dir: bundledDir }
        : { cache_dir: writableDir }),
      dtype: 'fp32'
    })
    return pipe
  })()

  embedder = await loadingPromise
  loadingPromise = null
  return embedder
}

/**
 * Generate a 384-dim embedding for the given text using the local model.
 * Returns null only if the model fails to load.
 */
export async function generateLocalEmbedding(text: string): Promise<Float32Array | null> {
  try {
    const pipe = await getEmbedder()
    // Truncate to ~256 tokens (~2048 chars) — model max is 512 tokens
    const truncated = text.slice(0, 2048)
    const output = await pipe(truncated, { pooling: 'mean', normalize: true })
    return new Float32Array(output.data)
  } catch (err) {
    console.warn('[memory] Local embedding failed:', (err as Error).message)
    return null
  }
}
