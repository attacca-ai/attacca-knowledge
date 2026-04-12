/**
 * Local Composio SDK wrapper — ported from relay-server/src/services/composio.ts.
 * Uses the user's own Composio API key (stored via Electron safeStorage).
 * The @composio/core SDK is lazy-loaded to keep app startup fast.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { app, safeStorage } from 'electron'
import type { ComposioOAuthInitResult, ComposioConnectionStatus, ComposioApp } from './types'
import {
  loadConnections,
  addConnection as storeAddConnection,
  removeConnection as storeRemoveConnection,
  type ConnectionLabel,
  type AccountLabel
} from './connections'
import { pruneDefaults } from './defaults'
import { getTelemetryCollector } from '../telemetry/collector'

// Map frontend app slugs -> Composio toolkit slugs
const APP_SLUG_MAP: Record<string, string> = {
  'google-calendar': 'googlecalendar',
  'google-drive': 'googledrive',
  'outlook-email': 'outlook',
  'outlook-calendar': 'outlook'
}

function toComposioSlug(appName: string): string {
  return APP_SLUG_MAP[appName] ?? appName
}

// Known toolkit versions for the v3 REST API
const TOOLKIT_VERSIONS: Record<string, string> = {
  outlook: '20260309_00'
}

function getToolkitVersion(actionName: string): string | undefined {
  const prefix = actionName.split('_')[0].toLowerCase()
  return TOOLKIT_VERSIONS[prefix]
}

// ── API Key Storage ──────────────────────────────────────────────

const KEY_FILE = 'composio-key.enc'

function getKeyPath(): string {
  return join(app.getPath('userData'), KEY_FILE)
}

export function saveComposioApiKey(apiKey: string): void {
  const keyPath = getKeyPath()
  const dir = dirname(keyPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(apiKey)
    writeFileSync(keyPath, encrypted)
  } else {
    writeFileSync(keyPath, apiKey, 'utf-8')
  }
  // Drop any cached client or connected-apps list tied to the old key
  resetClientCache()
}

export function loadComposioApiKey(): string | null {
  const keyPath = getKeyPath()
  if (!existsSync(keyPath)) return null

  try {
    const raw = readFileSync(keyPath)
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(raw)
    }
    return raw.toString('utf-8')
  } catch {
    return null
  }
}

export function getComposioApiKeyHint(): string | null {
  const key = loadComposioApiKey()
  if (!key) return null
  return key.length > 8 ? key.slice(0, 4) + '...' + key.slice(-4) : '****'
}

// ── SDK Client (Lazy-loaded) ─────────────────────────────────────

function getApiKey(): string {
  const key = loadComposioApiKey()
  if (!key) throw new Error('Composio API key not configured. Add one in Settings.')
  return key
}

let cachedClient: any = null
let cachedClientKey: string | null = null

async function getClient(): Promise<any> {
  const key = getApiKey()
  // Return cached client if key hasn't changed
  if (cachedClient && cachedClientKey === key) return cachedClient
  const { Composio } = await import('@composio/core')
  cachedClient = new Composio({ apiKey: key }).getClient()
  cachedClientKey = key
  return cachedClient
}

// ── Connected-apps cache ─────────────────────────────────────────

interface ConnectedAppsCacheEntry {
  apps: string[]
  timestamp: number
}

const CONNECTED_APPS_TTL_MS = 60 * 1000
const connectedAppsCache = new Map<string, ConnectedAppsCacheEntry>()

export function invalidateConnectedAppsCache(entityId?: string): void {
  if (entityId) {
    connectedAppsCache.delete(entityId)
  } else {
    connectedAppsCache.clear()
  }
}

function resetClientCache(): void {
  cachedClient = null
  cachedClientKey = null
  connectedAppsCache.clear()
}

// ── OAuth ────────────────────────────────────────────────────────

export async function initiateOAuth(
  entityId: string,
  appName: string
): Promise<ComposioOAuthInitResult> {
  console.log(`[composio] initiateOAuth entity=${entityId} app=${appName}`)
  const client = await getClient()
  const composioSlug = toComposioSlug(appName)

  const authRes = await client.authConfigs.create({
    toolkit: { slug: composioSlug },
    type: 'use_composio_managed_auth'
  } as any)

  const authConfigId = (authRes as any)?.auth_config?.id
  if (!authConfigId) {
    throw new Error(`Failed to get auth config for app: ${composioSlug}`)
  }

  const linkRes = await client.link.create({
    auth_config_id: authConfigId,
    user_id: entityId
  } as any)

  const link = linkRes as any
  return {
    connectionId: link.connected_account_id,
    redirectUrl: link.redirect_url ?? ''
  }
}

export async function getConnectionStatus(connectionId: string): Promise<ComposioConnectionStatus> {
  const client = await getClient()
  const result = await client.connectedAccounts.retrieve(connectionId as any)
  const data = result as any

  return {
    id: data.id ?? connectionId,
    status: (data.status ?? '').toLowerCase() as ComposioConnectionStatus['status'],
    appName: data.toolkit?.slug ?? data.appName ?? ''
  }
}

export async function getConnectedApps(entityId: string): Promise<string[]> {
  const cached = connectedAppsCache.get(entityId)
  if (cached && Date.now() - cached.timestamp < CONNECTED_APPS_TTL_MS) {
    console.log(`[composio] getConnectedApps entity=${entityId} (cache hit)`)
    return cached.apps
  }

  console.log(`[composio] getConnectedApps entity=${entityId} (cache miss)`)
  const client = await getClient()
  const result = await client.connectedAccounts.list({ user_id: entityId } as any)
  const items: any[] = (result as any)?.items ?? []

  const connected = [
    ...new Set(
      items
        .filter((c) => (c.status ?? '').toUpperCase() === 'ACTIVE')
        .map((c) => c.toolkit?.slug ?? c.appName ?? '')
        .filter(Boolean)
    )
  ]
  console.log(`[composio] Connected apps (${connected.length}):`, connected)
  connectedAppsCache.set(entityId, { apps: connected, timestamp: Date.now() })
  return connected
}

export interface ConnectedAccount {
  connectionId: string
  toolkit: string
  status: string
}

export interface ConnectedAccountWithLabel extends ConnectedAccount {
  label: AccountLabel
  customName: string | null
}

export async function getConnectedAccounts(entityId: string): Promise<ConnectedAccount[]> {
  console.log(`[composio] getConnectedAccounts entity=${entityId}`)
  const client = await getClient()
  const result = await client.connectedAccounts.list({ user_id: entityId } as any)
  const items: any[] = (result as any)?.items ?? []

  return items
    .filter((c) => (c.status ?? '').toUpperCase() === 'ACTIVE')
    .map((c) => ({
      connectionId: String(c.id ?? c.connected_account_id ?? ''),
      toolkit: String(c.toolkit?.slug ?? c.appName ?? ''),
      status: String(c.status ?? 'ACTIVE')
    }))
    .filter((c) => c.connectionId && c.toolkit)
}

/**
 * Merge live Composio accounts with local labels from `composio-connections.json`.
 *
 * Side effect: for every active account that exists on Composio but NOT yet in
 * `connections.json`, we auto-add it with `label: 'Work'`. This is the
 * "rolling migration" path — the bulk migration also runs once at boot, but
 * this catches accounts added out-of-band (e.g. via a future API or a manual
 * Composio dashboard action).
 */
