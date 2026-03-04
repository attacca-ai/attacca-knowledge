import { net } from 'electron'
import { loadLicense } from '../license/store'
import type {
  RelayLLMRequest,
  RelayLLMResponse,
  RelayUsageInfo,
  RelayOAuthInitResponse,
  RelayOAuthStatusResponse,
  RelayComposioProxyResponse,
  RelayConnectedAppsResponse,
  RelayErrorResponse
} from './types'

const RELAY_BASE_URL = 'http://127.0.0.1:3100'
const MAX_RETRIES = 3
const BACKOFF_BASE_MS = 2000 // 2s, 8s, 32s

function getRelayUrl(): string {
  return RELAY_BASE_URL
}

function getLicenseKey(): string {
  const stored = loadLicense()
  if (!stored?.key) throw new Error('No license key available')
  return stored.key
}

async function relayFetch<T>(
  path: string,
  options: {
    method?: string
    body?: unknown
    retries?: number
  } = {}
): Promise<T> {
  const { method = 'GET', body, retries = MAX_RETRIES } = options
  const url = `${getRelayUrl()}${path}`
  const licenseKey = getLicenseKey()

  let lastError: Error | null = null

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const fetchOptions: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${licenseKey}`,
          'Content-Type': 'application/json'
        }
      }

      if (body && method !== 'GET') {
        fetchOptions.body = JSON.stringify(body)
      }

      const response = await net.fetch(url, fetchOptions)

      // Don't retry on client errors (4xx)
      if (response.status >= 400 && response.status < 500) {
        const errorData = (await response.json()) as RelayErrorResponse

        if (errorData.error === 'usage_limit_reached') {
          throw new RelayUsageLimitError(errorData.message || 'Usage limit reached')
        }

        throw new RelayClientError(
          errorData.error || `Client error ${response.status}`,
          response.status
        )
      }

      if (!response.ok) {
        throw new Error(`Relay error ${response.status}`)
      }

      return (await response.json()) as T
    } catch (err) {
      // Don't retry on client errors or usage limit
      if (err instanceof RelayClientError || err instanceof RelayUsageLimitError) {
        throw err
      }

      lastError = err instanceof Error ? err : new Error(String(err))

      // Exponential backoff: 2s, 8s, 32s
      if (attempt < retries - 1) {
        const delay = BACKOFF_BASE_MS * Math.pow(4, attempt)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError || new Error('Relay request failed after retries')
}

export class RelayClientError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message)
    this.name = 'RelayClientError'
  }
}

export class RelayUsageLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RelayUsageLimitError'
  }
}

// ── LLM ──

export async function relayLLMCompletion(
  request: RelayLLMRequest
): Promise<RelayLLMResponse> {
  return relayFetch<RelayLLMResponse>('/llm/completions', {
    method: 'POST',
    body: request
  })
}

// ── Usage ──

export async function relayGetUsage(): Promise<RelayUsageInfo> {
  return relayFetch<RelayUsageInfo>('/usage')
}

// ── Composio OAuth ──

export async function relayInitiateOAuth(
  appName: string
): Promise<RelayOAuthInitResponse> {
  return relayFetch<RelayOAuthInitResponse>('/composio/oauth/initiate', {
    method: 'POST',
    body: { appName }
  })
}

export async function relayGetOAuthStatus(
  connectionId: string
): Promise<RelayOAuthStatusResponse> {
  return relayFetch<RelayOAuthStatusResponse>(
    `/composio/oauth/status?connectionId=${encodeURIComponent(connectionId)}`
  )
}

export async function relayProxyToolAction(
  actionName: string,
  params: Record<string, unknown>
): Promise<RelayComposioProxyResponse> {
  return relayFetch<RelayComposioProxyResponse>('/composio/proxy', {
    method: 'POST',
    body: { actionName, params }
  })
}

export async function relayGetConnectedApps(): Promise<string[]> {
  const result = await relayFetch<RelayConnectedAppsResponse>('/composio/connected')
  return result.apps
}
