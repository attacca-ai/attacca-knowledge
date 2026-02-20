import { net } from 'electron'
import { getValidToken, refreshAccessToken } from '../../oauth/oauth-manager'

const BASE_URL = 'https://www.googleapis.com/gmail/v1'

async function apiRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
  const tokens = await getValidToken('gmail')
  const url = `${BASE_URL}${endpoint}`
  const response = await net.fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>)
    }
  })

  if (response.status === 401) {
    const refreshed = await refreshAccessToken('gmail')
    const retry = await net.fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${refreshed.access_token}`,
        'Content-Type': 'application/json'
      }
    })
    if (!retry.ok) throw new Error(`Gmail API error: ${retry.status}`)
    return retry.json()
  }

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Gmail API error (${response.status}): ${text}`)
  }
  if (response.status === 204) return null
  return response.json()
}

// === READ (Low Risk) ===

export async function listMessages(
  options: {
    q?: string
    maxResults?: number
    labelIds?: string[]
    pageToken?: string
  } = {}
): Promise<any> {
  const params = new URLSearchParams()
  if (options.q) params.set('q', options.q)
  if (options.maxResults) params.set('maxResults', String(options.maxResults))
  if (options.labelIds) params.set('labelIds', options.labelIds.join(','))
  if (options.pageToken) params.set('pageToken', options.pageToken)

  return apiRequest(`/users/me/messages?${params}`)
}

export async function getMessage(
  messageId: string,
  format: 'full' | 'metadata' | 'minimal' = 'full'
): Promise<any> {
  return apiRequest(`/users/me/messages/${messageId}?format=${format}`)
}

export async function getThread(threadId: string): Promise<any> {
  return apiRequest(`/users/me/threads/${threadId}`)
}

export async function listLabels(): Promise<any> {
  return apiRequest('/users/me/labels')
}

export async function getProfile(): Promise<any> {
  return apiRequest('/users/me/profile')
}

// === WRITE (Mid Risk) ===

export async function createDraft(
  to: string,
  subject: string,
  body: string,
  cc?: string,
  bcc?: string
): Promise<any> {
  const raw = buildRawEmail({ to, subject, body, cc, bcc })
  return apiRequest('/users/me/drafts', {
    method: 'POST',
    body: JSON.stringify({ message: { raw } })
  })
}

export async function modifyLabels(
  messageId: string,
  addLabels: string[],
  removeLabels: string[]
): Promise<any> {
  return apiRequest(`/users/me/messages/${messageId}/modify`, {
    method: 'POST',
    body: JSON.stringify({ addLabelIds: addLabels, removeLabelIds: removeLabels })
  })
}

export async function archiveMessage(messageId: string): Promise<any> {
  return modifyLabels(messageId, [], ['INBOX'])
}

export async function markAsRead(messageId: string): Promise<any> {
  return modifyLabels(messageId, [], ['UNREAD'])
}

// === SEND (High Risk) ===

export async function sendEmail(
  to: string,
  subject: string,
  body: string,
  cc?: string,
  bcc?: string
): Promise<any> {
  const raw = buildRawEmail({ to, subject, body, cc, bcc })
  return apiRequest('/users/me/messages/send', {
    method: 'POST',
    body: JSON.stringify({ raw })
  })
}

export async function sendDraft(draftId: string): Promise<any> {
  return apiRequest('/users/me/drafts/send', {
    method: 'POST',
    body: JSON.stringify({ id: draftId })
  })
}

// === DELETE (High Risk) ===

export async function trashMessage(messageId: string): Promise<any> {
  return apiRequest(`/users/me/messages/${messageId}/trash`, { method: 'POST' })
}

// === HELPER ===

export function buildRawEmail(opts: {
  to: string
  subject: string
  body: string
  cc?: string
  bcc?: string
}): string {
  const lines = [
    `To: ${opts.to}`,
    opts.cc ? `Cc: ${opts.cc}` : '',
    opts.bcc ? `Bcc: ${opts.bcc}` : '',
    `Subject: ${opts.subject}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    '',
    opts.body
  ].filter(Boolean)

  return Buffer.from(lines.join('\r\n')).toString('base64url')
}

// === CONVENIENCE ===

export async function getUnreadCount(): Promise<number> {
  const result = await listMessages({ q: 'is:unread', maxResults: 1 })
  return result.resultSizeEstimate || 0
}

export async function getRecentEmails(maxResults: number = 10): Promise<any[]> {
  const list = await listMessages({ maxResults })
  if (!list.messages) return []

  const emails = await Promise.all(
    list.messages.map((m: any) => getMessage(m.id, 'metadata'))
  )
  return emails
}

export function extractHeaders(message: any): Record<string, string> {
  const headers: Record<string, string> = {}
  if (message.payload?.headers) {
    for (const h of message.payload.headers) {
      headers[h.name.toLowerCase()] = h.value
    }
  }
  return headers
}