export async function getAccountsWithLabels(
  entityId: string
): Promise<ConnectedAccountWithLabel[]> {
  const live = await getConnectedAccounts(entityId)
  const localByConnId = new Map<string, ConnectionLabel>(
    loadConnections().map((c) => [c.connectionId, c])
  )

  const result: ConnectedAccountWithLabel[] = []
  for (const account of live) {
    const existing = localByConnId.get(account.connectionId)
    if (existing) {
      result.push({
        ...account,
        label: existing.label,
        customName: existing.customName
      })
      continue
    }

    // Auto-label missing accounts as 'Work'. Persist so future reads are stable.
    const newLabel: ConnectionLabel = {
      connectionId: account.connectionId,
      toolkit: account.toolkit,
      label: 'Work',
      customName: null,
      createdAt: Date.now()
    }
    try {
      storeAddConnection(newLabel)
      // M4: every rolling auto-label emits its own telemetry so the true
      // migration footprint is observable even when the bulk migration at
      // boot reports zero (because a previous read already labeled everything).
      try {
        getTelemetryCollector().emit('migration.rolling_autolabel', {
          toolkit: account.toolkit,
          label: newLabel.label
        })
      } catch {
        /* telemetry best-effort */
      }
    } catch (err) {
      console.warn('[composio] Failed to auto-label new connection:', err)
    }
    result.push({
      ...account,
      label: newLabel.label,
      customName: newLabel.customName
    })
  }

  return result
}

