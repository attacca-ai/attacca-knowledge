import { createServer, type Server } from 'http'
import { shell } from 'electron'
import { URL } from 'url'
import { net } from 'electron'
import { OAUTH_PROVIDERS } from './providers'
import { getMainWindow } from '../window/main-window'
import { IPC } from '../ipc/channels'
import {
  saveTokens,
  getTokens,
  deleteTokens,
  getAllConnectedToolIds,
  type StoredTokens
} from './token-store'

let activeServer: Server | null = null

function generateState(): string {
  const array = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    array[i] = Math.floor(Math.random() * 256)
  }
  return Buffer.from(array).toString('hex')
}

export async function startOAuthFlow(
  provider: string
): Promise<{ success: boolean; error?: string }> {
  const config = OAUTH_PROVIDERS[provider]
  if (!config) {
    return { success: false, error: `Unknown provider: ${provider}` }
  }

  if (!config.clientId) {
    return {
      success: false,
      error: `OAuth client ID not configured for ${provider}. Set it in environment variables or settings.`
    }
  }

  // Close any existing server
  if (activeServer) {
    activeServer.close()
    activeServer = null
  }

  return new Promise((resolve) => {
    const state = generateState()

    const server = createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://localhost`)
      const code = url.searchParams.get('code')
      const returnedState = url.searchParams.get('state')
      const error = url.searchParams.get('error')

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(
          '<html><body><h2>Connection failed</h2><p>You can close this window.</p></body></html>'
        )
        server.close()
        activeServer = null
        notifyRenderer(provider, false, error)
        resolve({ success: false, error })
        return
      }

      if (code && returnedState === state) {
        // Exchange code for token
        try {
          const redirectUri = `http://127.0.0.1:${(server.address() as { port: number }).port}/callback`
          const tokenData = await exchangeCodeForToken(provider, code, redirectUri)

          saveTokens(provider, tokenData)

          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(
            '<html><body><h2>Connected successfully!</h2><p>You can close this window and return to Attacca.</p></body></html>'
          )
          server.close()
          activeServer = null
          notifyRenderer(provider, true)
          resolve({ success: true })
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Token exchange failed'
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(`<html><body><h2>Connection failed</h2><p>${msg}</p></body></html>`)
          server.close()
          activeServer = null
          notifyRenderer(provider, false, msg)
          resolve({ success: false, error: msg })
        }
        return
      }

      res.writeHead(404)
      res.end()
    })

    server.listen(0, '127.0.0.1', () => {
      activeServer = server
      const port = (server.address() as { port: number }).port
      const redirectUri = `http://127.0.0.1:${port}/callback`

      const authUrl = new URL(config.authUrl)
      authUrl.searchParams.set('client_id', config.clientId)
      authUrl.searchParams.set('redirect_uri', redirectUri)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('state', state)

      // Apply provider-specific extra auth params (e.g. access_type, prompt)
      if (config.extraAuthParams) {
        for (const [key, value] of Object.entries(config.extraAuthParams)) {
          authUrl.searchParams.set(key, value)
        }
      }

      if (config.scopes.length > 0) {
        authUrl.searchParams.set('scope', config.scopes.join(' '))
      }

      shell.openExternal(authUrl.toString())

      // Timeout after 5 minutes
      setTimeout(() => {
        if (activeServer === server) {
          server.close()
          activeServer = null
          resolve({ success: false, error: 'OAuth flow timed out' })
        }
      }, 5 * 60 * 1000)
    })

    server.on('error', (err) => {
      resolve({ success: false, error: `Could not start OAuth server: ${err.message}` })
    })
  })
}

async function exchangeCodeForToken(
  provider: string,
  code: string,
  redirectUri: string
): Promise<StoredTokens> {
  const config = OAUTH_PROVIDERS[provider]
  if (!config) throw new Error(`Unknown provider: ${provider}`)

  const clientSecret = config.clientSecret || ''

  let response: Response

  if (config.tokenExchangeMethod === 'query') {
    // ClickUp-style: POST with query params instead of form body
    const params = new URLSearchParams({
      client_id: config.clientId,
      client_secret: clientSecret,
      code
    })
    response = await net.fetch(`${config.tokenUrl}?${params}`, {
      method: 'POST'
    })
  } else {
    // Standard form body exchange
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: clientSecret
    })

    response = await net.fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    })
  }

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token exchange failed (status ${response.status}): ${text}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
    scope?: string
  }

  const tokenData: StoredTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    token_type: data.token_type,
    scope: data.scope
  }

  return tokenData
}

function notifyRenderer(provider: string, success: boolean, error?: string): void {
  const mainWindow = getMainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.EVENT_OAUTH_CALLBACK, { provider, success, error })
  }
}

export function getOAuthStatus(provider: string): { connected: boolean } {
  return { connected: getTokens(provider) !== null }
}

export function getConnectedTools(): string[] {
  return getAllConnectedToolIds()
}

export function disconnectTool(provider: string): void {
  deleteTokens(provider)
}
