import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createHash } from 'crypto'

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
if (paramsArg) {
  try { run(JSON.parse(paramsArg)) } catch (_) {
    var chunks = []
    process.stdin.on('data', function(d) { chunks.push(d) })
    process.stdin.on('end', function() {
      try { run(JSON.parse(Buffer.concat(chunks).toString())) } catch (_2) { run({}) }
    })
    process.stdin.on('error', function() { run({}) })
    setTimeout(function() { process.stdin.destroy(); run({}) }, 1000)
  }
} else {
  run({})
}
`
}

function buildSkillContent(): string {
  // Normalize to forward slashes so the path works on Windows cmd.exe too
  const scriptPath = join(SKILL_DIR, 'call-tool.cjs').replace(/\\/g, '/')
  // Use stdin pipe to pass JSON — avoids PowerShell/cmd.exe quote-stripping on Windows
  const call = (action: string, paramsJson: string) =>
    `echo '${paramsJson}' | node "${scriptPath}" ${action}`

  return `---
name: attacca-tools
description: "Email, calendar, and productivity tool actions via the Attacca relay (Gmail, Google Calendar, Slack, and more)"
metadata:
  {
    "openclaw": {
      "emoji": "🔧",
      "always": true
    }
  }
---

# Attacca Productivity Tools

You have access to Gmail, Google Calendar, Slack, and other productivity tools. Use the helper script to call tool actions through the local relay.

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

**Get a single email by ID**:
\`\`\`bash
${call('GMAIL_GET_EMAIL_BY_MESSAGE_ID', '{"message_id":"<id>"}')}
\`\`\`

**Send an email**:
\`\`\`bash
${call('GMAIL_SEND_EMAIL', '{"recipient_email":"to@example.com","subject":"Subject","body":"Body text","is_html":false}')}
\`\`\`

**Create a draft**:
\`\`\`bash
${call('GMAIL_CREATE_EMAIL_DRAFT', '{"recipient_email":"to@example.com","subject":"Subject","body":"Body text"}')}
\`\`\`

## Google Calendar

IMPORTANT: The correct action names for Google Calendar are listed below. Do NOT use \`GOOGLECALENDAR_LIST_EVENTS\` — that action does not exist.

**List upcoming events** (action: \`GOOGLECALENDAR_EVENTS_LIST\`):
\`\`\`bash
${call('GOOGLECALENDAR_EVENTS_LIST', '{"calendarId":"primary","maxResults":10}')}
\`\`\`

**Search events by keyword or date range**:
\`\`\`bash
${call('GOOGLECALENDAR_FIND_EVENT', '{"calendarId":"primary","query":"meeting","timeMin":"2024-01-15T00:00:00Z"}')}
\`\`\`

**Create an event**:
\`\`\`bash
${call('GOOGLECALENDAR_CREATE_EVENT', '{"summary":"Meeting","start_datetime":"2024-01-15T10:00:00","end_datetime":"2024-01-15T11:00:00","calendar_id":"primary"}')}
\`\`\`

**Delete an event**:
\`\`\`bash
${call('GOOGLECALENDAR_DELETE_EVENT', '{"calendarId":"primary","eventId":"<id>"}')}
\`\`\`

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

IMPORTANT: Do NOT try individual Composio Trello actions (TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD, TRELLO_LIST_BOARDS, etc.) — only \`ATTACCA_TRELLO_BOARDS_AND_CARDS\` is supported. If \`cards\` is an empty array for a board, show the board name only.

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

## Notes

- The entityId is pre-configured for this user — it is baked into the helper script.
- If an action name returns an error, try the exact Composio action name (uppercase with underscores, e.g. \`GMAIL_FETCH_EMAILS\`).
- Only tools the user has connected via the Attacca onboarding will work.
`
}
