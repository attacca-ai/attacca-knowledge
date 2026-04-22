/**
 * LLM configuration management.
 * Reads/writes the user's LLM provider settings (API key, model, provider).
 * Extracted from gateway/config.ts during OpenClaw removal.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

export interface LLMConfig {
  provider: 'anthropic'
  model: string
  apiKey: string
}

const LLM_CONFIG_PATH = join(app.getPath('userData'), 'llm-config.json')

export function readLLMConfig(): LLMConfig | null {
  try {
    if (!existsSync(LLM_CONFIG_PATH)) return null
    return JSON.parse(readFileSync(LLM_CONFIG_PATH, 'utf-8')) as LLMConfig
  } catch {
    return null
  }
}

export function writeLLMConfig(config: LLMConfig): void {
  try {
    writeFileSync(LLM_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[llm-config] Failed to write LLM config:', msg)
    throw new Error(`Failed to write LLM config: ${msg}`)
  }
}

export function getApiKey(): string | null {
  return readLLMConfig()?.apiKey ?? null
}

export function getModel(): string {
  return readLLMConfig()?.model ?? 'claude-sonnet-4-6'
}
