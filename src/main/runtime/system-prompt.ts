/**
 * System prompt builder for the Attacca agent runtime.
 * Assembles identity traits + principles + timezone + CONTEXT.md into a compact prompt.
 * Target: ~800-1,000 tokens base, ~1,200-1,500 with 5 connected tools.
 */

import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

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
 * @param instructionTools — toolkits to inject behavioral instructions for.
 *   For `main` sessions using two-stage routing, pass the session's `loadedToolkits`
 *   so the prompt only grows as the agent expands its toolset. For workflow runs
 *   and other non-routed paths, pass the full connected-tools list.
 */
export function buildFullSystemPrompt(instructionTools?: string[]): string {
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

  // 4. Tool-specific behavioral instructions — only for toolkits currently in scope
  if (instructionTools && instructionTools.length > 0) {
    const toolInstructions = buildToolInstructions(instructionTools, tzOffset, tzName)
    if (toolInstructions) sections.push(toolInstructions)
  }

  // 5. Active default-account mapping (Spec B PR B3). Tells the agent which
  // account it will target by default for each toolkit, so its spoken reasoning
  // can stay aligned with the actual tool call (SCN-2.3, SCN-6.3 RO fix).
  const defaultsSection = buildDefaultAccountsSection()
  if (defaultsSection) sections.push(defaultsSection)

  // 6. CONTEXT.md (user context from KB)
  const ctx = loadContextMd()
  if (ctx) sections.push(`## User Context\n${ctx}`)

  return `You are a productivity assistant for a knowledge worker. Respond in the user's language.\n\n${sections.join('\n\n')}`
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
    const ctxPath = join(app.getPath('userData'), 'attacca-kb', 'memory', 'CONTEXT.md')
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

function buildDefaultAccountsSection(): string | null {
  try {
    // Dynamic require to avoid a hard dependency on Composio init for non-runtime callers
    const { getAllDefaults } = require('../composio/defaults') as typeof import('../composio/defaults')
    const { loadConnections } = require('../composio/connections') as typeof import('../composio/connections')
    const defaults = getAllDefaults()
    const entries = Object.entries(defaults)
    if (entries.length === 0) return null

    const labelByConnId = new Map<string, string>()
    for (const c of loadConnections()) {
      labelByConnId.set(c.connectionId, c.customName || c.label)
    }

    const lines = entries
      .map(([toolkit, connId]) => {
        const label = labelByConnId.get(connId) ?? connId.slice(0, 8)
        return `- ${toolkit}: ${label}`
      })
      .join('\n')

    return `## Default Accounts\nWhen calling tools without an explicit connectionId, you will use these defaults:\n${lines}\n\nIf the user asks you to use a different account ("send from my personal gmail"), pass the specific connectionId in the tool call. If your response mentions a specific account, make sure the tool call targets that same account.`
  } catch {
    return null
  }
}

function buildPrinciples(): string {
  return `## Principles
1. Only use connected tools. Never suggest connecting others unless the task requires it.
2. Read/summarize before creating/sending/modifying. Confirm patterns before treating as preferences.
3. One question at a time. Propose a default and confirm.
4. Use only the tools the current task needs. Start narrow, expand on request.
5. Risk: LOW (read/list) → proceed. MEDIUM (create/update) → notify. HIGH (send/delete) → block until explicit approval.
6. Never expose API names, error codes, or tool internals. Report results, not process.
7. Never silently fail or invent data. Say what failed and what you can still do.
8. Interpret meaning ("clear my afternoon" = reschedule, not delete). Confirm before medium/high-risk interpretation.`
}

function buildToolInstructions(tools: string[], tzOffset: string, tzName: string): string {
  const sections: string[] = []

  const has = (id: string): boolean => tools.some((t) => t.toLowerCase() === id)

  if (has('gmail')) {
    sections.push(
      `**Gmail**: Search, read, send, reply, draft emails. Use reply (not send) for thread replies. Always require approval before sending.`
    )
  }
  if (has('googlecalendar') || has('google-calendar')) {
    sections.push(
      `**Google Calendar**: List, search, create, update, delete events. Times must include offset ${tzOffset}. Always include timeZone="${tzName}". After successful create/update, stop — do not verify.`
    )
  }
  if (has('outlook')) {
    sections.push(
      `**Outlook**: List emails, send emails, list/create events. Title field is "subject" (not "summary"). Times must include offset ${tzOffset}.`
    )
  }
  if (has('slack')) {
    sections.push(`**Slack**: List channels, send messages. Require approval before sending.`)
  }
  if (has('trello')) {
    sections.push(`**Trello**: List boards/cards, update cards, comment, archive.`)
  }
  if (has('clickup')) {
    sections.push(
      `**ClickUp**: List workspaces/spaces/folders/tasks, create tasks/checklists. Flow: workspaces → spaces → folders → tasks.`
    )
  }
  if (has('asana')) {
    sections.push(`**Asana**: List tasks assigned to user.`)
  }
  if (has('notion')) {
    sections.push(`**Notion**: Search pages and databases.`)
  }
  if (has('googledrive') || has('google-drive')) {
    sections.push(
      `**Google Drive**: List, search, create folders, move/copy files. Confirm before moving multiple files.`
    )
  }
  if (has('onedrive') || has('one_drive')) {
    sections.push(
      `**OneDrive**: List, search, create folders, move items. Confirm before bulk operations.`
    )
  }
  if (has('dropbox')) {
    sections.push(
      `**Dropbox**: List, search, create folders, move files. Paths relative to root. Confirm before bulk.`
    )
  }

  if (sections.length === 0) return ''
  return `## Connected Tools\n${sections.join('\n')}`
}