/**
 * Run the one-time multi-account migration. Idempotent: safe to call on every
 * boot. Returns the number of connections that were newly auto-labeled by
 * this invocation (M2 — true delta, not total).
 *
 * Because `getAccountsWithLabels` also auto-labels as a side effect on every
 * read, a rolling migration may have already happened before this function
 * runs. In that case the delta is zero, which is the honest answer — every
 * rolling-path auto-label is reported separately via `migration.rolling_autolabel`.
 */
export async function runMultiAccountMigration(entityId: string): Promise<number> {
  try {
    const before = new Set(loadConnections().map((c) => c.connectionId))
    await getAccountsWithLabels(entityId)
    const after = loadConnections()
    let newlyLabeled = 0
    for (const conn of after) {
      if (!before.has(conn.connectionId)) newlyLabeled++
    }
    return newlyLabeled
  } catch (err) {
    console.error('[composio] Migration failed:', err)
    return 0
  }
}

/**
 * Disconnect all connected accounts for a given toolkit slug (frontend or composio slug).
 * Calls client.connectedAccounts.delete for each matching connection and invalidates
 * the connected-apps cache on success.
 */
export async function disconnectAccount(
  entityId: string,
  toolkitSlug: string
): Promise<{ success: boolean; deleted: number; error?: string }> {
  console.log(`[composio] disconnectAccount entity=${entityId} toolkit=${toolkitSlug}`)
  try {
    const composioSlug = toComposioSlug(toolkitSlug)
    const accounts = await getConnectedAccounts(entityId)
    const targets = accounts.filter((a) => a.toolkit === composioSlug)

    if (targets.length === 0) {
      // Nothing to revoke upstream — still invalidate cache in case of drift
      invalidateConnectedAppsCache(entityId)
      return { success: true, deleted: 0 }
    }

    const client = await getClient()
    let deleted = 0
    for (const target of targets) {
      await client.connectedAccounts.delete(target.connectionId as any)
      // Remove the local label row alongside the upstream revoke so local and
      // Composio states stay in sync (per DVR-8 in spec-b.md).
      try {
        storeRemoveConnection(target.connectionId)
      } catch (err) {
        console.warn('[composio] Failed to remove local label:', err)
      }
      deleted++
    }
    invalidateConnectedAppsCache(entityId)

    // Prune any defaultAccounts entries that now point at revoked connections.
    try {
      const remaining = await getConnectedAccounts(entityId)
      const liveIds = new Set(remaining.map((a) => a.connectionId))
      const pruned = pruneDefaults(liveIds)
      if (pruned > 0) {
        console.log(`[composio] Pruned ${pruned} stale default-account entries`)
      }
    } catch {
      // Best effort — next tool-call resolution will catch stale defaults anyway.
    }

    return { success: true, deleted }
  } catch (err) {
    return {
      success: false,
      deleted: 0,
      error: err instanceof Error ? err.message : 'Disconnect failed'
    }
  }
}

// ── Tool Execution ───────────────────────────────────────────────

