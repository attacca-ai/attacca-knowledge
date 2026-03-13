import { Router } from 'express'
import type { Request, Response } from 'express'
import { isLimitReached, addCost } from '../services/usage.js'
import { calculateCost } from '../services/pricing.js'

const router = Router()

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const OPENAI_CHAT_API_URL = 'https://api.openai.com/v1/chat/completions'
const FALLBACK_OPENAI_MODEL = process.env.OPENAI_FALLBACK_MODEL || 'gpt-5.1'
const CHAT_SAFE_OPENAI_MODEL = process.env.OPENAI_CHAT_FALLBACK_MODEL || 'gpt-4o'

function resolveOpenAIChatModel(model: string): string {
  // Codex models are completion-only and fail on /v1/chat/completions.
  if (model.toLowerCase().includes('codex')) return CHAT_SAFE_OPENAI_MODEL
  return model
}

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
 *
 * Fallback: if Anthropic returns a credit-balance / billing error and OPENAI_API_KEY
 * is configured, the request is automatically retried against OpenAI (gpt-4o), with
 * request/response conversion so OpenClaw sees an Anthropic-format reply.
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

// ─── Billing-error detection ─────────────────────────────────────────────────

function isBillingError(errorData: unknown): boolean {
  const err = errorData as Record<string, unknown>
  const error = err?.error as Record<string, unknown> | undefined
  const message = (error?.message as string ?? '').toLowerCase()
  return (
    message.includes('credit balance') ||
    message.includes('billing') ||
    (error?.type === 'invalid_request_error' && message.includes('too low'))
  )
}

// ─── Computer-use tool type schemas (Anthropic-specific, no input_schema field) ───

const COMPUTER_USE_SCHEMAS: Record<string, { description: string; parameters: Record<string, unknown> }> = {
  bash_20250124: {
    description: 'Execute a bash shell command and return its output.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The bash command to run.' },
        restart: { type: 'boolean', description: 'Restart the bash session if true.' }
      },
      required: ['command']
    }
  },
  bash_20241022: {
    description: 'Execute a bash shell command and return its output.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The bash command to run.' },
        restart: { type: 'boolean' }
      },
      required: ['command']
    }
  },
  computer_20250124: {
    description: 'Interact with the computer screen, mouse, and keyboard.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'The action to perform (e.g. screenshot, left_click, type, key, scroll).' },
        coordinate: { type: 'array', items: { type: 'integer' }, description: '[x, y] pixel coordinate.' },
        text: { type: 'string', description: 'Text to type or key sequence to press.' },
        duration: { type: 'number' },
        scroll_direction: { type: 'string' },
        scroll_distance: { type: 'integer' }
      },
      required: ['action']
    }
  },
  computer_20241022: {
    description: 'Interact with the computer screen, mouse, and keyboard.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        coordinate: { type: 'array', items: { type: 'integer' } },
        text: { type: 'string' }
      },
      required: ['action']
    }
  },
  text_editor_20250429: {
    description: 'View and edit text files.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', enum: ['view', 'create', 'str_replace', 'insert', 'undo_edit'] },
        path: { type: 'string' },
        file_text: { type: 'string' },
        old_str: { type: 'string' },
        new_str: { type: 'string' },
        insert_line: { type: 'integer' },
        new_str_insert: { type: 'string' }
      },
      required: ['command', 'path']
    }
  },
  text_editor_20241022: {
    description: 'View and edit text files.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        path: { type: 'string' },
        file_text: { type: 'string' },
        old_str: { type: 'string' },
        new_str: { type: 'string' }
      },
      required: ['command', 'path']
    }
  }
}

// ─── Anthropic → OpenAI request conversion ───────────────────────────────────

const OPENAI_TOOL_INJECTION = `== AGENTIC EXECUTION MODE ==
You have a "bash" execution tool. Use it for EVERY action — checking email, calendar, Slack, tasks, etc.
To call it: bash({"command": "<exact command from your instructions>"})
Commands look like: echo '<json>' | node "<path>" ACTION_NAME
RULE: Call bash immediately when the user requests any action. NEVER respond with text saying you lack access.
==`

