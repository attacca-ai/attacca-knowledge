// Relay API request/response types

export interface RelayLLMRequest {
  messages: Array<{ role: string; content: string }>
  model?: string
  max_tokens?: number
  temperature?: number
}

export interface RelayLLMResponse {
  id: string
  model: string
  content: string
  usage: {
    input_tokens: number
    output_tokens: number
  }
  provider: string
}

export interface RelayUsageInfo {
  totalCostUsd: number
  limitUsd: number
  requestCount: number
  limitReached: boolean
  resetDate: string
}

export interface RelayOAuthInitResponse {
  success: boolean
  connectionId: string
  redirectUrl: string
}

export interface RelayOAuthStatusResponse {
  connectionId: string
  status: 'initiated' | 'active' | 'failed' | 'expired'
  appName: string
}

export interface RelayComposioProxyResponse {
  success: boolean
  result: unknown
}

export interface RelayConnectedAppsResponse {
  apps: string[]
}

export interface RelayErrorResponse {
  error: string
  message?: string
  limitUsd?: number
}
