import { net } from 'electron'
import { OAUTH_PROVIDERS } from './providers'
import { getTokens, saveTokens, isTokenExpired, type StoredTokens } from './token-store'

// In-flight refresh promises to prevent concurrent refreshes per toolId
const refreshPromises = new Map<string, Promise<StoredTokens>>()

export async function getValidToken(toolId: string): Promise<StoredTokens> {
  const tokens = getTokens(toolId)
  if (!tokens) throw new Error(`${toolId} not connected`)

  if (isTokenExpired(tokens)) {
    return refreshAccessToken(toolId)
  }

  return tokens
}

export async function refreshAccessToken(toolId: string): Promise<StoredTokens> {
  // Return existing in-flight refresh if one is running
  const existing = refreshPromises.get(toolId)
  if (existing) return existing

  const promise = doRefresh(toolId)
  refreshPromises.set(toolId, promise)

  try {
    return await promise
  } finally {
    refreshPromises.delete(toolId)
  }
}

async function doRefresh(toolId: string): Promise<StoredTokens> {
  const tokens = getTokens(toolId)
  if (!tokens) throw new Error(`${toolId} not connected`)

  // ClickUp has no refresh tokens — tokens are permanent
  if (!tokens.refresh_token) {
    return tokens
  }

  const config = OAUTH_PROVIDERS[toolId]
  if (!config) throw new Error(`No provider config for ${toolId}`)

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: config.clientId,
    client_secret: config.clientSecret || ''
  })

  const response = await net.fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token refresh failed for ${toolId} (${response.status}): ${text}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
    scope?: string
  }

  const updated: StoredTokens = {
    access_token: data.access_token,
    // Google may or may not return a new refresh_token — preserve existing one
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : tokens.expires_at,
    token_type: data.token_type || tokens.token_type,
    scope: data.scope || tokens.scope
  }

  saveTokens(toolId, updated)
  return updated
}
