import { net } from 'electron'
import { getTokens, isTokenExpired } from '../../oauth/token-store'
import { refreshAccessToken } from '../../oauth/oauth-manager'

const BASE_URL = 'https://graph.microsoft.com/v1.0'

async function getValidToken(): Promise<string> {
  const tokens = getTokens('outlook-email')
  if (!tokens) throw new Error('Outlook Email not connected')
  if (isTokenExpired(tokens)) {
    const refreshed = await refreshAccessToken('outlook-email')
    return refreshed.access_token
  }
  return tokens.access_token
}

async function apiRequest(
  endpoint: string,
  options: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Promise<unknown> {
  const token = await getValidToken()
  const url = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`

  const response = await net.fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    },
    body: options.body
  })

  if (response.status === 401) {
    // Retry once with refreshed token
    const refreshed = await refreshAccessToken('outlook-email')
    const retry = await net.fetch(url, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${refreshed.access_token}`,
        'Content-Type': 'application/json'
      },
      body: options.body
    })
    if (!retry.ok) {
      throw new Error(`Outlook Email API error: ${retry.status}`)
    }
    if (retry.status === 204) return null
    return retry.json()
  }

  if (!response.ok) {
    throw new Error(
      `Outlook Email API error (${response.status}): ${await response.text()}`
    )
  }
  if (response.status === 204) return null
  return response.json()
}

// === READ (Low Risk) ===

export async function listMessages(
  options: {
    top?: number
    filter?: string
    search?: string
    select?: string[]
    orderby?: string
    skip?: number
  } = {}
): Promise<{ value: unknown[]; '@odata.nextLink'?: string }> {
  const params = new URLSearchParams()
  if (options.top) params.set('$top', String(options.top))
  if (options.filter) params.set('$filter', options.filter)
  if (options.search) params.set('$search', `"${options.search}"`)
  if (options.select) params.set('$select', options.select.join(','))
  if (options.orderby) params.set('$orderby', options.orderby)
  if (options.skip) params.set('$skip', String(options.skip))

  return apiRequest(`/me/messages?${params}`) as Promise<{
    value: unknown[]
    '@odata.nextLink'?: string
  }>
}

export async function getMessage(messageId: string): Promise<unknown> {
  return apiRequest(`/me/messages/${messageId}`)
}

export async function getMailFolders(): Promise<{ value: unknown[] }> {
  return apiRequest('/me/mailFolders') as Promise<{ value: unknown[] }>
}

// === WRITE (Mid Risk) ===

export async function createDraft(message: {
  subject: string
  body: { contentType: 'Text' | 'HTML'; content: string }
  toRecipients: Array<{ emailAddress: { address: string; name?: string } }>
  ccRecipients?: Array<{ emailAddress: { address: string; name?: string } }>
}): Promise<unknown> {
  return apiRequest('/me/messages', {
    method: 'POST',
    body: JSON.stringify({ ...message, isDraft: true })
  })
}

export async function moveMessage(
  messageId: string,
  destinationFolderId: string
): Promise<unknown> {
  return apiRequest(`/me/messages/${messageId}/move`, {
    method: 'POST',
    body: JSON.stringify({ destinationId: destinationFolderId })
  })
}

export async function markAsRead(messageId: string): Promise<unknown> {
  return apiRequest(`/me/messages/${messageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ isRead: true })
  })
}

// === SEND (High Risk) ===

export async function sendMail(message: {
  subject: string
  body: { contentType: 'Text' | 'HTML'; content: string }
  toRecipients: Array<{ emailAddress: { address: string; name?: string } }>
  ccRecipients?: Array<{ emailAddress: { address: string; name?: string } }>
}): Promise<void> {
  await apiRequest('/me/sendMail', {
    method: 'POST',
    body: JSON.stringify({ message, saveToSentItems: true })
  })
}

export async function sendDraft(messageId: string): Promise<void> {
  await apiRequest(`/me/messages/${messageId}/send`, { method: 'POST' })
}

export async function replyToMessage(
  messageId: string,
  comment: string
): Promise<void> {
  await apiRequest(`/me/messages/${messageId}/reply`, {
    method: 'POST',
    body: JSON.stringify({ comment })
  })
}

// === DELETE (High Risk) ===

export async function deleteMessage(messageId: string): Promise<void> {
  await apiRequest(`/me/messages/${messageId}`, { method: 'DELETE' })
}

// === CONVENIENCE ===

export async function getUnreadMessages(maxResults: number = 10): Promise<unknown[]> {
  const result = await listMessages({
    filter: 'isRead eq false',
    top: maxResults,
    orderby: 'receivedDateTime desc',
    select: ['subject', 'from', 'receivedDateTime', 'isRead', 'bodyPreview']
  })
  return result.value || []
}

export async function getRecentMessages(maxResults: number = 10): Promise<unknown[]> {
  const result = await listMessages({
    top: maxResults,
    orderby: 'receivedDateTime desc',
    select: ['subject', 'from', 'receivedDateTime', 'isRead', 'bodyPreview']
  })
  return result.value || []
}
