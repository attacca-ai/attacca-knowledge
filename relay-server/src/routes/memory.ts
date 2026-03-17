import { Router, type Request, type Response } from 'express'

const router = Router()

const SERVICE_TOKEN = process.env.RELAY_SERVICE_TOKEN || 'attacca-relay-service'

// Service-token auth — accepts both x-api-key header and Authorization: Bearer token
// (OpenClaw sends Bearer; our desktop app sends x-api-key)
function authCheck(req: Request, res: Response): boolean {
  const xApiKey = req.headers['x-api-key']
  const authHeader = req.headers['authorization']
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  const token = xApiKey || bearerToken
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

/**
 * POST /memory/v1/embeddings
 * OpenAI-compatible embeddings endpoint for OpenClaw's native memory search.
 * Proxies to OpenAI (or Voyage fallback) and returns standard OpenAI format.
 */
router.post('/embeddings', async (req: Request, res: Response) => {
  if (!authCheck(req, res)) return

  const { input, model } = req.body as { input?: string | string[]; model?: string }
  if (!input) {
    res.status(400).json({ error: { message: 'Missing input parameter', type: 'invalid_request_error' } })
    return
  }

  // Normalize input to array
  const inputs = Array.isArray(input) ? input : [input]
  const resolvedModel = model || 'text-embedding-3-small'

  const openaiKey = process.env.OPENAI_API_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY

  if (!openaiKey && !anthropicKey) {
    res.status(503).json({ error: { message: 'No embedding API key configured', type: 'server_error' } })
    return
  }

  try {
    const data: Array<{ object: string; embedding: number[]; index: number }> = []

    for (let i = 0; i < inputs.length; i++) {
      const text = inputs[i].slice(0, 32000)
      let embedding: number[] | null = null

      if (openaiKey) {
        const response = await fetch('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
          body: JSON.stringify({ model: resolvedModel, input: text })
        })
        if (response.ok) {
          const result = await response.json() as { data: Array<{ embedding: number[] }> }
          embedding = result.data[0].embedding
        }
      }

      if (!embedding && anthropicKey) {
        const response = await fetch('https://api.voyageai.com/v1/embeddings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anthropicKey}` },
          body: JSON.stringify({ model: 'voyage-3-lite', input: [text] })
        })
        if (response.ok) {
          const result = await response.json() as { data: Array<{ embedding: number[] }> }
          embedding = result.data[0].embedding
        }
      }

      if (!embedding) {
        res.status(502).json({ error: { message: 'Embedding API error', type: 'server_error' } })
        return
      }

      data.push({ object: 'embedding', embedding, index: i })
    }

    console.log(`[memory] OpenAI-compat embeddings — ${inputs.length} input(s), model=${resolvedModel}`)

    res.json({
      object: 'list',
      data,
      model: resolvedModel,
      usage: { prompt_tokens: 0, total_tokens: 0 }
    })
  } catch (err) {
    console.error('[memory] OpenAI-compat embedding error:', err)
    res.status(500).json({ error: { message: (err as Error).message, type: 'server_error' } })
  }
})

export default router