function convertAnthropicToOpenAI(
  body: Record<string, unknown>,
  model: string
): { request: Record<string, unknown> } {
  const messages: Array<Record<string, unknown>> = []

  // System prompt — prepend tool-use injection so GPT-4o actually calls bash
  const hasBashTool = (body.tools as Array<Record<string, unknown>> | undefined)
    ?.some(t => (t.name as string) === 'bash' || (t.type as string | undefined)?.startsWith('bash_'))

  let systemText = ''
  if (typeof body.system === 'string' && body.system) {
    systemText = body.system
  } else if (Array.isArray(body.system)) {
    systemText = (body.system as Array<Record<string, unknown>>)
      .filter(b => b.type === 'text')
      .map(b => b.text as string)
      .join('\n')
  }
  const fullSystem = hasBashTool
    ? `${OPENAI_TOOL_INJECTION}\n\n${systemText}`
    : systemText
  if (fullSystem) messages.push({ role: 'system', content: fullSystem })

  for (const msg of (body.messages as Array<Record<string, unknown>>) ?? []) {
    const role = msg.role as string
    const content = msg.content

    if (typeof content === 'string') {
      messages.push({ role, content })
      continue
    }

    if (!Array.isArray(content)) continue
    const blocks = content as Array<Record<string, unknown>>

    // Strip Anthropic-only blocks that OpenAI doesn't understand
    const knownBlocks  = blocks.filter(b => !['thinking', 'redacted_thinking'].includes(b.type as string))
    const textBlocks    = knownBlocks.filter(b => b.type === 'text')
    const toolUseBlocks = knownBlocks.filter(b => b.type === 'tool_use')
    const toolResults   = knownBlocks.filter(b => b.type === 'tool_result')

    if (toolResults.length > 0) {
      // Each tool_result becomes a separate OpenAI "tool" role message.
      // Any text blocks in the same user turn are prepended as a regular user message.
      if (textBlocks.length > 0) {
        messages.push({ role: 'user', content: textBlocks.map(b => b.text as string).join('') })
      }
      for (const block of toolResults) {
        const b = block as Record<string, unknown>
        const rc = b.content
        const resultContent =
          typeof rc === 'string' ? rc
          : Array.isArray(rc)
            ? (rc as Array<Record<string, unknown>>).filter(c => c.type === 'text').map(c => c.text as string).join('')
            : JSON.stringify(rc ?? '')
        messages.push({ role: 'tool', tool_call_id: b.tool_use_id as string, content: resultContent })
      }
    } else if (toolUseBlocks.length > 0) {
      // Assistant turn with tool calls
      const textContent = textBlocks.map(b => b.text as string).join('')
      const tool_calls = toolUseBlocks.map(b => ({
        id: b.id as string,
        type: 'function',
        function: { name: b.name as string, arguments: JSON.stringify(b.input ?? {}) }
      }))
      messages.push({ role: 'assistant', content: textContent || null, tool_calls })
    } else {
      const text = textBlocks.map(b => b.text as string).join('')
      // Skip empty messages (e.g. a turn that was only thinking blocks)
      if (text) messages.push({ role, content: text })
    }
  }

  // Tools — handle both regular tools (type="tool") and Anthropic computer-use types
  const anthropicTools = body.tools as Array<Record<string, unknown>> | undefined
  const openaiTools = anthropicTools?.map(tool => {
    const toolType = tool.type as string | undefined
    const cuSchema = toolType ? COMPUTER_USE_SCHEMAS[toolType] : undefined
    return {
      type: 'function',
      function: {
        name: tool.name as string,
        description: (tool.description as string | undefined) ?? cuSchema?.description ?? toolType ?? '',
        parameters: (tool.input_schema as Record<string, unknown> | undefined) ?? cuSchema?.parameters ?? { type: 'object', properties: {} }
      }
    }
  })

  const maxTokens = (body.max_tokens as number | undefined) ?? 4096
  const result: Record<string, unknown> = {
    model,
    messages,
    // Newer OpenAI models (o-series, gpt-4.1+, gpt-5.x) require max_completion_tokens
    max_completion_tokens: maxTokens,
    stream: body.stream ?? false,
    stream_options: body.stream === true ? { include_usage: true } : undefined
  }
  if (body.temperature !== undefined) result.temperature = body.temperature
  if (openaiTools && openaiTools.length > 0) {
    result.tools = openaiTools
    // Convert Anthropic tool_choice → OpenAI tool_choice
    const tc = body.tool_choice as Record<string, unknown> | string | undefined
    if (tc) {
      if (typeof tc === 'string') {
        result.tool_choice = tc
      } else if (tc.type === 'auto' || tc.type === 'any') {
        result.tool_choice = 'auto'
      } else if (tc.type === 'none') {
        result.tool_choice = 'none'
      } else if (tc.type === 'tool' && tc.name) {
        result.tool_choice = { type: 'function', function: { name: tc.name } }
      }
    }
  }
  return { request: result }
}

// ─── OpenAI → Anthropic response conversion (non-streaming) ─────────────────

