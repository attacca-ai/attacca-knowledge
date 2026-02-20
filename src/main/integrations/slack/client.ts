import { net } from 'electron'
import { getTokens } from '../../oauth/token-store'

const BASE_URL = 'https://slack.com/api'

async function getValidToken(): Promise<string> {
  const tokens = getTokens('slack')
  if (!tokens) throw new Error('Slack not connected')
  // Slack user tokens (xoxp-...) don't expire — no refresh needed
  return tokens.access_token
}

async function apiRequest(
  method: string,
  params: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const token = await getValidToken()

  const response = await net.fetch(`${BASE_URL}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(params)
  })

  const data = (await response.json()) as Record<string, unknown>

  if (!data.ok) {
    const needed = data.needed ? ` — missing scope: ${data.needed}` : ''
    throw new Error(`Slack API error (${method}): ${data.error}${needed}`)
  }

  return data
}

// === READ (Low Risk) ===

export async function listChannels(
  types: string = 'public_channel,private_channel'
): Promise<unknown[]> {
  const result = await apiRequest('conversations.list', {
    types,
    limit: 200,
    exclude_archived: true
  })
  return (result.channels as unknown[]) || []
}

export async function getChannelHistory(
  channelId: string,
  limit: number = 20
): Promise<unknown[]> {
  const result = await apiRequest('conversations.history', { channel: channelId, limit })
  return (result.messages as unknown[]) || []
}

export async function getThreadReplies(
  channelId: string,
  threadTs: string
): Promise<unknown[]> {
  const result = await apiRequest('conversations.replies', {
    channel: channelId,
    ts: threadTs
  })
  return (result.messages as unknown[]) || []
}

export async function searchMessages(
  query: string,
  count: number = 20
): Promise<Record<string, unknown>> {
  return apiRequest('search.messages', { query, count })
}

export async function getUserInfo(userId: string): Promise<unknown> {
  const result = await apiRequest('users.info', { user: userId })
  return result.user
}

export async function listUsers(): Promise<unknown[]> {
  const result = await apiRequest('users.list', { limit: 200 })
  return (result.members as unknown[]) || []
}

export async function getMyProfile(): Promise<unknown> {
  const result = await apiRequest('users.profile.get')
  return result.profile
}

// === WRITE — Mid Risk ===

export async function setStatus(
  statusText: string,
  statusEmoji: string = '',
  expirationMinutes?: number
): Promise<Record<string, unknown>> {
  const profile: Record<string, unknown> = {
    status_text: statusText,
    status_emoji: statusEmoji
  }
  if (expirationMinutes) {
    profile.status_expiration = Math.floor(Date.now() / 1000) + expirationMinutes * 60
  }
  return apiRequest('users.profile.set', { profile })
}

export async function addReaction(
  channelId: string,
  messageTs: string,
  emoji: string
): Promise<Record<string, unknown>> {
  return apiRequest('reactions.add', {
    channel: channelId,
    timestamp: messageTs,
    name: emoji
  })
}

// === WRITE — High Risk (requires approval) ===

export async function postMessage(
  channelId: string,
  text: string,
  options: {
    thread_ts?: string
    blocks?: unknown[]
    unfurl_links?: boolean
  } = {}
): Promise<Record<string, unknown>> {
  return apiRequest('chat.postMessage', {
    channel: channelId,
    text,
    ...options
  })
}

export async function sendDirectMessage(
  userId: string,
  text: string
): Promise<Record<string, unknown>> {
  // Open a DM channel first
  const dm = (await apiRequest('conversations.open', { users: userId })) as {
    channel: { id: string }
  }
  return postMessage(dm.channel.id, text)
}

export async function updateMessage(
  channelId: string,
  messageTs: string,
  text: string
): Promise<Record<string, unknown>> {
  return apiRequest('chat.update', { channel: channelId, ts: messageTs, text })
}

export async function deleteMessage(
  channelId: string,
  messageTs: string
): Promise<Record<string, unknown>> {
  return apiRequest('chat.delete', { channel: channelId, ts: messageTs })
}

// === CONVENIENCE ===

export async function getRecentDMs(
  limit: number = 5
): Promise<Array<{ channel: unknown; messages: unknown[] }>> {
  const channels = await apiRequest('conversations.list', { types: 'im', limit })
  const results: Array<{ channel: unknown; messages: unknown[] }> = []
  const channelList = ((channels.channels as unknown[]) || []).slice(0, limit)
  for (const ch of channelList) {
    const msgs = await getChannelHistory((ch as { id: string }).id, 5)
    results.push({ channel: ch, messages: msgs })
  }
  return results
}

export async function findChannelByName(name: string): Promise<unknown | null> {
  const channels = await listChannels()
  return (
    channels.find(
      (c) =>
        (c as { name: string }).name === name ||
        (c as { name: string }).name === name.replace('#', '')
    ) || null
  )
}

export async function findUserByName(name: string): Promise<unknown | null> {
  const users = await listUsers()
  const lower = name.toLowerCase()
  return (
    users.find(
      (u) =>
        ((u as { real_name?: string }).real_name || '').toLowerCase().includes(lower) ||
        ((u as { name?: string }).name || '').toLowerCase().includes(lower)
    ) || null
  )
}
