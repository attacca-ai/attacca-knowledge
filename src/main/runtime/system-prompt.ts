/**
 * System prompt builder for the Attacca agent runtime.
 * Assembles identity traits + principles + timezone + CONTEXT.md into a compact prompt.
 * Target: ~800-1,000 tokens base.
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { resolveVaultRoot, readVaultClaudeMd } from '../vault'

interface IdentityTrait {
  key: string
  value: string
  confidence: number
}

const MAX_CONTEXT_LINES = 150
const MAX_CONTEXT_BYTES = 4096

/**
 * Build the full system prompt for the main session.
 *
 * Phase 0 (Life OS pivot): external integrations removed. The prompt no longer
 * advertises connected toolkits or routing meta-tools.
 */
export function buildFullSystemPrompt(): string {
  const sections: string[] = []

  // 1. Identity traits from memory DB
  const identity = loadIdentityTraits()
  if (identity.length > 0) {
    const lines = identity.map((t) => `- ${t.key.replace(/_/g, ' ')}: ${t.value}`).join('\n')
    sections.push(`## About You\n${lines}`)
  }

  // 2. Principles (compressed, ~300 tokens)
  sections.push(buildPrinciples())

  // 3. Date and timezone
  const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone
  const tzOffsetMin = -new Date().getTimezoneOffset()
  const tzSign = tzOffsetMin >= 0 ? '+' : '-'
  const tzH = String(Math.floor(Math.abs(tzOffsetMin) / 60)).padStart(2, '0')
  const tzM = String(Math.abs(tzOffsetMin) % 60).padStart(2, '0')
  const tzOffset = `${tzSign}${tzH}:${tzM}`
  sections.push(
    `## Context\nToday: ${new Date().toISOString().slice(0, 10)}. Timezone: ${tzName} (UTC${tzOffset}). When the user says a time, it is local time — never convert to UTC.`
  )

  // 4. CONTEXT.md (user context from vault)
  const ctx = loadContextMd()
  if (ctx) sections.push(`## User Context\n${ctx}`)

  // 5. Vault CLAUDE.md (spec §6.6). Respected verbatim so founder's
  //    existing vault conventions apply to Attacca's agent automatically.
  const vaultClaude = readVaultClaudeMd()
  if (vaultClaude.trim()) sections.push(`## Vault Conventions (CLAUDE.md)\n${vaultClaude.trim()}`)

  return `You are a productivity assistant for a knowledge worker. Respond in the user's language.

${sections.join('\n\n')}`
}

/**
 * Build a slim system prompt for feature sessions.
 */
export function buildSlimSystemPrompt(featureInstructions?: string): string {
  const sections: string[] = []

  // Identity only (no principles, no tools, no CONTEXT.md)
  const identity = loadIdentityTraits()
  if (identity.length > 0) {
    const lines = identity.map((t) => `- ${t.key.replace(/_/g, ' ')}: ${t.value}`).join('\n')
    sections.push(`## About You\n${lines}`)
  }

  // Date
  sections.push(
    `Today: ${new Date().toISOString().slice(0, 10)}. Respond in the user's language.`
  )

  // Feature-specific instructions
  if (featureInstructions) {
    sections.push(featureInstructions)
  }

  return `You are a productivity assistant.\n\n${sections.join('\n\n')}`
}

function loadIdentityTraits(): IdentityTrait[] {
  try {
    // Dynamic require to avoid circular dependency with memory module init
    const { getIdentityTraits } = require('../memory/db') as typeof import('../memory/db')
    return getIdentityTraits(0.4)
  } catch {
    return []
  }
}

function loadContextMd(): string | null {
  try {
    const ctxPath = join(resolveVaultRoot(), 'memory', 'CONTEXT.md')
    if (!existsSync(ctxPath)) return null
    const content = readFileSync(ctxPath, 'utf-8').trim()
    if (!content) return null

    // Enforce 150-line / 4KB cap (trimming done in Phase 3, here we just truncate)
    const lines = content.split('\n')
    if (lines.length > MAX_CONTEXT_LINES || content.length > MAX_CONTEXT_BYTES) {
      return lines.slice(0, MAX_CONTEXT_LINES).join('\n').slice(0, MAX_CONTEXT_BYTES)
    }
    return content
  } catch {
    return null
  }
}

function buildPrinciples(): string {
  return `## Principles
1. Read/summarize before creating/modifying. Confirm patterns before treating as preferences.
2. One question at a time. Propose a default and confirm.
3. Never silently fail or invent data. Say what failed and what you can still do.
4. Interpret meaning ("clear my afternoon" = reschedule, not delete). Confirm before medium/high-risk interpretation.`
}
