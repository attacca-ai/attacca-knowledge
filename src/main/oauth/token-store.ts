import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

const TOKEN_FILE = join(app.getPath('userData'), 'oauth-tokens.enc')

export interface StoredTokens {
  access_token: string
  refresh_token?: string
  expires_at?: number // Date.now() + expires_in * 1000
  token_type?: string
  scope?: string
}

type TokenStore = Record<string, StoredTokens>

function loadAll(): TokenStore {
  if (!existsSync(TOKEN_FILE)) return {}

  try {
    const raw = readFileSync(TOKEN_FILE)
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(raw)
      return JSON.parse(decrypted) as TokenStore
    } else {
      return JSON.parse(raw.toString('utf-8')) as TokenStore
    }
  } catch {
    return {}
  }
}

function saveAll(store: TokenStore): void {
  const dir = dirname(TOKEN_FILE)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const json = JSON.stringify(store)
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(json)
    writeFileSync(TOKEN_FILE, encrypted)
  } else {
    writeFileSync(TOKEN_FILE, json, 'utf-8')
  }
}

export function saveTokens(toolId: string, data: StoredTokens): void {
  const store = loadAll()
  store[toolId] = data
  saveAll(store)
}

export function getTokens(toolId: string): StoredTokens | null {
  const store = loadAll()
  return store[toolId] ?? null
}

export function deleteTokens(toolId: string): void {
  const store = loadAll()
  delete store[toolId]
  saveAll(store)
}

export function isTokenExpired(tokens: StoredTokens): boolean {
  if (!tokens.expires_at) return false
  return Date.now() >= tokens.expires_at - 60_000
}

export function getAllConnectedToolIds(): string[] {
  const store = loadAll()
  const tools = Object.keys(store)

  // Check non-OAuth tools (Telegram, ActiveCollab) by their config files
  const userDataPath = app.getPath('userData')
  if (existsSync(join(userDataPath, 'telegram-config.json'))) {
    tools.push('telegram')
  }
  if (existsSync(join(userDataPath, 'activecollab-config.json'))) {
    tools.push('activecollab')
  }

  return tools
}
