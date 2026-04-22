import { describe, it, expect, beforeEach } from 'vitest'
import {
  createSession,
  getSession,
  getOrCreateSession,
  clearSession,
  listSessions,
  addMessageToSession,
  estimateTokens,
  gcFeatureSessions
} from '../sessions'

describe('sessions', () => {
  beforeEach(() => {
    // Clear all sessions before each test
    for (const s of listSessions()) {
      clearSession(s.key)
    }
  })

  it('creates and retrieves a session', () => {
    const session = createSession('test-main', 'main')
    expect(session.key).toBe('test-main')
    expect(session.type).toBe('main')
    expect(session.messages).toEqual([])

    const retrieved = getSession('test-main')
    expect(retrieved).toBe(session)
  })

  it('getOrCreateSession returns existing session', () => {
    const first = createSession('test-key', 'feature')
    const second = getOrCreateSession('test-key', 'feature')
    expect(second).toBe(first)
  })

  it('getOrCreateSession creates if missing', () => {
    const session = getOrCreateSession('new-key', 'feature', 'Custom instructions')
    expect(session.key).toBe('new-key')
    expect(session.featureInstructions).toBe('Custom instructions')
  })

  it('clears a session', () => {
    createSession('to-clear', 'main')
    clearSession('to-clear')
    expect(getSession('to-clear')).toBeUndefined()
  })

  it('lists all sessions', () => {
    createSession('s1', 'main')
    createSession('s2', 'feature')
    const list = listSessions()
    expect(list).toHaveLength(2)
    expect(list.map((s) => s.key).sort()).toEqual(['s1', 's2'])
  })

  it('adds messages to session', () => {
    createSession('msg-test', 'main')
    addMessageToSession('msg-test', { role: 'user', content: 'Hello' })
    addMessageToSession('msg-test', { role: 'assistant', content: 'Hi there!' })
    const session = getSession('msg-test')!
    expect(session.messages).toHaveLength(2)
    expect(session.messages[0]).toEqual({ role: 'user', content: 'Hello' })
  })

  it('does nothing when adding to non-existent session', () => {
    addMessageToSession('missing', { role: 'user', content: 'test' })
    expect(getSession('missing')).toBeUndefined()
  })

  it('estimates tokens using char/4 heuristic', () => {
    const messages = [
      { role: 'user' as const, content: 'Hello world' }, // 11 chars
      { role: 'assistant' as const, content: 'Hi!' } // 3 chars
    ]
    const estimate = estimateTokens(messages)
    // (11 + 3) / 4 = 3.5 → ceil → 4
    expect(estimate).toBe(4)
  })

  it('estimates tokens for array content blocks', () => {
    const messages = [
      {
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'Hello world with blocks' }]
      }
    ]
    const estimate = estimateTokens(messages)
    expect(estimate).toBe(Math.ceil(23 / 4))
  })

  it('garbage-collects old feature sessions', () => {
    const s1 = createSession('main-session', 'main')
    const s2 = createSession('feature-old', 'feature')
    createSession('feature-new', 'feature')

    // Make the old feature session appear old
    s2.createdAt = Date.now() - 60 * 60 * 1000 // 1 hour ago
    s1.createdAt = Date.now() - 60 * 60 * 1000 // 1 hour ago (but main, not gc'd)

    const removed = gcFeatureSessions(30 * 60 * 1000) // 30 min threshold
    expect(removed).toBe(1)
    expect(getSession('main-session')).toBeDefined() // Main session preserved
    expect(getSession('feature-old')).toBeUndefined() // Old feature removed
    expect(getSession('feature-new')).toBeDefined() // Recent feature preserved
  })
})
