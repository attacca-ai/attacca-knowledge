import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createHash } from 'crypto'
import { app } from 'electron'

const OPENCLAW_DIR = join(homedir(), '.openclaw')
const CONFIG_PATH = join(OPENCLAW_DIR, 'openclaw.json')

export interface OpenClawConfig {
  gateway: {
    port: number
    mode?: string
    auth?: {
      mode?: string
      token?: string
    }
    controlUi?: {
      dangerouslyDisableDeviceAuth?: boolean
      allowedOrigins?: string[]
    }
  }
  llm?: {
    provider: 'anthropic' | 'openai' | 'google'
    model: string
    apiKey: string
  }
  tools?: {
    exec?: {
      host?: string
    }
  }
  workspace?: string
}

const DEFAULT_CONFIG: OpenClawConfig = {
  gateway: {
    port: 18789,
    mode: 'local'
  }
}

export function ensureConfig(): OpenClawConfig {
  if (!existsSync(OPENCLAW_DIR)) {
    mkdirSync(OPENCLAW_DIR, { recursive: true })
  }

  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8')
    return DEFAULT_CONFIG
  }

  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    return JSON.parse(raw) as OpenClawConfig
  } catch {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8')
    return DEFAULT_CONFIG
  }
}

export function readConfig(): OpenClawConfig {
  if (!existsSync(CONFIG_PATH)) {
    return ensureConfig()
  }
  const raw = readFileSync(CONFIG_PATH, 'utf-8')
  return JSON.parse(raw) as OpenClawConfig
}

export function writeConfig(config: OpenClawConfig): void {
  if (!existsSync(OPENCLAW_DIR)) {
    mkdirSync(OPENCLAW_DIR, { recursive: true })
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}

export function getGatewayUrl(): string {
  const config = readConfig()
  return `ws://127.0.0.1:${config.gateway.port}`
}

export function getGatewayToken(): string | null {
  const config = readConfig()
  return config.gateway.auth?.token ?? null
}

/**
 * Writes the LLM API key to the default agent's auth-profiles.json so
 * OpenClaw can find it without needing an environment variable.
 * Format: { profiles: { "attacca-<provider>": { provider, type, key } } }
 */
export function writeAgentAuthProfiles(provider: string, apiKey: string): void {
  const agentDir = join(OPENCLAW_DIR, 'agents', 'main', 'agent')
  const authProfilesPath = join(agentDir, 'auth-profiles.json')

  if (!existsSync(agentDir)) {
    mkdirSync(agentDir, { recursive: true })
  }

  // Preserve existing profiles, update or add ours
  let existing: Record<string, unknown> = { profiles: {} }
  if (existsSync(authProfilesPath)) {
    try {
      existing = JSON.parse(readFileSync(authProfilesPath, 'utf-8'))
    } catch {
      existing = { profiles: {} }
    }
  }

  const profiles = (existing.profiles ?? {}) as Record<string, unknown>
  profiles[`attacca-${provider}`] = { provider, type: 'api_key', key: apiKey }
  existing.profiles = profiles

  writeFileSync(authProfilesPath, JSON.stringify(existing, null, 2), 'utf-8')
}

/**
 * Ensures the openclaw.json config has the controlUi bypass flag set.
 * This allows the renderer to connect as the Control UI client without
 * device-level authentication, while still requiring the auth token.
 */
export function ensureControlUiConfig(): void {
  const config = ensureConfig()
  if (config.gateway.controlUi?.dangerouslyDisableDeviceAuth === true) return

  config.gateway.controlUi = {
    ...config.gateway.controlUi,
    dangerouslyDisableDeviceAuth: true
  }
  writeConfig(config)
}

const RELAY_SERVICE_TOKEN = 'attacca-relay-service'
const RELAY_PORT = 3100
const RELAY_MODEL_ID = 'claude-sonnet-4-6'

/**
 * Writes the OpenClaw models.providers config so the gateway routes LLM calls
 * through the local relay's Anthropic-compatible proxy by default.
 *
 * - No BYOK: uses the "attacca-relay" custom provider → relay's own API key
 * - BYOK configured: uses the built-in provider directly (lifecycle.ts injects env var)
 *
 * Reads and rewrites the full openclaw.json to preserve OpenClaw-managed fields
 * (commands, meta, agents.defaults.compaction, etc.).
 */
export function ensureRelayProviderConfig(
  byokConfig?: { provider: string; model: string } | null,
  licenseKey?: string | null
): void {
  let rawConfig: Record<string, unknown> = {}
  if (existsSync(CONFIG_PATH)) {
    try {
      rawConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
    } catch {
      rawConfig = {}
    }
  }

  // Compute per-user base URL so the relay can track usage per license key.
  // A licenseKey is always expected in production (app is behind the license gate).
  const keyHash = licenseKey
    ? createHash('sha256').update(licenseKey).digest('hex')
    : null
  const relayBaseUrl = keyHash
    ? `http://localhost:${RELAY_PORT}/anthropic/u/${keyHash}`
    : `http://localhost:${RELAY_PORT}/anthropic/u/unlicensed` // fallback returns 401

  // Register the relay provider (always present so it can be switched to at runtime)
  const models = (rawConfig.models ?? {}) as Record<string, unknown>
  models.mode = 'merge'
  const providers = (models.providers ?? {}) as Record<string, unknown>
  providers['attacca-relay'] = {
    baseUrl: relayBaseUrl,
    apiKey: RELAY_SERVICE_TOKEN,
    api: 'anthropic-messages',
    models: [
      {
        id: RELAY_MODEL_ID,
        name: 'Claude Sonnet (Attacca)',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0 },
        contextWindow: 200000,
        maxTokens: 8192
      }
    ]
  }
  models.providers = providers
  rawConfig.models = models

  // Allow skill-driven tool execution in the OpenClaw sandbox host.
  const tools = (rawConfig.tools ?? {}) as Record<string, unknown>
  const exec = (tools.exec ?? {}) as Record<string, unknown>
  exec.host = 'sandbox'
  tools.exec = exec
  rawConfig.tools = tools

  // Set default model: BYOK → built-in provider; default → relay proxy
  const agents = (rawConfig.agents ?? {}) as Record<string, unknown>
  const defaults = (agents.defaults ?? {}) as Record<string, unknown>
  if (byokConfig) {
    defaults.model = { primary: `${byokConfig.provider}/${byokConfig.model}` }
  } else {
    defaults.model = { primary: `attacca-relay/${RELAY_MODEL_ID}` }
  }
  agents.defaults = defaults
  rawConfig.agents = agents

  if (!existsSync(OPENCLAW_DIR)) {
    mkdirSync(OPENCLAW_DIR, { recursive: true })
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(rawConfig, null, 2), 'utf-8')
}