export async function proxyToolAction(
  entityId: string,
  actionName: string,
  params: Record<string, unknown>,
  connectedAccountId?: string
): Promise<unknown> {
  const client = await getClient()
  // NOTE: the Composio SDK `tools.execute` validates its body against a zod
  // schema that uses camelCase (`userId`, `connectedAccountId`, `arguments`).
  // Snake_case fields are silently dropped by zod, which is why the pre-Spec-B
  // code appeared to work for single-account users — Composio was falling back
  // to a default when `userId` was missing. With multi-account, the missing
  // `userId` meant the SDK picked an account non-deterministically. Always use
  // camelCase here. The REST fallback at `executeActionDirect` uses snake_case
  // because the v3 REST API body schema is different from the SDK schema.
  const payload: Record<string, unknown> = {
    userId: entityId,
    arguments: params
  }
  if (connectedAccountId) {
    payload.connectedAccountId = connectedAccountId
  }
  return client.tools.execute(actionName, payload as any)
}

export async function executeActionDirect(
  entityId: string,
  actionName: string,
  params: Record<string, unknown>,
  version?: string,
  connectedAccountId?: string
): Promise<unknown> {
  const key = getApiKey()
  const resolvedVersion = version ?? getToolkitVersion(actionName)

  const url = `https://backend.composio.dev/api/v3/tools/execute/${encodeURIComponent(actionName)}`
  const body: Record<string, unknown> = { user_id: entityId, arguments: params }
  if (resolvedVersion) body.version = resolvedVersion
  if (connectedAccountId) body.connected_account_id = connectedAccountId
  console.log(`[composio] executeActionDirect ${actionName} version=${resolvedVersion ?? 'none'}`)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`${res.status} ${errText.slice(0, 200)}`)
  }
  return res.json()
}

// ── App Discovery ────────────────────────────────────────────────

export async function listAppActions(
  appSlug: string
): Promise<Array<{ name: string; description: string }>> {
  const key = getApiKey()

  // Primary: use Composio SDK getRawComposioTools (reuses cached client)
  try {
    const { Composio } = await import('@composio/core')
    const composio =
      cachedClientKey === key
        ? new Composio({ apiKey: key }) // reuse is safe — Composio is lightweight
        : new Composio({ apiKey: key })
    const tools = await (composio as any).tools.getRawComposioTools({
      toolkits: [appSlug],
      limit: 200
    })
    const items: Array<{ name: string; description: string }> = []
    for (const t of tools ?? []) {
      const name = t?.slug ?? t?.name ?? ''
      if (name) items.push({ name, description: (t?.description ?? '').slice(0, 120) })
    }
    if (items.length > 0) return items
  } catch {
    // Fall through to REST API
  }

  // v2 REST API fallback
  try {
    const v2Url = `https://backend.composio.dev/api/v2/actions?toolkit=${encodeURIComponent(appSlug)}&limit=200`
    const v2Res = await fetch(v2Url, { headers: { 'x-api-key': key } })
    if (v2Res.ok) {
      const data = (await v2Res.json()) as {
        items?: Array<{ name?: string; description?: string }>
      }
      const items = (data.items ?? [])
        .map((a) => ({ name: a.name ?? '', description: (a.description ?? '').slice(0, 120) }))
        .filter((a) => a.name)
      if (items.length > 0) return items
    }
  } catch {
    // Fall through
  }

  // v1 fallback
  const v1Url = `https://backend.composio.dev/api/v1/actions?apps=${encodeURIComponent(appSlug)}&limit=200&filterImportantActions=false`
  const v1Res = await fetch(v1Url, { headers: { 'x-api-key': key } })
  if (!v1Res.ok) throw new Error(`Composio actions API error: ${v1Res.status}`)
  const v1Data = (await v1Res.json()) as { items?: Array<{ name?: string; description?: string }> }
  return (v1Data.items ?? [])
    .map((a) => ({ name: a.name ?? '', description: (a.description ?? '').slice(0, 120) }))
    .filter((a) => a.name)
}

