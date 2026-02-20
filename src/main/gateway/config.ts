import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const OPENCLAW_DIR = join(homedir(), '.openclaw')
const CONFIG_PATH = join(OPENCLAW_DIR, 'openclaw.json')

export interface OpenClawConfig {
  gateway: {
    port: number
    host: string
  }
  llm?: {
    provider: 'anthropic' | 'openai' | 'google'
    model: string
    apiKey: string
  }
  workspace?: string
}

const DEFAULT_CONFIG: OpenClawConfig = {
  gateway: {
    port: 18789,
    host: '127.0.0.1'
  }
}

export function ensureConfig(): OpenClawConfig {
  if (!existsSync(OPENCLAW_DIR)) {
    mkdirSync(OPENCLAW_DIR, { recursive: true })
  }

  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8')
    return DEFAULT_CONFIG
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    return JSON.parse(raw) as OpenClawConfig
  } catch {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8')
    return DEFAULT_CONFIG
  }
}

export function readConfig(): OpenClawConfig {
  if (!existsSync(CONFIG_PATH)) {
    return ensureConfig()
  }
  const raw = readFileSync(CONFIG_PATH, 'utf-8')
  return JSON.parse(raw) as OpenClawConfig
}

export function writeConfig(config: OpenClawConfig): void {
  if (!existsSync(OPENCLAW_DIR)) {
    mkdirSync(OPENCLAW_DIR, { recursive: true })
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

export function getGatewayUrl(): string {
  const config = readConfig()
  return `ws://${config.gateway.host}:${config.gateway.port}`
}

export function getConfigPath(): string {
  return CONFIG_PATH
}

export function getOpenClawDir(): string {
  return OPENCLAW_DIR
}
