import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import type { TokenSet } from './types'

const ENC_HEADER = 'ENCRYPTED\n'
const PLAIN_HEADER = 'PLAINTEXT\n'

function sanitizeSlug(slug: string): string {
  if (typeof slug !== 'string' || slug.length === 0) {
    throw new Error(`[token-store] Invalid slug: ${String(slug)}`)
  }
  // Allow only alphanumeric, dash, underscore. Reject any path traversal tokens.
  if (!/^[a-zA-Z0-9_-]+$/.test(slug)) {
    throw new Error(`[token-store] Unsafe slug rejected: ${slug}`)
  }
  return slug
}

function getTokenPath(slug: string): string {
  return join(app.getPath('userData'), 'tokens', `${sanitizeSlug(slug)}.enc`)
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function saveTokens(slug: string, tokens: TokenSet): void {
  const filePath = getTokenPath(slug)
  ensureDir(filePath)
  const json = JSON.stringify(tokens)
  if (safeStorage.isEncryptionAvailable()) {
    const header = Buffer.from(ENC_HEADER, 'utf-8')
    const body = safeStorage.encryptString(json)
    writeFileSync(filePath, Buffer.concat([header, body]))
  } else {
    writeFileSync(filePath, PLAIN_HEADER + json, 'utf-8')
  }
  console.log(`[token-store] Saved tokens for ${slug}`)
}

export function loadTokens(slug: string): TokenSet | null {
  const filePath = getTokenPath(slug)
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath)
    // Detect format header — supports legacy payloads without header.
    let json: string
    if (raw.length >= PLAIN_HEADER.length && raw.slice(0, PLAIN_HEADER.length).toString('utf-8') === PLAIN_HEADER) {
      json = raw.slice(PLAIN_HEADER.length).toString('utf-8')
    } else if (raw.length >= ENC_HEADER.length && raw.slice(0, ENC_HEADER.length).toString('utf-8') === ENC_HEADER) {
      if (!safeStorage.isEncryptionAvailable()) {
        console.error(`[token-store] Encrypted payload for ${slug} but encryption unavailable`)
        return null
      }
      json = safeStorage.decryptString(raw.slice(ENC_HEADER.length))
    } else {
      // Legacy (no header) — best-effort: try encryption first, fall back to plain.
      if (safeStorage.isEncryptionAvailable()) {
        try {
          json = safeStorage.decryptString(raw)
        } catch {
          json = raw.toString('utf-8')
        }
      } else {
        json = raw.toString('utf-8')
      }
    }
    return JSON.parse(json) as TokenSet
  } catch (err) {
    console.error(`[token-store] Failed to load tokens for ${slug}:`, err)
    return null
  }
}

export function clearTokens(slug: string): void {
  const filePath = getTokenPath(slug)
  if (existsSync(filePath)) {
    unlinkSync(filePath)
    console.log(`[token-store] Cleared tokens for ${slug}`)
  }
}

export function hasTokens(slug: string): boolean {
  return existsSync(getTokenPath(slug))
}

export function isTokenExpired(slug: string): boolean {
  const tokens = loadTokens(slug)
  if (!tokens) return true
  if (!tokens.expires_at) return false
  return Date.now() > tokens.expires_at
}