// Static fallback list of popular Composio apps
const POPULAR_APPS_FALLBACK: ComposioApp[] = [
  {
    slug: 'github',
    name: 'GitHub',
    categories: ['Developer Tools'],
    description: 'Code hosting and version control'
  },
  { slug: 'gmail', name: 'Gmail', categories: ['Email'], description: 'Google email service' },
  {
    slug: 'slack',
    name: 'Slack',
    categories: ['Communication'],
    description: 'Team messaging platform'
  },
  {
    slug: 'notion',
    name: 'Notion',
    categories: ['Productivity'],
    description: 'Docs and knowledge base'
  },
  {
    slug: 'googlesheets',
    name: 'Google Sheets',
    categories: ['Productivity'],
    description: 'Online spreadsheets'
  },
  {
    slug: 'googledrive',
    name: 'Google Drive',
    categories: ['File Storage'],
    description: 'Cloud file storage'
  },
  {
    slug: 'googlecalendar',
    name: 'Google Calendar',
    categories: ['Calendar'],
    description: 'Calendar and scheduling'
  },
  {
    slug: 'hubspot',
    name: 'HubSpot',
    categories: ['CRM'],
    description: 'CRM and marketing platform'
  },
  { slug: 'salesforce', name: 'Salesforce', categories: ['CRM'], description: 'Enterprise CRM' },
  {
    slug: 'jira',
    name: 'Jira',
    categories: ['Project Management'],
    description: 'Issue and project tracking'
  },
  {
    slug: 'trello',
    name: 'Trello',
    categories: ['Project Management'],
    description: 'Kanban boards'
  },
  {
    slug: 'asana',
    name: 'Asana',
    categories: ['Project Management'],
    description: 'Project and task management'
  },
  {
    slug: 'clickup',
    name: 'ClickUp',
    categories: ['Project Management'],
    description: 'All-in-one productivity app'
  },
  {
    slug: 'linear',
    name: 'Linear',
    categories: ['Project Management'],
    description: 'Issue tracking for software teams'
  },
  {
    slug: 'monday',
    name: 'Monday.com',
    categories: ['Project Management'],
    description: 'Work OS platform'
  },
  {
    slug: 'airtable',
    name: 'Airtable',
    categories: ['Database'],
    description: 'Spreadsheet-database hybrid'
  },
  {
    slug: 'outlook',
    name: 'Outlook',
    categories: ['Email', 'Calendar'],
    description: 'Microsoft email and calendar'
  },
  {
    slug: 'one_drive',
    name: 'OneDrive',
    categories: ['File Storage'],
    description: 'Microsoft cloud storage'
  },
  {
    slug: 'dropbox',
    name: 'Dropbox',
    categories: ['File Storage'],
    description: 'Cloud file storage and sync'
  },
  {
    slug: 'teams',
    name: 'Microsoft Teams',
    categories: ['Communication'],
    description: 'Microsoft team collaboration'
  },
  { slug: 'zoom', name: 'Zoom', categories: ['Communication'], description: 'Video conferencing' },
  {
    slug: 'calendly',
    name: 'Calendly',
    categories: ['Calendar'],
    description: 'Scheduling automation'
  },
  {
    slug: 'mailchimp',
    name: 'Mailchimp',
    categories: ['Marketing'],
    description: 'Email marketing platform'
  },
  {
    slug: 'stripe',
    name: 'Stripe',
    categories: ['Payments'],
    description: 'Online payment processing'
  },
  {
    slug: 'shopify',
    name: 'Shopify',
    categories: ['E-commerce'],
    description: 'E-commerce platform'
  },
  {
    slug: 'zendesk',
    name: 'Zendesk',
    categories: ['Customer Support'],
    description: 'Customer service software'
  },
  {
    slug: 'intercom',
    name: 'Intercom',
    categories: ['Customer Support'],
    description: 'Customer messaging platform'
  },
  {
    slug: 'twilio',
    name: 'Twilio',
    categories: ['Communication'],
    description: 'SMS and voice API'
  },
  {
    slug: 'sendgrid',
    name: 'SendGrid',
    categories: ['Email'],
    description: 'Email delivery service'
  },
  {
    slug: 'quickbooks',
    name: 'QuickBooks',
    categories: ['Finance'],
    description: 'Accounting software'
  },
  { slug: 'xero', name: 'Xero', categories: ['Finance'], description: 'Online accounting' },
  {
    slug: 'bamboohr',
    name: 'BambooHR',
    categories: ['HR'],
    description: 'HR software for small businesses'
  },
  { slug: 'lever', name: 'Lever', categories: ['HR'], description: 'Applicant tracking system' },
  {
    slug: 'greenhouse',
    name: 'Greenhouse',
    categories: ['HR'],
    description: 'Recruiting software'
  },
  {
    slug: 'webflow',
    name: 'Webflow',
    categories: ['Website'],
    description: 'Visual web design tool'
  },
  {
    slug: 'wordpress',
    name: 'WordPress',
    categories: ['Website'],
    description: 'Website and blog platform'
  },
  {
    slug: 'youtube',
    name: 'YouTube',
    categories: ['Social Media'],
    description: 'Video sharing platform'
  },
  {
    slug: 'twitter',
    name: 'X (Twitter)',
    categories: ['Social Media'],
    description: 'Social media platform'
  },
  {
    slug: 'linkedin',
    name: 'LinkedIn',
    categories: ['Social Media'],
    description: 'Professional networking'
  },
  {
    slug: 'facebook',
    name: 'Facebook',
    categories: ['Social Media'],
    description: 'Social media platform'
  },
  {
    slug: 'instagram',
    name: 'Instagram',
    categories: ['Social Media'],
    description: 'Photo and video sharing'
  },
  {
    slug: 'pagerduty',
    name: 'PagerDuty',
    categories: ['Developer Tools'],
    description: 'Incident management'
  },
  {
    slug: 'datadog',
    name: 'Datadog',
    categories: ['Developer Tools'],
    description: 'Monitoring and analytics'
  },
  {
    slug: 'vercel',
    name: 'Vercel',
    categories: ['Developer Tools'],
    description: 'Frontend deployment platform'
  },
  {
    slug: 'supabase',
    name: 'Supabase',
    categories: ['Developer Tools'],
    description: 'Open source Firebase alternative'
  },
  {
    slug: 'neon',
    name: 'Neon',
    categories: ['Developer Tools'],
    description: 'Serverless Postgres database'
  },
  {
    slug: 'elevenlabs',
    name: 'ElevenLabs',
    categories: ['AI'],
    description: 'AI voice generation'
  },
  { slug: 'tavily', name: 'Tavily', categories: ['AI'], description: 'AI web search API' },
  {
    slug: 'harvest',
    name: 'Harvest',
    categories: ['Productivity'],
    description: 'Time tracking and invoicing'
  },
  { slug: 'pipedrive', name: 'Pipedrive', categories: ['CRM'], description: 'Sales CRM' },
  {
    slug: 'basecamp',
    name: 'Basecamp',
    categories: ['Project Management'],
    description: 'Project management and communication'
  }
]

export async function listApps(): Promise<ComposioApp[]> {
  let key: string
  try {
    key = getApiKey()
  } catch {
    return POPULAR_APPS_FALLBACK
  }

  try {
    const url = 'https://backend.composio.dev/api/v2/toolkits?limit=200&sortBy=usage'
    const res = await fetch(url, { headers: { 'x-api-key': key } })
    if (!res.ok) return POPULAR_APPS_FALLBACK
    const data = (await res.json()) as { items?: any[] }
    const items = data.items ?? []
    if (items.length === 0) return POPULAR_APPS_FALLBACK
    return items
      .map((item: any) => ({
        slug: item.slug ?? item.name?.toLowerCase().replace(/\s+/g, '_') ?? '',
        name: item.displayName ?? item.name ?? '',
        categories: item.categories ?? [],
        description: (item.description ?? '').slice(0, 100)
      }))
      .filter((a: ComposioApp) => a.slug && a.name)
  } catch {
    return POPULAR_APPS_FALLBACK
  }
}
