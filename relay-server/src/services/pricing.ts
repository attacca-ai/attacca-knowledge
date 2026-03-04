// Token pricing per 1M tokens (USD)
// Updated pricing as of Feb 2026

interface ModelPricing {
  inputPer1M: number
  outputPer1M: number
}

const PRICING: Record<string, ModelPricing> = {
  // Anthropic
  'claude-sonnet-4-5-20250514': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-sonnet-4-6': { inputPer1M: 3.0, outputPer1M: 15.0 },
  'claude-haiku-4-5': { inputPer1M: 0.8, outputPer1M: 4.0 },

  // OpenAI
  'gpt-4o': { inputPer1M: 2.5, outputPer1M: 10.0 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 }
}

// Fallback pricing for unknown models
const DEFAULT_PRICING: ModelPricing = { inputPer1M: 3.0, outputPer1M: 15.0 }

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = PRICING[model] || DEFAULT_PRICING
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M
  return inputCost + outputCost
}

export function getModelPricing(model: string): ModelPricing {
  return PRICING[model] || DEFAULT_PRICING
}
