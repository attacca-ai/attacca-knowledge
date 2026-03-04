import { Router } from 'express'
import type { Request, Response } from 'express'
import { isLimitReached, addCost } from '../services/usage.js'
import { calculateCost } from '../services/pricing.js'

const router = Router()

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

/**
 * Anthropic-compatible proxy for the local OpenClaw gateway.
 *
 * The gateway is configured via openclaw.json to use the "attacca-relay"
 * custom provider pointing at this endpoint. All agent LLM calls are powered
 * by the relay's ANTHROPIC_API_KEY, so users get a working experience without
 * needing to configure their own API key (BYOK is an optional upgrade).
 *
 * Auth: x-api-key header is checked against RELAY_SERVICE_TOKEN.
 *
 * Two routes:
 *   POST /u/:keyHash/v1/messages  — per-user usage tracking + $30 ceiling enforcement
 *   POST /v1/messages             — no tracking (fallback / no license available)
 */

// Route with per-user usage tracking (used when license key is available)
router.post('/u/:keyHash/v1/messages', async (req: Request, res: Response) => {
  const keyHash = req.params['keyHash'] as string
  await handleProxy(req, res, keyHash)
})

// TEST-MODE ONLY — disabled in production.
// This route has no usage tracking or ceiling enforcement.
// router.post('/v1/messages', async (req: Request, res: Response) => {
//   await handleProxy(req, res)
// })

