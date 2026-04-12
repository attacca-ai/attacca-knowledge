/**
 * Session management for the Attacca agent runtime.
 * Sessions hold conversation history in memory (no persistence for v1).
 */

import type Anthropic from '@anthropic-ai/sdk'

export type SessionType = 'main' | 'feature'

export interface Session {
  key: string
  type: SessionType
  messages: Anthropic.MessageParam[]
  createdAt: number
  /** Feature-specific instructions appended to slim system prompt */
  featureInstructions?: string
  /**
   * Toolkits the agent has explicitly loaded via the `load_toolkit` meta-tool.
   * Only used for `main`-type sessions. Persists for the lifetime of the session;
   * cleared on session reset or app restart.
   */
  loadedToolkits: Set<string>
}

export interface SessionInfo {
  key: string
  type: SessionType
  messageCount: number
  createdAt: number
}

const sessions = new Map<string, Session>()

export function createSession(
  key: string,
  type: SessionType,
  featureInstructions?: string
): Session {
  const session: Session = {
    key,
    type,
    messages: [],
    createdAt: Date.now(),
    featureInstructions,
    loadedToolkits: new Set<string>()
  }
  sessions.set(key, session)
  return session
}

/**
 * Mark a toolkit as loaded for the session. Used by the `load_toolkit` meta-tool.
 * Returns `true` if newly loaded, `false` if it was already loaded.
 */
export function markToolkitLoaded(sessionKey: string, toolkitSlug: string): boolean {
  const session = sessions.get(sessionKey)
  if (!session) return false
  if (session.loadedToolkits.has(toolkitSlug)) return false
  session.loadedToolkits.add(toolkitSlug)
  return true
}

export function getLoadedToolkits(sessionKey: string): string[] {
  const session = sessions.get(sessionKey)
  return session ? Array.from(session.loadedToolkits) : []
}

export function getSession(key: string): Session | undefined {
  return sessions.get(key)
}

export function getOrCreateSession(
  key: string,
  type: SessionType,
  featureInstructions?: string
): Session {
  const existing = sessions.get(key)
  if (existing) return existing
  return createSession(key, type, featureInstructions)
}

export function clearSession(key: string): void {
  sessions.delete(key)
}

export function listSessions(): SessionInfo[] {
  return Array.from(sessions.values()).map((s) => ({
    key: s.key,
    type: s.type,
    messageCount: s.messages.length,
    createdAt: s.createdAt
  }))
}

export function addMessageToSession(
  key: string,
  message: Anthropic.MessageParam
): void {
  const session = sessions.get(key)
  if (!session) return
  session.messages.push(message)
}

export function replaceSessionMessages(
  key: string,
  messages: Anthropic.MessageParam[]
): void {
  const session = sessions.get(key)
  if (!session) return
  session.messages = messages
}

/** Estimate token count using char/4 heuristic */
export function estimateTokens(messages: Anthropic.MessageParam[]): number {
  let chars = 0
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      chars += msg.content.length
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if ('text' in block) chars += block.text.length
        else if ('content' in block && typeof block.content === 'string')
          chars += block.content.length
      }
    }
  }
  return Math.ceil(chars / 4)
}

/** Garbage-collect feature sessions that have been inactive */
export function gcFeatureSessions(olderThanMs = 30 * 60 * 1000): number {
  const cutoff = Date.now() - olderThanMs
  let removed = 0
  for (const [key, session] of sessions) {
    if (session.type === 'feature' && session.createdAt < cutoff) {
      sessions.delete(key)
      removed++
    }
  }
  return removed
}