export function getConfigPath(): string {
  return CONFIG_PATH
}

export function getOpenClawDir(): string {
  return OPENCLAW_DIR
}

const RELAY_PORT_FOR_SKILL = 3100
const SKILL_DIR = join(OPENCLAW_DIR, 'workspace', 'skills', 'attacca-tools')
const SESSIONS_JSON = join(OPENCLAW_DIR, 'agents', 'main', 'sessions', 'sessions.json')

/**
 * Clears the cached skillsSnapshot from the persisted sessions.json so
 * OpenClaw rebuilds the skills prompt on the next agent turn.
 * This must be called whenever the skill content changes (e.g. on every startup)
 * so stale snapshots never block new skills from being seen by the agent.
 */
export function clearSessionSkillsSnapshot(): void {
  if (!existsSync(SESSIONS_JSON)) return
  try {
    const raw = readFileSync(SESSIONS_JSON, 'utf-8')
    const data = JSON.parse(raw) as Record<string, Record<string, unknown>>
    let changed = false
    for (const key of Object.keys(data)) {
      if ('skillsSnapshot' in data[key] || 'systemPromptReport' in data[key]) {
        delete data[key].skillsSnapshot
        delete data[key].systemPromptReport
        changed = true
      }
    }
    if (changed) {
      writeFileSync(SESSIONS_JSON, JSON.stringify(data, null, 2), 'utf-8')
    }
  } catch {
    // Not critical — gateway will just rebuild the snapshot anyway
  }
}

/**
 * Writes a custom OpenClaw workspace skill that lets the agent call Composio
 * tool actions (Gmail, Google Calendar, Slack, etc.) via the local relay.
 *
 * The entityId is derived from the license key using the same hash chain as
 * the relay server, so it matches the user's Composio OAuth connections.
 * The skill is re-written on every gateway start so it stays current.
 */
