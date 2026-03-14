import { Router, type Request, type Response } from 'express'

const router = Router()

const SERVICE_TOKEN = process.env.RELAY_SERVICE_TOKEN || 'attacca-relay-service'

// Simple service-token auth (same pattern as agent routes)
function authCheck(req: Request, res: Response): boolean {
  const token = req.headers['x-api-key']
  if (token !== SERVICE_TOKEN) {
    res.status(401).json({ success: false, error: 'Unauthorized' })
    return false
  }
  return true
}

/**
 * POST /memory/embed
 * Generates an embedding vector for the given text.
 * Uses OpenAI text-embedding-3-small (cheapest, 1536 dims).
 * Falls back to a simple hash-based mock if no API key is available.
 */
router.post('/embed', async (req: Request, res: Response) => {
  if (!authCheck(req, res)) return

  const { text } = req.body as { text?: string }
  if (!text || typeof text !== 'string') {
    res.status(400).json({ success: false, error: 'Missing text parameter' })
    return
  }

  // Truncate to ~8000 tokens (~32000 chars) to stay within embedding model limits
  const truncated = text.slice(0, 32000)

  // Try OpenAI embeddings first
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: 'text-embedding-3-small',
          input: truncated
        })
      })

      if (!response.ok) {
        const errBody = await response.text()
        console.error('[memory] OpenAI embedding error:', errBody)
        res.status(502).json({ success: false, error: 'Embedding API error' })
        return
      }

      const data = await response.json() as {
        data: Array<{ embedding: number[] }>
      }

      res.json({ success: true, embedding: data.data[0].embedding, dimensions: data.data[0].embedding.length })
      return
    } catch (err) {
      console.error('[memory] OpenAI embedding request failed:', err)
    }
  }

  // Try Anthropic's Voyage embeddings via their partner API
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (anthropicKey) {
    try {
      const response = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anthropicKey}`
        },
        body: JSON.stringify({
          model: 'voyage-3-lite',
          input: [truncated]
        })
      })

      if (response.ok) {
        const data = await response.json() as {
          data: Array<{ embedding: number[] }>
        }
        res.json({ success: true, embedding: data.data[0].embedding, dimensions: data.data[0].embedding.length })
        return
      }
    } catch {
      // Fall through to error
    }
  }

  res.status(503).json({ success: false, error: 'No embedding API key configured (set OPENAI_API_KEY)' })
})

export default router
