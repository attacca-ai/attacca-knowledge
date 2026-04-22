/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockExistsSync, mockReadFileSync, mockGetIdentityTraits } = vi.hoisted(() => ({
  mockExistsSync: vi.fn().mockReturnValue(false),
  mockReadFileSync: vi.fn().mockReturnValue(''),
  mockGetIdentityTraits: vi.fn().mockReturnValue([])
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/mock/userData') }
}))

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, existsSync: mockExistsSync, readFileSync: mockReadFileSync }
})

vi.mock('../../memory/db', () => ({
  getIdentityTraits: mockGetIdentityTraits
}))

import { buildFullSystemPrompt, buildSlimSystemPrompt } from '../system-prompt'

describe('system-prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('buildFullSystemPrompt', () => {
    it('builds a base prompt under 1000 tokens with no context', () => {
      const prompt = buildFullSystemPrompt()
      // Estimate tokens: chars / 4
      const estimatedTokens = Math.ceil(prompt.length / 4)
      expect(estimatedTokens).toBeLessThan(1000)
      expect(prompt).toContain('productivity assistant')
      expect(prompt).toContain('Principles')
    })

    it('omits About You section when identity traits are empty', () => {
      // Dynamic require mocking is unreliable in vitest for this pattern.
      // When traits are empty (mock default), the section is omitted.
      const prompt = buildFullSystemPrompt()
      expect(prompt).not.toContain('## About You')
    })

    it('includes CONTEXT.md when present and under cap', () => {
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('## Recent Captures\n- Meeting notes from today')

      const prompt = buildFullSystemPrompt()
      expect(prompt).toContain('Recent Captures')
      expect(prompt).toContain('Meeting notes from today')
    })

    it('truncates CONTEXT.md when over 150 lines', () => {
      mockExistsSync.mockReturnValue(true)
      const longContent = Array.from({ length: 200 }, (_, i) => `Line ${i}`).join('\n')
      mockReadFileSync.mockReturnValue(longContent)

      const prompt = buildFullSystemPrompt()
      // Should only have first 150 lines
      expect(prompt).toContain('Line 0')
      expect(prompt).toContain('Line 149')
      expect(prompt).not.toContain('Line 199')
    })

    it('includes tool instructions for connected tools', () => {
      const prompt = buildFullSystemPrompt(['gmail', 'googlecalendar', 'slack'])
      expect(prompt).toContain('Gmail')
      expect(prompt).toContain('Google Calendar')
      expect(prompt).toContain('Slack')
      expect(prompt).not.toContain('Trello')
    })

    it('stays under 2000 tokens with 5 connected tools', () => {
      mockGetIdentityTraits.mockReturnValue([
        { key: 'role', value: 'Product Manager', confidence: 0.9, evidence: '[]', updated_at: Date.now() }
      ])
      mockExistsSync.mockReturnValue(true)
      mockReadFileSync.mockReturnValue('## Context\nSome brief user context here.')

      const prompt = buildFullSystemPrompt([
        'gmail',
        'googlecalendar',
        'slack',
        'trello',
        'clickup'
      ])
      const estimatedTokens = Math.ceil(prompt.length / 4)
      expect(estimatedTokens).toBeLessThan(2000)
    })
  })

  describe('buildSlimSystemPrompt', () => {
    it('builds a slim prompt under 600 tokens', () => {
      const prompt = buildSlimSystemPrompt('Process this capture and extract key information.')
      const estimatedTokens = Math.ceil(prompt.length / 4)
      expect(estimatedTokens).toBeLessThan(600)
      expect(prompt).toContain('Process this capture')
    })

    it('does not include principles or tools', () => {
      const prompt = buildSlimSystemPrompt('Test instructions')
      expect(prompt).not.toContain('Principles')
      expect(prompt).not.toContain('Connected Tools')
      expect(prompt).toContain('Test instructions')
    })
  })
})