export function ensureComposioSkill(licenseKey: string, connectedTools?: string[]): void {
  const keyHash = createHash('sha256').update(licenseKey).digest('hex')
  const entityId = createHash('sha256').update(`composio:${keyHash}`).digest('hex').slice(0, 32)

  if (!existsSync(SKILL_DIR)) {
    mkdirSync(SKILL_DIR, { recursive: true })
  }

  // Write the Node.js helper first so the skill can reference it
  writeFileSync(join(SKILL_DIR, 'call-tool.cjs'), buildCallToolScript(entityId), 'utf-8')
  writeFileSync(join(SKILL_DIR, 'memory-search.cjs'), buildMemorySearchScript(), 'utf-8')
  writeFileSync(join(SKILL_DIR, 'SKILL.md'), buildSkillContent(connectedTools ?? []), 'utf-8')
}

/**
 * Generates a portable Node.js CJS script that calls the relay agent endpoint.
 * Using node instead of curl avoids Windows cmd.exe single-quote quoting issues.
 * The entityId is baked in at generation time.
 */
function buildCallToolScript(entityId: string): string {
  return `'use strict'
var ACTION_NAME = process.argv[2]
var paramsArg = process.argv[3]
var ENTITY_ID = ${JSON.stringify(entityId)}

function run(params) {
  fetch('http://localhost:${RELAY_PORT_FOR_SKILL}/agent/tools', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'attacca-relay-service' },
    body: JSON.stringify({ actionName: ACTION_NAME, entityId: ENTITY_ID, params: params })
  })
    .then(function(r) { return r.json() })
    .then(function(data) { process.stdout.write(JSON.stringify(data) + '\\n') })
    .catch(function(err) { process.stdout.write(JSON.stringify({ success: false, error: err.message }) + '\\n') })
}

// Try argv first; if JSON parse fails (PowerShell strips quotes), read from stdin.
// If no argv params, read from stdin (piped via echo) unless stdin is a TTY.
function readStdinAndRun() {
  var chunks = []
  process.stdin.on('data', function(d) { chunks.push(d) })
  process.stdin.on('end', function() {
    var str = Buffer.concat(chunks).toString().trim()
    try { run(str ? JSON.parse(str) : {}) } catch (_) { run({}) }
  })
  process.stdin.on('error', function() { run({}) })
}
if (paramsArg) {
  try { run(JSON.parse(paramsArg)) } catch (_) { readStdinAndRun() }
} else if (process.stdin.isTTY) {
  run({})
} else {
  readStdinAndRun()
}
`
}

/**
 * Generates a portable Node.js CJS script that calls the local memory server.
 * The port is discovered at runtime by reading the port file written by the memory server.
 * Falls back to port 3101 if the file doesn't exist.
 */
function buildMemorySearchScript(): string {
  return `'use strict'
var ACTION = process.argv[2] // SEARCH or SAVE
var MEMORY_PORT = 3101

// Try to discover the actual port (future: written by memory server)
// For now, use the default port which the server binds to.

function run(params) {
  var endpoint = ACTION === 'SAVE' ? '/save' : '/search'
  fetch('http://127.0.0.1:' + MEMORY_PORT + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
    .then(function(r) { return r.json() })
    .then(function(data) { process.stdout.write(JSON.stringify(data) + '\\n') })
    .catch(function(err) { process.stdout.write(JSON.stringify({ success: false, error: err.message }) + '\\n') })
}

function readStdinAndRun() {
  var chunks = []
  process.stdin.on('data', function(d) { chunks.push(d) })
  process.stdin.on('end', function() {
    var str = Buffer.concat(chunks).toString().trim()
    try { run(str ? JSON.parse(str) : {}) } catch (_) { run({}) }
  })
  process.stdin.on('error', function() { run({}) })
}

var paramsArg = process.argv[3]
if (paramsArg) {
  try { run(JSON.parse(paramsArg)) } catch (_) { readStdinAndRun() }
} else if (process.stdin.isTTY) {
  run({})
} else {
  readStdinAndRun()
}
`
}

function readKbContext(): string {
  const sections: string[] = []

  // Tier 1: Identity traits from memory DB (compact, high-value)
  try {
    const { getIdentityTraits } = require('../memory/db') as typeof import('../memory/db')
    const traits = getIdentityTraits(0.4)
    if (traits.length > 0) {
      const traitLines = traits.map(t => `- **${t.key.replace(/_/g, ' ')}**: ${t.value}`).join('\n')
      sections.push(`## About This User\n\n${traitLines}`)
    }
  } catch {
    // Memory DB not initialized yet — skip
  }

  // Tier 2: CONTEXT.md (captures, projects, people — kept for backward compat)
  try {
    const ctxPath = join(app.getPath('userData'), 'attacca-kb', 'memory', 'CONTEXT.md')
    if (existsSync(ctxPath)) {
      const ctx = readFileSync(ctxPath, 'utf-8').trim()
      if (ctx) sections.push(ctx)
    }
  } catch {
    // ignore — KB context is optional
  }

  if (sections.length === 0) return ''
  return sections.join('\n\n') + '\n\n---\n\n'
}

