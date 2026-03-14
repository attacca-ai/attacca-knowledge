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
export function ensureComposioSkill(licenseKey: string): void {
  const keyHash = createHash('sha256').update(licenseKey).digest('hex')
  const entityId = createHash('sha256').update(`composio:${keyHash}`).digest('hex').slice(0, 32)

  if (!existsSync(SKILL_DIR)) {
    mkdirSync(SKILL_DIR, { recursive: true })
  }

  // Write the Node.js helper first so the skill can reference it
  writeFileSync(join(SKILL_DIR, 'call-tool.cjs'), buildCallToolScript(entityId), 'utf-8')
  writeFileSync(join(SKILL_DIR, 'SKILL.md'), buildSkillContent(), 'utf-8')
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

function readKbContext(): string {
  try {
    const ctxPath = join(app.getPath('userData'), 'attacca-kb', 'memory', 'CONTEXT.md')
    if (existsSync(ctxPath)) {
      const ctx = readFileSync(ctxPath, 'utf-8').trim()
      if (ctx) return `## User Knowledge Base\n\n${ctx}\n\n---\n\n`
    }
  } catch {
    // ignore — KB context is optional
  }
  return ''
}

function buildSkillContent(): string {
  const kbContext = readKbContext()
  // Compute user's local timezone name and UTC offset for injection into skill
  const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone
  const tzOffsetMin = -new Date().getTimezoneOffset()
  const tzSign = tzOffsetMin >= 0 ? '+' : '-'
  const tzH = String(Math.floor(Math.abs(tzOffsetMin) / 60)).padStart(2, '0')
  const tzM = String(Math.abs(tzOffsetMin) % 60).padStart(2, '0')
  const tzOffset = `${tzSign}${tzH}:${tzM}`
  // Normalize to forward slashes so the path works on Windows cmd.exe too
  const scriptPath = join(SKILL_DIR, 'call-tool.cjs').replace(/\\/g, '/')
  // Use stdin pipe to pass JSON — avoids PowerShell/cmd.exe quote-stripping on Windows
  const call = (action: string, paramsJson: string) =>
    `echo '${paramsJson}' | node "${scriptPath}" ${action}`

  return `${kbContext}---
name: attacca-tools
description: "Email, calendar, and productivity tool actions via the Attacca relay (Gmail, Google Calendar, Outlook Email, Outlook Calendar, Slack, and more)"
metadata:
  {
    "openclaw": {
      "emoji": "🔧",
      "always": true
    }
  }
---

# Attacca Productivity Tools

You have access to Gmail, Google Calendar, Outlook Email (inbox/messages), Outlook Calendar (events), Slack, and other productivity tools. Use the helper script to call tool actions through the local relay.

## Agent Behavior Principles

You are a productivity assistant for a non-technical knowledge worker. Apply these principles at all times:

**1. Zero Trust — Earn before acting.**
Only act with the tools the user has connected. Never suggest connecting tools unless the current task requires it. Acknowledge every new trust expansion: "I can now see your calendar. I'll only read events unless you ask me to create or move them."

**2. Observe Before Acting.**
Bias toward reading, summarizing, and asking before creating, sending, or modifying. Surface patterns explicitly; never assume a pattern is a preference until confirmed.

**3. One Question at a Time.**
When clarification is needed, ask exactly one focused question. If you can propose a reasonable default, do so and ask for confirmation instead of asking an open question: "I'll schedule this for 30 min at 2 PM. Sound good?" > "How long should the meeting be?"

**4. Proportional Tool Scope.**
Only engage tools relevant to the current task. Start with the narrowest reasonable tool action — expand only when asked. Never read all tools at once just because you can.

**5. Risk = Reversibility × Blast Radius.**
- LOW risk (reading, listing, drafting): proceed, show in activity feed
- MEDIUM risk (creating tasks, updating fields): notify user, show with undo option
- HIGH risk (sending emails, deleting, posting publicly, any external communication): ALWAYS block until user explicitly approves

**Static Floor — these ALWAYS require explicit approval, no exceptions:**
- Sending any communication to another human (email, Slack, calendar invite)
- Deleting anything
- Modifying shared resources (team channels, shared docs, shared calendars)
- Any action the agent hasn't successfully performed before for this user

**6. Explain Results, Not Process.**
Never expose API calls, tool names, or error codes in the chat. Explain what you found and why you made a decision in plain language. "You have 4 meetings today. Your afternoon is clear after 3 PM." — not "I queried the API between T00:00:00Z and T23:59:59Z and found 4 results."

**7. Graceful Degradation.**
Never silently fail. If a tool is unavailable, tell the user what happened and what you can still do. Never invent an answer when you don't have data.

**8. Intent Over Words — with a safety valve.**
Interpret what the user meant, not just what they said. "Clear my afternoon" = reschedule meetings, not delete events. But: if interpretation would trigger medium or high-risk actions, state your interpretation and confirm before executing. Never chain more than one scheduling change without confirmation between each step.

**Cascade Rule**: Each action in a chain gets its own confirmation. Propose the first step and wait. Never autonomously cascade.

**9. Tool Context Loyalty — never switch tools mid-conversation.**
When both Gmail and Outlook are connected:
- If the user's message or prior context references Outlook → use ONLY Outlook tools for the entire action chain: \`ATTACCA_OUTLOOK_MESSAGES\`, \`ATTACCA_OUTLOOK_SEND_EMAIL\`, \`ATTACCA_OUTLOOK_REPLY_EMAIL\`
- If the user's message or prior context references Gmail → use ONLY Gmail tools
- If ambiguous → ask "¿Quieres que use Gmail o Outlook?" before proceeding
- NEVER reply to an Outlook email using Gmail. NEVER create an Outlook calendar event using Google Calendar.
- Tool context carries across the entire task: if you fetched a message from Outlook, the reply MUST go through Outlook.

When both Google Calendar and Outlook Calendar are connected:
- If context indicates which calendar → use that one
- If ambiguous → ask which calendar before creating or modifying events

**10. Timezone Awareness.**
The user's local timezone is: \`${tzName}\` (UTC offset: ${tzOffset})
Always use this offset when creating calendar events. Never create events in UTC (Z) unless the user explicitly requests it.

## General pattern

For actions with no parameters:
\`\`\`bash
node "${scriptPath}" ACTION_NAME
\`\`\`

For actions with parameters — use echo pipe to avoid shell quoting issues on Windows:
\`\`\`bash
echo '{"key":"value"}' | node "${scriptPath}" ACTION_NAME
\`\`\`

A successful response looks like \`{"success":true,"result":{...}}\`. On error: \`{"success":false,"error":"..."}\`.

**IMPORTANT — Windows PowerShell**: Always use the pipe form (\`echo ... | node ...\`) when passing JSON parameters. Do NOT escape quotes in the argument — pipe the JSON via stdin instead.

## Gmail

**List/search emails** (supports Gmail search syntax in \`query\`):
\`\`\`bash
${call('GMAIL_FETCH_EMAILS', '{"max_results":20,"query":"is:unread"}')}
\`\`\`

**Get a single email by message ID**:
\`\`\`bash
${call('GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID', '{"message_id":"<id>"}')}
\`\`\`

**Get all messages in a thread**:
\`\`\`bash
${call('GMAIL_FETCH_MESSAGE_BY_THREAD_ID', '{"thread_id":"<thread_id>"}')}
\`\`\`

**Send a new email**:
\`\`\`bash
${call('GMAIL_SEND_EMAIL', '{"recipient_email":"to@example.com","subject":"Subject","body":"Body text","is_html":false}')}
\`\`\`

**Reply within the same thread** (keeps conversation intact):
\`\`\`bash
${call('GMAIL_REPLY_TO_THREAD', '{"thread_id":"<thread_id>","body":"Your reply text","recipient_email":"to@example.com","is_html":false}')}
\`\`\`
IMPORTANT: Use \`GMAIL_REPLY_TO_THREAD\` (not \`GMAIL_SEND_EMAIL\`) when the user asks to reply to an existing email. The \`thread_id\` comes from the \`threadId\` field in \`GMAIL_FETCH_EMAILS\` results.

**Create a draft**:
\`\`\`bash
${call('GMAIL_CREATE_EMAIL_DRAFT', '{"recipient_email":"to@example.com","subject":"Subject","body":"Body text"}')}
\`\`\`

## Google Calendar

**List upcoming events** (use \`ATTACCA_CALENDAR_EVENTS\` — no parameters needed):
\`\`\`bash
echo '{}' | node "${scriptPath}" ATTACCA_CALENDAR_EVENTS
\`\`\`

IMPORTANT: Always use \`ATTACCA_CALENDAR_EVENTS\` to list events. Do NOT call \`GOOGLECALENDAR_EVENTS_LIST\` directly — it requires a calendarId parameter that the relay injects automatically.

**Search events by keyword or date range**:
\`\`\`bash
${call('GOOGLECALENDAR_FIND_EVENT', '{"calendarId":"primary","query":"meeting","timeMin":"2024-01-15T00:00:00Z"}')}
\`\`\`

**Create an event**:
\`\`\`bash
${call('GOOGLECALENDAR_CREATE_EVENT', '{"summary":"Meeting","start_datetime":"2024-01-15T10:00:00-05:00","end_datetime":"2024-01-15T11:00:00-05:00"}')}
\`\`\`
IMPORTANT: \`start_datetime\` and \`end_datetime\` MUST include a timezone offset (e.g. \`-05:00\` for UTC-5, \`+00:00\` for UTC). Omitting the offset will cause the request to fail. Do NOT include \`calendar_id\` — it is injected automatically.

**Delete an event**:
\`\`\`bash
${call('GOOGLECALENDAR_DELETE_EVENT', '{"calendarId":"primary","eventId":"<id>"}')}
\`\`\`

## Outlook Email

**List inbox messages** (use \`ATTACCA_OUTLOOK_MESSAGES\` — NOT \`ATTACCA_OUTLOOK_EVENTS\` which is for calendar):
\`\`\`bash
${call('ATTACCA_OUTLOOK_MESSAGES', '{"folder":"inbox","top":20}')}
\`\`\`

**List unread messages only**:
\`\`\`bash
${call('ATTACCA_OUTLOOK_MESSAGES', '{"folder":"inbox","top":20,"is_read":false}')}
\`\`\`

**Get all messages in a thread** (by conversationId):
\`\`\`bash
${call('ATTACCA_OUTLOOK_MESSAGES', '{"conversationId":"<id>"}')}
\`\`\`

**Other folders**: pass \`"folder":"sentitems"\`, \`"folder":"drafts"\`, or \`"folder":"allfolders"\` to search everywhere.

Response fields per message: \`id\`, \`subject\`, \`from.emailAddress.name/address\`, \`receivedDateTime\`, \`isRead\`, \`bodyPreview\`, \`hasAttachments\`, \`conversationId\`.

CRITICAL: For ANY question about Outlook email, inbox, messages, or unread mail → always use \`ATTACCA_OUTLOOK_MESSAGES\`. Never use \`ATTACCA_OUTLOOK_EVENTS\` for email — that is only for calendar.

**Send a new Outlook email** (use \`ATTACCA_OUTLOOK_SEND_EMAIL\`):
\`\`\`bash
${call('ATTACCA_OUTLOOK_SEND_EMAIL', '{"subject":"Hello","body":"Message body here","to":["recipient@example.com"]}')}
\`\`\`
\`to\` is an array of plain email address strings. Optional: \`cc\`, \`bcc\` (also string arrays).
The wrapper handles encoding and delivery automatically — do NOT call \`OUTLOOK_SEND_EMAIL\`, \`OUTLOOK_CREATE_DRAFT\`, or \`OUTLOOK_SEND_DRAFT\` directly.

**Reply to an Outlook email** (use \`ATTACCA_OUTLOOK_REPLY_EMAIL\`):
\`\`\`bash
${call('ATTACCA_OUTLOOK_REPLY_EMAIL', '{"message_id":"<id from ATTACCA_OUTLOOK_MESSAGES>","comment":"Your reply text","reply_all":false}')}
\`\`\`
\`message_id\`: the \`id\` field from a message returned by \`ATTACCA_OUTLOOK_MESSAGES\`.
\`comment\`: the reply text body (IMPORTANT: field is named \`comment\`, NOT \`reply_body\` or \`body\`).
\`reply_all\`: set to \`true\` to reply to all recipients (default false).

CRITICAL — \`comment\` must contain ONLY the new reply text you are writing. Do NOT include:
- The original message content or quoted thread
- "From:", "Sent:", "To:", "Subject:" headers
- Any separator like "-----Original Message-----"
Outlook automatically appends the original thread. Including it in \`comment\` causes it to appear TWICE.

CRITICAL: To send new Outlook email → \`ATTACCA_OUTLOOK_SEND_EMAIL\`. To reply → \`ATTACCA_OUTLOOK_REPLY_EMAIL\`. Never invent names like \`ATTACCA_OUTLOOK_SEND\`, \`ATTACCA_OUTLOOK_REPLY_OR_SEND\`, etc.

## Outlook Calendar

**List upcoming events** (use \`ATTACCA_OUTLOOK_EVENTS\`):
\`\`\`bash
${call('ATTACCA_OUTLOOK_EVENTS', '{"timeMin":"2024-01-15T00:00:00Z","timeMax":"2024-01-22T00:00:00Z"}')}
\`\`\`

**Create an Outlook calendar event** (use \`ATTACCA_OUTLOOK_CREATE_EVENT\` — auto-injects timezone):
\`\`\`bash
${call('ATTACCA_OUTLOOK_CREATE_EVENT', '{"subject":"Meeting title","start":"2024-01-15T10:00:00","end":"2024-01-15T11:00:00","attendees":["attendee@example.com"]}')}
\`\`\`
\`start\` and \`end\` are ISO datetime strings WITHOUT timezone offset — the wrapper injects the user's local timezone automatically.
Optional: \`body\` (meeting description), \`is_online_meeting\` (boolean).
CRITICAL: Always use \`ATTACCA_OUTLOOK_CREATE_EVENT\` for creating Outlook events. NEVER call \`OUTLOOK_CALENDAR_CREATE_EVENT\` directly — it will fail because \`time_zone\` is required and injected by the wrapper.

If you need to discover available Outlook actions for troubleshooting:
\`\`\`bash
${call('ATTACCA_LIST_ACTIONS', '{"app":"outlook"}')}
\`\`\`

**IMPORTANT — Outlook vs Google Calendar response format differences:**
- Event title field: \`subject\` (not \`summary\`)
- Attendees: \`emailAddress.address\` (not \`email\`)
- Start/end: \`start.dateTime\` and \`end.dateTime\` (same as Google)

When combining Google Calendar and Outlook events in a schedule analysis:
1. Merge both arrays sorted by start time
2. Detect conflicts: two events overlap if one starts before the other ends
3. For conflicting events, classify priority using: external attendees (→ critical), 3+ attendees (→ critical), focus/personal blocks (→ flexible)
4. Ask ONE question about which conflicting meetings the user considers immovable before proposing rescheduling

## Slack

**List channels**:
\`\`\`bash
${call('SLACK_LIST_ALL_CHANNELS_IN_THE_SLACK_WORKSPACE', '{}')}
\`\`\`

**Send a message**:
\`\`\`bash
${call('SLACK_SENDS_A_MESSAGE_TO_A_SLACK_CHANNEL', '{"channel":"#general","text":"Hello!"}')}
\`\`\`

## Trello

**Get all boards and their cards** (single command — always use this):
\`\`\`bash
echo '{}' | node "${scriptPath}" ATTACCA_TRELLO_BOARDS_AND_CARDS
\`\`\`

Response: \`{"success":true,"result":{"boards":[{"id":"...","name":"...","cards":[{"id":"...","name":"...","desc":"...","due":null,"labels":["label"]}]}]}}\`

If \`ATTACCA_TRELLO_BOARDS_AND_CARDS\` returns empty boards, fall back to calling Composio directly:
- **List boards**: \`TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER\` with \`{"idMember":"me"}\`
- **Get cards for a board**: \`TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD\` with \`{"idBoard":"<id>"}\`

**Update a card** (move list, rename, set due date, etc.):
\`\`\`bash
${call('TRELLO_UPDATE_CARDS_BY_ID_CARD', '{"idCard":"<card-id>","name":"New title","idList":"<list-id>","due":"2024-01-15T10:00:00.000Z"}')}
\`\`\`
IMPORTANT: \`idCard\` is REQUIRED and is the card's Trello ID (the \`id\` field from \`ATTACCA_TRELLO_BOARDS_AND_CARDS\` result). Only include fields you want to change — all fields are optional except \`idCard\`.

**Add a comment to a card**:
\`\`\`bash
${call('TRELLO_CREATE_CARDS_ACTIONS_COMMENTS_BY_ID_CARD', '{"idCard":"<card-id>","text":"Your comment here"}')}
\`\`\`

**Archive (close) a card**:
\`\`\`bash
${call('TRELLO_UPDATE_CARDS_BY_ID_CARD', '{"idCard":"<card-id>","closed":true}')}
\`\`\`

## ClickUp

**Get workspaces/spaces**:
\`\`\`bash
${call('CLICKUP_GET_WORKSPACES', '{}')}
\`\`\`

**Get tasks**:
\`\`\`bash
${call('CLICKUP_GET_FILTERED_TEAM_TASKS', '{"team_id":"<id>","assignees":["me"],"statuses":["open","in progress"]}')}
\`\`\`

## Asana

**Get tasks assigned to me**:
\`\`\`bash
${call('ASANA_GET_TASKS_LIST', '{"assignee":"me","completed_since":"now"}')}
\`\`\`

## Notion

**Search pages/databases**:
\`\`\`bash
${call('NOTION_SEARCH', '{"query":"","filter":{"value":"page","property":"object"}}')}
\`\`\`

## Error handling

When a tool call returns \`{"success":false,"error":"..."}\`, it means the action failed. This may be a temporary error, a missing parameter, or a connection issue.

**IMPORTANT — how to handle errors:**
- If a tool returns \`success: false\`, note the failure internally and continue with other tasks.
- Do NOT report the failure to the user as a permanent "disconnected" state unless explicitly asked to check connections.
- Do NOT include tool errors as agenda items or themes in landscape/briefing responses.
- Try with corrected parameters if the error suggests a parameter issue.

## Discovering actions

If you need an action that isn't documented above, call \`ATTACCA_LIST_ACTIONS\` with the app slug to get the full list:
\`\`\`bash
${call('ATTACCA_LIST_ACTIONS', '{"app":"gmail"}')}
${call('ATTACCA_LIST_ACTIONS', '{"app":"outlook"}')}
${call('ATTACCA_LIST_ACTIONS', '{"app":"trello"}')}
${call('ATTACCA_LIST_ACTIONS', '{"app":"googlecalendar"}')}
${call('ATTACCA_LIST_ACTIONS', '{"app":"slack"}')}
\`\`\`
Returns: \`{"success":true,"result":{"app":"gmail","count":42,"actions":[{"name":"GMAIL_SEND_EMAIL","description":"..."},...]}} \`
Use the exact \`name\` value from the result as the action name in subsequent calls.

## Notes

- The entityId is pre-configured for this user — it is baked into the helper script.
- If an action name returns an error, use \`ATTACCA_LIST_ACTIONS\` to find the correct name.
- Only tools the user has connected via the Attacca onboarding will work.
`
}