function convertOpenAIToAnthropic(data: Record<string, unknown>, model: string): Record<string, unknown> {
  const choices = data.choices as Array<Record<string, unknown>>
  const choice = choices?.[0]
  const message = choice?.message as Record<string, unknown> | undefined
  const content: Array<Record<string, unknown>> = []

  if (message?.content) {
    content.push({ type: 'text', text: message.content as string })
  }
  if (message?.tool_calls) {
    for (const tc of message.tool_calls as Array<Record<string, unknown>>) {
      const fn = tc.function as Record<string, unknown>
      let input: unknown = {}
      try { input = JSON.parse(fn.arguments as string) } catch { /* leave as {} */ }
      content.push({ type: 'tool_use', id: tc.id as string, name: fn.name as string, input })
    }
  }

  const finishReason = (choice?.finish_reason as string) ?? 'stop'
  const stopReason = finishReason === 'tool_calls' ? 'tool_use' : 'end_turn'
  const usage = data.usage as Record<string, number> | undefined

  return {
    id: `msg_oai_${((data.id as string) ?? '').slice(-12)}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completion_tokens ?? 0
    }
  }
}

// ─── OpenAI streaming → Anthropic streaming SSE conversion ──────────────────

interface OAIStreamDelta {
  role?: string
  content?: string | null
  tool_calls?: Array<{
    index: number
    id?: string
    type?: string
    function?: { name?: string; arguments?: string }
  }>
}

interface OAIStreamChunk {
  id: string
  model: string
  choices: Array<{ index: number; delta: OAIStreamDelta; finish_reason?: string | null }>
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null
}

async function streamOpenAIAsAnthropic(
  openaiResponse: globalThis.Response,
  res: Response,
  model: string
): Promise<{ inputTokens: number; outputTokens: number }> {
  const msgId = `msg_oai_${Date.now()}`

  const emit = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  emit('message_start', {
    type: 'message_start',
    message: {
      id: msgId, type: 'message', role: 'assistant', content: [],
      model, stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 1 }
    }
  })
  emit('ping', { type: 'ping' })

  const reader = openaiResponse.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  // Block index tracking
  let nextBlockIdx = 0
  let textBlockIdx = -1   // -1 = not yet started

  // tool call index (OpenAI) → { blockIdx, id, name, argsAcc }
  const toolBlocks = new Map<number, { blockIdx: number; id: string; name: string; argsAcc: string }>()

  let inputTokens = 0
  let outputTokens = 0
  let finishReason = 'stop'

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (raw === '[DONE]') continue

        let chunk: OAIStreamChunk
        try { chunk = JSON.parse(raw) } catch { continue }

        // Capture usage from any chunk (stream_options puts it in final chunk)
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? inputTokens
          outputTokens = chunk.usage.completion_tokens ?? outputTokens
        }

        const choice = chunk.choices?.[0]
        if (!choice) continue

        if (choice.finish_reason) finishReason = choice.finish_reason

        const delta = choice.delta

        // ── Text content ──
        if (typeof delta.content === 'string' && delta.content) {
          if (textBlockIdx === -1) {
            textBlockIdx = nextBlockIdx++
            emit('content_block_start', {
              type: 'content_block_start',
              index: textBlockIdx,
              content_block: { type: 'text', text: '' }
            })
          }
          emit('content_block_delta', {
            type: 'content_block_delta',
            index: textBlockIdx,
            delta: { type: 'text_delta', text: delta.content }
          })
        }

        // ── Tool calls ──
        if (delta.tool_calls) {
          for (const tcDelta of delta.tool_calls) {
            const oaiIdx = tcDelta.index

            if (tcDelta.id) {
              // New tool call starting — open an Anthropic tool_use block
              const blockIdx = nextBlockIdx++
              toolBlocks.set(oaiIdx, { blockIdx, id: tcDelta.id, name: tcDelta.function?.name ?? '', argsAcc: '' })
              emit('content_block_start', {
                type: 'content_block_start',
                index: blockIdx,
                content_block: { type: 'tool_use', id: tcDelta.id, name: tcDelta.function?.name ?? '', input: {} }
              })
            }

            if (tcDelta.function?.arguments) {
              const tb = toolBlocks.get(oaiIdx)
              if (tb) {
                tb.argsAcc += tcDelta.function.arguments
                emit('content_block_delta', {
                  type: 'content_block_delta',
                  index: tb.blockIdx,
                  delta: { type: 'input_json_delta', partial_json: tcDelta.function.arguments }
                })
              }
            }
          }
        }
      }
    }
  } finally {
    // Close text block
    if (textBlockIdx !== -1) {
      emit('content_block_stop', { type: 'content_block_stop', index: textBlockIdx })
    }
    // Close tool blocks
    for (const tb of toolBlocks.values()) {
      emit('content_block_stop', { type: 'content_block_stop', index: tb.blockIdx })
    }

    const stopReason = finishReason === 'tool_calls' ? 'tool_use' : 'end_turn'
    emit('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: outputTokens }
    })
    emit('message_stop', { type: 'message_stop' })
    res.end()
  }

  return { inputTokens, outputTokens }
}

// ─── Main proxy handler ──────────────────────────────────────────────────────

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

      // ── OpenAI fallback on billing errors ──────────────────────────────────
      if (isBillingError(errorData)) {
        const openaiKey = process.env.OPENAI_API_KEY
        if (openaiKey) {
          console.warn(`[anthropic-proxy] Anthropic credit balance exhausted — falling back to OpenAI ${FALLBACK_OPENAI_MODEL}`)
          await handleOpenAIFallback(req, res, body, isStream, openaiKey, keyHash)
          return
        }
        console.error('[anthropic-proxy] Billing error but no OPENAI_API_KEY configured for fallback')
      }

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
                  if (usage?.input_tokens) inputTokens = usage.input_tokens
                } else if (evt.type === 'message_delta') {
                  const usage = evt.usage as Record<string, number> | undefined
                  if (usage?.output_tokens) outputTokens = usage.output_tokens
                  // interleaved-thinking beta reports final input_tokens in message_delta too
                  if (usage?.input_tokens) inputTokens = usage.input_tokens
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

// ─── OpenAI fallback handler ─────────────────────────────────────────────────

async function handleOpenAIFallback(
  _req: Request,
  res: Response,
  body: Record<string, unknown>,
  isStream: boolean,
  openaiKey: string,
  keyHash: string | undefined
): Promise<void> {
  const fallbackModel = resolveOpenAIChatModel(FALLBACK_OPENAI_MODEL)
  const openaiBody = convertAnthropicToOpenAI(body, fallbackModel)
  const openaiRequest = openaiBody.request

  if (fallbackModel !== FALLBACK_OPENAI_MODEL) {
    console.warn(
      `[anthropic-proxy] OpenAI model ${FALLBACK_OPENAI_MODEL} is not chat-compatible; switching to ${fallbackModel}`
    )
  }

  console.log(
    `[anthropic-proxy] OpenAI fallback — stream=${isStream} model=${fallbackModel}`
  )

  try {
    const upstream = await fetch(OPENAI_CHAT_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${openaiKey}`
      },
      body: JSON.stringify(openaiRequest)
    })

    console.log(`[anthropic-proxy] OpenAI responded — status=${upstream.status}`)

    if (upstream.status !== 200) {
      const errorText = await upstream.text().catch(() => 'unknown error')
      console.error('[anthropic-proxy] OpenAI fallback error:', errorText.slice(0, 500))
      if (!res.headersSent) {
        res.status(502).json({
          type: 'error',
          error: { type: 'api_error', message: `OpenAI fallback failed (${upstream.status})` }
        })
      }
      return
    }

    if (isStream) {
      res.setHeader('content-type', 'text/event-stream')
      res.setHeader('cache-control', 'no-cache')
      res.setHeader('connection', 'keep-alive')

      const { inputTokens, outputTokens } = await streamOpenAIAsAnthropic(upstream, res, fallbackModel)
      console.log(`[anthropic-proxy] OpenAI fallback stream done — tokens(in=${inputTokens} out=${outputTokens})`)
      if (keyHash && (inputTokens > 0 || outputTokens > 0)) {
        const cost = calculateCost(fallbackModel, inputTokens, outputTokens)
        addCost(keyHash, cost).catch((err) =>
          console.error('[anthropic-proxy] addCost (OpenAI fallback) failed:', err)
        )
      }
    } else {
      const data = await upstream.json() as Record<string, unknown>
      const anthropicData = convertOpenAIToAnthropic(data, fallbackModel)
      const inputTokens = (anthropicData.usage as Record<string, number>)?.input_tokens ?? 0
      const outputTokens = (anthropicData.usage as Record<string, number>)?.output_tokens ?? 0
      console.log(`[anthropic-proxy] OpenAI fallback done — tokens(in=${inputTokens} out=${outputTokens})`)
      res.status(200).json(anthropicData)
      if (keyHash && (inputTokens > 0 || outputTokens > 0)) {
        const cost = calculateCost(fallbackModel, inputTokens, outputTokens)
        addCost(keyHash, cost).catch((err) =>
          console.error('[anthropic-proxy] addCost (OpenAI fallback) failed:', err)
        )
      }
    }
  } catch (err) {
    console.error('[anthropic-proxy] OpenAI fallback fetch error:', err)
    if (!res.headersSent) {
      res.status(502).json({
        type: 'error',
        error: {
          type: 'api_error',
          message: err instanceof Error ? err.message : 'OpenAI fallback failed'
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