function buildSkillContent(connectedTools: string[]): string {
  const kbContext = readKbContext()
  const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone
  const tzOffsetMin = -new Date().getTimezoneOffset()
  const tzSign = tzOffsetMin >= 0 ? '+' : '-'
  const tzH = String(Math.floor(Math.abs(tzOffsetMin) / 60)).padStart(2, '0')
  const tzM = String(Math.abs(tzOffsetMin) % 60).padStart(2, '0')
  const tzOffset = `${tzSign}${tzH}:${tzM}`
  const scriptPath = join(SKILL_DIR, 'call-tool.cjs').replace(/\\/g, '/')
  const call = (action: string, paramsJson: string) =>
    `echo '${paramsJson}' | node "${scriptPath}" ${action}`

  // Normalize connected tool IDs for matching
  const has = (id: string): boolean => connectedTools.some(t => t.toLowerCase() === id)
  const hasGmail = has('gmail')
  const hasGcal = has('googlecalendar')
  const hasOutlook = has('outlook')
  const hasSlack = has('slack')
  const hasTrello = has('trello')
  const hasClickup = has('clickup')
  const hasAsana = has('asana')
  const hasNotion = has('notion')
  const hasAnyTool = connectedTools.length > 0

  // Build list of active tool names for the description
  const activeNames = [
    hasGmail && 'Gmail', hasGcal && 'Google Calendar',
    hasOutlook && 'Outlook', hasSlack && 'Slack',
    hasTrello && 'Trello', hasClickup && 'ClickUp',
    hasAsana && 'Asana', hasNotion && 'Notion'
  ].filter(Boolean)
  const toolList = activeNames.length > 0 ? activeNames.join(', ') : 'productivity tools (none currently connected)'

  // Determine if both email providers or both calendar providers are active
  const hasBothEmail = hasGmail && hasOutlook
  const hasBothCal = hasGcal && hasOutlook

  // --- Compressed Principles ---
  const principles = `## Principles

1. **Zero Trust** — Only use connected tools. Never suggest connecting others unless the task requires it.
2. **Observe first** — Read/summarize before creating/sending/modifying. Confirm patterns before treating them as preferences.
3. **One question at a time** — Propose a default and confirm: "I'll schedule 30 min at 2 PM. Sound good?"
4. **Minimal scope** — Use only the tools the current task needs. Start narrow, expand on request.
5. **Risk classification** — LOW (read/list/draft): proceed. MEDIUM (create/update): notify + undo option. HIGH (send/delete/post): **block until explicit approval**.
   - **Always require approval**: sending any communication, deleting anything, modifying shared resources, first-time actions.
6. **Plain language** — Never expose API names, error codes, or tool internals. Report results, not process.
7. **Graceful degradation** — Never silently fail or invent data. Say what failed and what you can still do.
8. **Intent over words** — Interpret meaning ("clear my afternoon" = reschedule, not delete). Confirm before medium/high-risk interpretation. One step at a time — never cascade without confirmation.${hasBothEmail || hasBothCal ? `
9. **Tool loyalty** — ${hasBothEmail ? 'If context references Outlook → use only Outlook tools; if Gmail → only Gmail. If ambiguous → ask.' : ''}${hasBothCal ? ' Same for Google Calendar vs Outlook Calendar.' : ''} Never cross-reply (e.g., reply to Outlook email via Gmail).` : ''}
10. **Timezone** — User timezone: \`${tzName}\` (UTC${tzOffset}). Always use this offset for calendar events. Never use UTC unless explicitly asked.`

  // --- Tool sections (only for connected tools) ---
  const sections: string[] = []

  sections.push(`## Invocation

No params: \`node "${scriptPath}" ACTION_NAME\`
With params: \`echo '{"key":"value"}' | node "${scriptPath}" ACTION_NAME\`
Response: \`{"success":true,"result":{...}}\` or \`{"success":false,"error":"..."}\`
**Windows**: Always use the pipe form. Do NOT escape quotes in arguments.`)

  if (hasGmail) {
    sections.push(`## Gmail

- **List/search**: \`${call('GMAIL_FETCH_EMAILS', '{"max_results":20,"query":"is:unread"}')}\`
- **Get by ID**: \`${call('GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID', '{"message_id":"<id>"}')}\`
- **Get thread**: \`${call('GMAIL_FETCH_MESSAGE_BY_THREAD_ID', '{"thread_id":"<id>"}')}\`
- **Send**: \`${call('GMAIL_SEND_EMAIL', '{"recipient_email":"to@example.com","subject":"Subject","body":"Body","is_html":false}')}\`
- **Reply** (use for replies, not SEND): \`${call('GMAIL_REPLY_TO_THREAD', '{"thread_id":"<id>","body":"Reply text","recipient_email":"to@example.com","is_html":false}')}\`
- **Draft**: \`${call('GMAIL_CREATE_EMAIL_DRAFT', '{"recipient_email":"to@example.com","subject":"Subject","body":"Body"}')}\`

Use \`GMAIL_REPLY_TO_THREAD\` (not SEND) for replies. \`thread_id\` comes from \`GMAIL_FETCH_EMAILS\` results.`)
  }

  if (hasGcal) {
    sections.push(`## Google Calendar

- **List events**: \`echo '{}' | node "${scriptPath}" ATTACCA_CALENDAR_EVENTS\` (always use this, not GOOGLECALENDAR_EVENTS_LIST)
- **Search**: \`${call('GOOGLECALENDAR_FIND_EVENT', '{"calendarId":"primary","query":"meeting","timeMin":"2024-01-15T00:00:00Z"}')}\`
- **Create**: \`${call('GOOGLECALENDAR_CREATE_EVENT', '{"summary":"Meeting","start_datetime":"2024-01-15T10:00:00-05:00","end_datetime":"2024-01-15T11:00:00-05:00"}')}\`
  Datetimes MUST include timezone offset. Do NOT include \`calendar_id\`.
- **Delete**: \`${call('GOOGLECALENDAR_DELETE_EVENT', '{"calendarId":"primary","eventId":"<id>"}')}\``)
  }

  if (hasOutlook) {
    sections.push(`## Outlook Email

- **Inbox**: \`${call('ATTACCA_OUTLOOK_MESSAGES', '{"folder":"inbox","top":20}')}\`
- **Unread only**: \`${call('ATTACCA_OUTLOOK_MESSAGES', '{"folder":"inbox","top":20,"is_read":false}')}\`
- **Thread by conversationId**: \`${call('ATTACCA_OUTLOOK_MESSAGES', '{"conversationId":"<id>"}')}\`
- **Other folders**: \`"folder":"sentitems"\`, \`"drafts"\`, \`"allfolders"\`
- **Send**: \`${call('ATTACCA_OUTLOOK_SEND_EMAIL', '{"subject":"Hello","body":"Message","to":["recipient@example.com"]}')}\`
  \`to\`/\`cc\`/\`bcc\` are string arrays. Do NOT call OUTLOOK_SEND_EMAIL directly.
- **Reply**: \`${call('ATTACCA_OUTLOOK_REPLY_EMAIL', '{"message_id":"<id>","comment":"Reply text","reply_all":false}')}\`
  Field is \`comment\` (not \`body\`). Include ONLY new reply text — Outlook auto-appends the original thread.

CRITICAL: Email queries → \`ATTACCA_OUTLOOK_MESSAGES\`. Calendar → \`ATTACCA_OUTLOOK_EVENTS\`. Never mix them.
Exact action names only: \`ATTACCA_OUTLOOK_SEND_EMAIL\`, \`ATTACCA_OUTLOOK_REPLY_EMAIL\`. Never invent variants.

## Outlook Calendar

- **List events**: \`${call('ATTACCA_OUTLOOK_EVENTS', '{"timeMin":"2024-01-15T00:00:00Z","timeMax":"2024-01-22T00:00:00Z"}')}\`
- **Create**: \`${call('ATTACCA_OUTLOOK_CREATE_EVENT', '{"subject":"Meeting","start":"2024-01-15T10:00:00","end":"2024-01-15T11:00:00","attendees":["a@example.com"]}')}\`
  Datetimes WITHOUT offset (timezone auto-injected). Optional: \`body\`, \`is_online_meeting\`.
  Always use \`ATTACCA_OUTLOOK_CREATE_EVENT\`, never OUTLOOK_CALENDAR_CREATE_EVENT directly.

Outlook format differences: title=\`subject\` (not \`summary\`), attendees=\`emailAddress.address\`.`)

    if (hasGcal) {
      sections.push(`## Cross-Calendar Scheduling

When combining Google Calendar + Outlook events:
1. Merge by start time. Conflicts = overlapping events.
2. Priority: external attendees or 3+ attendees → critical; focus/personal → flexible.
3. Ask ONE question about immovable meetings before proposing changes.`)
    }
  }

  if (hasSlack) {
    sections.push(`## Slack

- **List channels**: \`${call('SLACK_LIST_ALL_CHANNELS_IN_THE_SLACK_WORKSPACE', '{}')}\`
- **Send message**: \`${call('SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL', '{"channel":"#general","text":"Hello!"}')}\``)
  }

  if (hasTrello) {
    sections.push(`## Trello

- **All boards + cards**: \`echo '{}' | node "${scriptPath}" ATTACCA_TRELLO_BOARDS_AND_CARDS\`
  Fallback if empty: \`TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER\` with \`{"idMember":"me"}\`, then \`TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD\`.
- **Update card**: \`${call('TRELLO_UPDATE_CARDS_BY_ID_CARD', '{"idCard":"<id>","name":"New title"}')}\` (\`idCard\` required, other fields optional)
- **Comment**: \`${call('TRELLO_CREATE_CARDS_ACTIONS_COMMENTS_BY_ID_CARD', '{"idCard":"<id>","text":"Comment"}')}\`
- **Archive**: \`${call('TRELLO_UPDATE_CARDS_BY_ID_CARD', '{"idCard":"<id>","closed":true}')}\``)
  }

  if (hasClickup) {
    sections.push(`## ClickUp

- **Workspaces**: \`${call('CLICKUP_GET_WORKSPACES', '{}')}\`
- **Tasks**: \`${call('CLICKUP_GET_FILTERED_TEAM_TASKS', '{"team_id":"<id>","assignees":["me"],"statuses":["open","in progress"]}')}\``)
  }

  if (hasAsana) {
    sections.push(`## Asana

- **My tasks**: \`${call('ASANA_GET_TASKS_LIST', '{"assignee":"me","completed_since":"now"}')}\``)
  }

  if (hasNotion) {
    sections.push(`## Notion

- **Search**: \`${call('NOTION_SEARCH', '{"query":"","filter":{"value":"page","property":"object"}}')}\``)
  }

  // Discovery + error handling (always included if any tool is connected)
  if (hasAnyTool) {
    sections.push(`## Errors & Discovery

On \`success: false\`: note failure, continue with other tasks. Don't report as "disconnected" unless asked. Don't include tool errors in briefings. Retry with corrected params if error suggests a param issue.

Discover actions: \`${call('ATTACCA_LIST_ACTIONS', '{"app":"<app-slug>"}')}\` — use the exact \`name\` from results.
The entityId is pre-configured. Only connected tools will work.`)
  }

  // Memory skill — always included
  const memoryScriptPath = join(SKILL_DIR, 'memory-search.cjs').replace(/\\/g, '/')
  sections.push(`## Memory

Your memory persists across conversations. Use it to recall past decisions, preferences, and context about this user.

- **Search memories**: \`echo '{"query":"what did user decide about..."}' | node "${memoryScriptPath}" SEARCH\`
- **Save a preference**: \`echo '{"content":"User prefers...","type":"preference"}' | node "${memoryScriptPath}" SAVE\`
- **Save a decision**: \`echo '{"content":"User decided to...","type":"decision"}' | node "${memoryScriptPath}" SAVE\`

**Rules:**
- Search memory before asking something the user may have already told you.
- When you learn something new about preferences, work style, or decisions, save it.
- Never mention the memory system to the user — just use it naturally.
- Types: \`preference\` (how they like things), \`decision\` (choices they made), \`capture\` (information they saved).`)

  return `${kbContext}---
name: attacca-tools
description: "${toolList} via the Attacca relay"
metadata:
  {
    "openclaw": {
      "emoji": "🔧",
      "always": true
    }
  }
---

# Attacca Productivity Tools

You are a productivity assistant for a non-technical knowledge worker.${hasAnyTool ? ` Connected tools: ${activeNames.join(', ')}.` : ' No tools currently connected.'}

${principles}

${sections.join('\n\n')}
`
}