async function handleProxy(req: Request, res: Response, keyHash?: string): Promise<void> {
  // Service-level auth
  const providedKey = req.headers['x-api-key'] as string | undefined
  const serviceToken = process.env.RELAY_SERVICE_TOKEN || 'attacca-relay-service'

  console.log(
    `[anthropic-proxy] Request received — keyOk=${providedKey === serviceToken} hasBody=${!!req.body} model=${(req.body as Record<string, unknown>)?.model ?? 'unknown'} tracked=${!!keyHash}`
  )

  if (providedKey !== serviceToken) {
    console.error('[anthropic-proxy] Auth failed — invalid service key')
    res.status(401).json({
      type: 'error',
      error: { type: 'authentication_error', message: 'Invalid service key' }
    })
    return
  }

  // Usage ceiling check (only when tracking a specific user)
  if (keyHash) {
    try {
      const limitHit = await isLimitReached(keyHash)
      if (limitHit) {
        console.warn(`[anthropic-proxy] Usage limit reached for keyHash=${keyHash.slice(0, 8)}…`)
        res.status(429).json({
          type: 'error',
          error: {
            type: 'rate_limit_error',
            message: 'Monthly usage ceiling reached ($30). Enable BYOK in Settings to continue.'
          }
        })
        return
      }
    } catch (err) {
      console.error('[anthropic-proxy] Usage check failed (fail open):', err)
    }
  }

  const relayKey = process.env.ANTHROPIC_API_KEY
  if (!relayKey) {
    console.error('[anthropic-proxy] No ANTHROPIC_API_KEY configured')
    res.status(503).json({
      type: 'error',
      error: { type: 'api_error', message: 'Anthropic API key not configured on relay' }
    })
    return
  }

  if (!req.body || Object.keys(req.body as object).length === 0) {
    console.error('[anthropic-proxy] Empty or missing body — Content-Type may not be application/json')
    res.status(400).json({
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Request body is empty or was not parsed' }
    })
    return
  }

  const body = req.body as Record<string, unknown>
  const isStream = body?.stream === true
  const model = (body?.model as string) ?? 'unknown'

  // Forward relevant Anthropic headers from OpenClaw (e.g. anthropic-beta for tool use)
  const forwardHeaders: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': relayKey,
    'anthropic-version': ANTHROPIC_VERSION
  }
  const betaHeader = req.headers['anthropic-beta'] as string | undefined
  if (betaHeader) forwardHeaders['anthropic-beta'] = betaHeader

  console.log(
    `[anthropic-proxy] Forwarding to Anthropic — stream=${isStream} beta=${betaHeader ?? 'none'}`
  )

  try {
    const upstream = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: forwardHeaders,
      body: JSON.stringify(req.body)
    })

    console.log(`[anthropic-proxy] Anthropic responded — status=${upstream.status}`)

    if (upstream.status !== 200) {
      const errorData = await upstream.json().catch(() => ({
        type: 'error',
        error: { type: 'api_error', message: `Anthropic returned ${upstream.status}` }
      }))
      console.error('[anthropic-proxy] Anthropic error response:', JSON.stringify(errorData))
      res.status(upstream.status).json(errorData)
      return
    }

    if (isStream) {
      res.setHeader('content-type', 'text/event-stream')
      res.setHeader('cache-control', 'no-cache')
      res.setHeader('connection', 'keep-alive')

      if (upstream.body) {
        const reader = upstream.body.getReader()
        const decoder = new TextDecoder()
        let accText = ''
        let inputTokens = 0
        let outputTokens = 0
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value, { stream: true })
            res.write(chunk)
            // Accumulate tokens for cost tracking and logging
            for (const line of chunk.split('\n')) {
              if (!line.startsWith('data: ')) continue
              try {
                const evt = JSON.parse(line.slice(6)) as Record<string, unknown>
                const delta = evt.delta as Record<string, unknown> | undefined
                if (evt.type === 'content_block_delta' && delta?.type === 'text_delta') {
                  accText += (delta.text as string) ?? ''
                } else if (evt.type === 'message_start') {
                  const usage = (evt.message as Record<string, unknown>)?.usage as Record<string, number> | undefined
                  inputTokens = usage?.input_tokens ?? 0
                } else if (evt.type === 'message_delta') {
                  const usage = evt.usage as Record<string, number> | undefined
                  outputTokens = usage?.output_tokens ?? 0
                }
              } catch { /* ignore SSE parse errors */ }
            }
          }
        } finally {
          res.end()
          const preview = accText.length > 200 ? accText.slice(0, 200) + '…' : accText
          console.log(`[anthropic-proxy] Claude response — tokens(in=${inputTokens} out=${outputTokens}) text="${preview}"`)
          if (keyHash && (inputTokens > 0 || outputTokens > 0)) {
            const cost = calculateCost(model, inputTokens, outputTokens)
            addCost(keyHash, cost).catch((err) =>
              console.error('[anthropic-proxy] addCost failed:', err)
            )
          }
        }
      } else {
        res.status(200).end()
      }
    } else {
      const data = await upstream.json() as Record<string, unknown>
      const content = data.content as Array<Record<string, unknown>> | undefined
      const text = content?.find((b) => b.type === 'text')?.text as string | undefined
      const usage = data.usage as Record<string, number> | undefined
      const inputTokens = usage?.input_tokens ?? 0
      const outputTokens = usage?.output_tokens ?? 0
      const preview = (text ?? '').length > 200 ? (text ?? '').slice(0, 200) + '…' : (text ?? '')
      console.log(`[anthropic-proxy] Claude response — tokens(in=${inputTokens} out=${outputTokens}) text="${preview}"`)
      res.status(200).json(data)
      if (keyHash && (inputTokens > 0 || outputTokens > 0)) {
        const cost = calculateCost(model, inputTokens, outputTokens)
        addCost(keyHash, cost).catch((err) =>
          console.error('[anthropic-proxy] addCost failed:', err)
        )
      }
    }
  } catch (err) {
    console.error('[anthropic-proxy] Upstream fetch error:', err)
    if (!res.headersSent) {
      res.status(502).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: err instanceof Error ? err.message : 'Upstream request failed'
        }
      })
    }
  }
}

// Catch-all to diagnose unexpected paths (OpenClaw may use a different URL format)
router.use((req: Request, res: Response) => {
  console.error(`[anthropic-proxy] Unhandled path: ${req.method} ${req.path}`)
  res.status(404).json({
    type: 'error',
    error: { type: 'not_found', message: `No handler for ${req.method} ${req.path}` }
  })
})

export default router
