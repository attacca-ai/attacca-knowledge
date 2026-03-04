import { Router } from 'express'
import { completeLLM, type LLMCompletionRequest } from '../services/llm-proxy.js'
import { addCost } from '../services/usage.js'

const router = Router()

router.post('/completions', async (req, res) => {
  const license = req.license
  if (!license) {
    res.status(401).json({ error: 'No license context' })
    return
  }

  const body = req.body as LLMCompletionRequest

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({ error: 'messages array is required' })
    return
  }

  try {
    const result = await completeLLM(body)

    // Track usage cost
    await addCost(license.keyHash, result.cost_usd)

    res.json({
      id: result.id,
      model: result.model,
      content: result.content,
      usage: result.usage,
      provider: result.provider
    })
  } catch (err) {
    console.error('[llm] Completion error:', err)
    res.status(502).json({
      error: 'LLM provider error',
      message: err instanceof Error ? err.message : 'Unknown error'
    })
  }
})

export default router
