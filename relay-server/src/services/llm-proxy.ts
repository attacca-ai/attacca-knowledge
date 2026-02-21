import { calculateCost } from './pricing.js'

export interface LLMCompletionRequest {
  messages: Array<{ role: string; content: string }>
  model?: string
  max_tokens?: number
  temperature?: number
  stream?: boolean
}

export interface LLMCompletionResponse {
  id: string
  model: string
  content: string
  usage: {
    input_tokens: number
    output_tokens: number
  }
  cost_usd: number
  provider: string
}

interface AnthropicResponse {
  id: string
  model: string
  content: Array<{ type: string; text: string }>
  usage: { input_tokens: number; output_tokens: number }
}

interface OpenAIResponse {
  id: string
  model: string
  choices: Array<{ message: { content: string } }>
  usage: { prompt_tokens: number; completion_tokens: number }
}

export async function completeLLM(
  request: LLMCompletionRequest
): Promise<LLMCompletionResponse> {
  // Try Anthropic first (primary)
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (anthropicKey) {
    try {
      return await callAnthropic(request, anthropicKey)
    } catch (err) {
      console.error('[llm-proxy] Anthropic call failed, trying fallback:', err)
    }
  }

  // Fallback to OpenAI
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    try {
      return await callOpenAI(request, openaiKey)
    } catch (err) {
      console.error('[llm-proxy] OpenAI fallback failed:', err)
      throw new Error('All LLM providers failed')
    }
  }

  throw new Error('No LLM provider API keys configured')
}

async function callAnthropic(
  request: LLMCompletionRequest,
  apiKey: string
): Promise<LLMCompletionResponse> {
  const model = request.model || 'claude-sonnet-4-5-20250514'

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      messages: request.messages,
      max_tokens: request.max_tokens || 4096,
      temperature: request.temperature ?? 0.7
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Anthropic API error ${response.status}: ${errorText}`)
  }

  const data = (await response.json()) as AnthropicResponse
  const cost = calculateCost(data.model, data.usage.input_tokens, data.usage.output_tokens)

  // Structured operational log (no content)
  console.log(
    JSON.stringify({
      event: 'llm_request',
      provider: 'anthropic',
      model: data.model,
      input_tokens: data.usage.input_tokens,
      output_tokens: data.usage.output_tokens,
      cost_usd: cost,
      timestamp: new Date().toISOString()
    })
  )

  return {
    id: data.id,
    model: data.model,
    content: data.content.map((c) => c.text).join(''),
    usage: data.usage,
    cost_usd: cost,
    provider: 'anthropic'
  }
}

async function callOpenAI(
  request: LLMCompletionRequest,
  apiKey: string
): Promise<LLMCompletionResponse> {
  const model = request.model || 'gpt-4o'

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: request.messages,
      max_tokens: request.max_tokens || 4096,
      temperature: request.temperature ?? 0.7
    })
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`)
  }

  const data = (await response.json()) as OpenAIResponse
  const inputTokens = data.usage.prompt_tokens
  const outputTokens = data.usage.completion_tokens
  const cost = calculateCost(data.model, inputTokens, outputTokens)

  console.log(
    JSON.stringify({
      event: 'llm_request',
      provider: 'openai',
      model: data.model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: cost,
      timestamp: new Date().toISOString()
    })
  )

  return {
    id: data.id,
    model: data.model,
    content: data.choices[0]?.message?.content || '',
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
    cost_usd: cost,
    provider: 'openai'
  }
}
