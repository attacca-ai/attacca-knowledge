import { createHash } from 'crypto'
import { Composio } from '@composio/core'

// Composio SDK v3 wrapper
// Entity ID = SHA-256 hash of license key (privacy-preserving)

const CALLBACK_URL = 'https://attacca.app/oauth/callback'

// Map frontend app slugs → Composio toolkit slugs
const APP_SLUG_MAP: Record<string, string> = {
  'google-calendar': 'googlecalendar',
  'google-drive': 'googledrive',
  'outlook-email': 'outlook',
  'outlook-calendar': 'outlook',
}

function toComposioSlug(appName: string): string {
  return APP_SLUG_MAP[appName] ?? appName
}

export function getEntityId(licenseKeyHash: string): string {
  return createHash('sha256').update(`composio:${licenseKeyHash}`).digest('hex').slice(0, 32)
}

interface ComposioOAuthInitResult {
  connectionId: string
  redirectUrl: string
}

interface ComposioConnectionStatus {
  id: string
  status: 'initiated' | 'active' | 'failed' | 'expired'
  appName: string
}

function getClient() {
  const key = process.env.COMPOSIO_API_KEY
  if (!key) throw new Error('COMPOSIO_API_KEY not configured')
  return new Composio({ apiKey: key }).getClient()
}

export async function initiateOAuth(
  licenseKeyHash: string,
  appName: string
): Promise<ComposioOAuthInitResult> {
  const entityId = getEntityId(licenseKeyHash)
  const client = getClient()

  const composioSlug = toComposioSlug(appName)

  // Step 1: create (or get) a Composio-managed auth config for this app
  const authRes = await client.authConfigs.create({
    toolkit: { slug: composioSlug },
    type: 'use_composio_managed_auth'
  } as any)

  const authConfigId = (authRes as any)?.auth_config?.id
  if (!authConfigId) {
    throw new Error(`Failed to get auth config for app: ${composioSlug}`)
  }

  // Step 2: create a connection link the user visits to authorize
  const linkRes = await client.link.create({
    auth_config_id: authConfigId,
    user_id: entityId,
    callback_url: CALLBACK_URL
  } as any)

  const link = linkRes as any

  return {
    connectionId: link.connected_account_id,
    redirectUrl: link.redirect_url ?? ''
  }
}

export async function getConnectionStatus(
  connectionId: string
): Promise<ComposioConnectionStatus> {
  const client = getClient()

  const result = await client.connectedAccounts.retrieve(connectionId as any)
  const data = result as any

  return {
    id: data.id ?? connectionId,
    status: (data.status ?? '').toLowerCase() as ComposioConnectionStatus['status'],
    appName: data.toolkit?.slug ?? data.appName ?? ''
  }
}

export async function proxyToolAction(
  licenseKeyHash: string,
  actionName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const entityId = getEntityId(licenseKeyHash)
  const client = getClient()

  const result = await client.tools.execute(actionName, {
    user_id: entityId,
    arguments: params
  } as any)

  return result
}

/**
 * Execute an action via the Composio v3 REST API directly (bypasses SDK action registry).
 * Useful when the SDK does not have an action registered but the Composio backend does.
 */
export async function proxyToolActionV3(
  licenseKeyHash: string,
  actionName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  return executeActionDirect(getEntityId(licenseKeyHash), actionName, params)
}

/**
 * Same as proxyToolActionV3 but accepts a pre-computed entityId directly.
 * Used by agent.ts which receives entityId from the skill (not the license hash).
 */
// Known toolkit versions — the v3 API requires version for manual execution.
// Update when Composio releases new toolkit versions.
const TOOLKIT_VERSIONS: Record<string, string> = {
  outlook: '20260309_00',
}

function getToolkitVersion(actionName: string): string | undefined {
  const prefix = actionName.split('_')[0].toLowerCase()
  return TOOLKIT_VERSIONS[prefix]
}

export async function executeActionDirect(
  entityId: string,
  actionName: string,
  params: Record<string, unknown>,
  version?: string
): Promise<unknown> {
  const key = process.env.COMPOSIO_API_KEY
  if (!key) throw new Error('COMPOSIO_API_KEY not configured')

  const resolvedVersion = version ?? getToolkitVersion(actionName)

  // Correct Composio v3 REST endpoint (from @composio/client source):
  // POST /api/v3/tools/execute/{toolSlug}
  // Body uses user_id + arguments (same field names as client.tools.execute())
  // NOTE: NOT /api/v3/actions/{slug}/execute (wrong path) NOR /api/v1/... (deprecated, returns 410)
  const url = `https://backend.composio.dev/api/v3/tools/execute/${encodeURIComponent(actionName)}`
  const body: Record<string, unknown> = { user_id: entityId, arguments: params }
  if (resolvedVersion) body.version = resolvedVersion
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

/**
 * List Outlook calendar events using the Microsoft Graph API directly via
 * the Composio connected account OAuth token. Falls back to SDK execution.
 */
/**
 * Execute OUTLOOK_LIST_EVENTS via the high-level Composio SDK (composio.getEntity().execute()).
 * This uses a different execution path than client.tools.execute() and may resolve 404s.
 * Params follow Composio docs: calendar_id, top, filter, select[], orderby[]
 */
export async function listOutlookEventsByEntityId(
  entityId: string,
  calendarId: string | undefined,
  params: Record<string, unknown>
): Promise<unknown> {
  const input: Record<string, unknown> = {
    top: params.top ?? 50,
    select: params.select ?? ['subject', 'start', 'end', 'attendees', 'id', 'isAllDay'],
    orderby: params.orderby ?? ['start/dateTime'],
  }
  if (calendarId) input.calendar_id = calendarId
  if (params.filter) input.filter = params.filter

  // entity.execute() also fails with Tool_ToolNotFound for OUTLOOK_LIST_EVENTS in SDK v0.6.x.
  // Use the v3 REST API directly — the action exists on the backend, just not in the SDK registry.
  console.log(`[composio] listOutlookEvents v3REST OUTLOOK_LIST_EVENTS calendar_id=${calendarId?.slice(0, 20)}...`)
  return executeActionDirect(entityId, 'OUTLOOK_LIST_EVENTS', input)
}

export async function listOutlookEvents(
  licenseKeyHash: string,
  calendarId: string | undefined,
  params: Record<string, unknown>
): Promise<unknown> {
  return listOutlookEventsByEntityId(getEntityId(licenseKeyHash), calendarId, params)
}

export async function listAppActions(
  appSlug: string
): Promise<Array<{ name: string; description: string }>> {
  const key = process.env.COMPOSIO_API_KEY
  if (!key) throw new Error('COMPOSIO_API_KEY not configured')

  // Primary: use Composio SDK getRawComposioTools — returns actual available action slugs
  try {
    const composio = new Composio({ apiKey: key })
    const tools = await (composio as any).tools.getRawComposioTools({ toolkits: [appSlug], limit: 200 })
    const items: Array<{ name: string; description: string }> = []
    for (const t of (tools ?? [])) {
      const name = t?.slug ?? t?.name ?? ''
      if (name) items.push({ name, description: (t?.description ?? '').slice(0, 120) })
    }
    if (items.length > 0) {
      console.log(`[composio] listAppActions SDK(${appSlug}): ${items.length} actions`)
      // Debug: log email/message-related actions for troubleshooting
      const emailActions = items.filter(a => /message|mail|email|inbox/i.test(a.name))
      if (emailActions.length > 0) {
        console.log(`[composio] listAppActions SDK(${appSlug}) email actions: ${emailActions.map(a => a.name).join(', ')}`)
      }
      return items
    }
  } catch (e) {
    console.log(`[composio] listAppActions SDK(${appSlug}) failed: ${e instanceof Error ? e.message : e}`)
  }

  // v2 REST API — /api/v2/actions?toolkit=<slug>
  try {
    const v2Url = `https://backend.composio.dev/api/v2/actions?toolkit=${encodeURIComponent(appSlug)}&limit=200`
    const v2Res = await fetch(v2Url, { headers: { 'x-api-key': key } })
    if (v2Res.ok) {
      const data = await v2Res.json() as { items?: Array<{ name?: string; description?: string }> }
      const items = (data.items ?? []).map((a) => ({
        name: a.name ?? '',
        description: (a.description ?? '').slice(0, 120)
      })).filter((a) => a.name)
      if (items.length > 0) {
        console.log(`[composio] listAppActions v2REST(${appSlug}): ${items.length} actions`)
        return items
      }
    }
  } catch (e) {
    console.log(`[composio] listAppActions v2REST(${appSlug}) failed: ${e instanceof Error ? e.message : e}`)
  }

  // v1 fallback (may return 410 for some apps)
  const v1Url = `https://backend.composio.dev/api/v1/actions?apps=${encodeURIComponent(appSlug)}&limit=200&filterImportantActions=false`
  const v1Res = await fetch(v1Url, { headers: { 'x-api-key': key } })
  if (!v1Res.ok) throw new Error(`Composio actions API error: ${v1Res.status}`)
  const v1Data = await v1Res.json() as { items?: Array<{ name?: string; description?: string }> }
  return (v1Data.items ?? []).map((a) => ({
    name: a.name ?? '',
    description: (a.description ?? '').slice(0, 120)
  })).filter((a) => a.name)
}

export async function getConnectedApps(
  licenseKeyHash: string
): Promise<string[]> {
  const entityId = getEntityId(licenseKeyHash)
  const client = getClient()

  const result = await client.connectedAccounts.list({ user_id: entityId } as any)
  const items: any[] = (result as any)?.items ?? []

  return items
    .filter((c) => (c.status ?? '').toUpperCase() === 'ACTIVE')
    .map((c) => c.toolkit?.slug ?? c.appName ?? '')
    .filter(Boolean)
}

export interface ComposioApp {
  slug: string
  name: string
  categories: string[]
  description: string
}

// Static fallback list of popular Composio apps (used if API is unavailable)
const POPULAR_APPS_FALLBACK: ComposioApp[] = [
  { slug: 'github', name: 'GitHub', categories: ['Developer Tools'], description: 'Code hosting and version control' },
  { slug: 'gmail', name: 'Gmail', categories: ['Email'], description: 'Google email service' },
  { slug: 'slack', name: 'Slack', categories: ['Communication'], description: 'Team messaging platform' },
  { slug: 'notion', name: 'Notion', categories: ['Productivity'], description: 'Docs and knowledge base' },
  { slug: 'googlesheets', name: 'Google Sheets', categories: ['Productivity'], description: 'Online spreadsheets' },
  { slug: 'googledrive', name: 'Google Drive', categories: ['File Storage'], description: 'Cloud file storage' },
  { slug: 'googlecalendar', name: 'Google Calendar', categories: ['Calendar'], description: 'Calendar and scheduling' },
  { slug: 'hubspot', name: 'HubSpot', categories: ['CRM'], description: 'CRM and marketing platform' },
  { slug: 'salesforce', name: 'Salesforce', categories: ['CRM'], description: 'Enterprise CRM' },
  { slug: 'jira', name: 'Jira', categories: ['Project Management'], description: 'Issue and project tracking' },
  { slug: 'trello', name: 'Trello', categories: ['Project Management'], description: 'Kanban boards' },
  { slug: 'asana', name: 'Asana', categories: ['Project Management'], description: 'Project and task management' },
  { slug: 'clickup', name: 'ClickUp', categories: ['Project Management'], description: 'All-in-one productivity app' },
  { slug: 'linear', name: 'Linear', categories: ['Project Management'], description: 'Issue tracking for software teams' },
  { slug: 'monday', name: 'Monday.com', categories: ['Project Management'], description: 'Work OS platform' },
  { slug: 'airtable', name: 'Airtable', categories: ['Database'], description: 'Spreadsheet-database hybrid' },
  { slug: 'outlook', name: 'Outlook', categories: ['Email', 'Calendar'], description: 'Microsoft email and calendar' },
  { slug: 'one_drive', name: 'OneDrive', categories: ['File Storage'], description: 'Microsoft cloud storage' },
  { slug: 'dropbox', name: 'Dropbox', categories: ['File Storage'], description: 'Cloud file storage and sync' },
  { slug: 'teams', name: 'Microsoft Teams', categories: ['Communication'], description: 'Microsoft team collaboration' },
  { slug: 'zoom', name: 'Zoom', categories: ['Communication'], description: 'Video conferencing' },
  { slug: 'calendly', name: 'Calendly', categories: ['Calendar'], description: 'Scheduling automation' },
  { slug: 'mailchimp', name: 'Mailchimp', categories: ['Marketing'], description: 'Email marketing platform' },
  { slug: 'stripe', name: 'Stripe', categories: ['Payments'], description: 'Online payment processing' },
  { slug: 'shopify', name: 'Shopify', categories: ['E-commerce'], description: 'E-commerce platform' },
  { slug: 'zendesk', name: 'Zendesk', categories: ['Customer Support'], description: 'Customer service software' },
  { slug: 'intercom', name: 'Intercom', categories: ['Customer Support'], description: 'Customer messaging platform' },
  { slug: 'twilio', name: 'Twilio', categories: ['Communication'], description: 'SMS and voice API' },
  { slug: 'sendgrid', name: 'SendGrid', categories: ['Email'], description: 'Email delivery service' },
  { slug: 'quickbooks', name: 'QuickBooks', categories: ['Finance'], description: 'Accounting software' },
  { slug: 'xero', name: 'Xero', categories: ['Finance'], description: 'Online accounting' },
  { slug: 'bamboohr', name: 'BambooHR', categories: ['HR'], description: 'HR software for small businesses' },
  { slug: 'lever', name: 'Lever', categories: ['HR'], description: 'Applicant tracking system' },
  { slug: 'greenhouse', name: 'Greenhouse', categories: ['HR'], description: 'Recruiting software' },
  { slug: 'webflow', name: 'Webflow', categories: ['Website'], description: 'Visual web design tool' },
  { slug: 'wordpress', name: 'WordPress', categories: ['Website'], description: 'Website and blog platform' },
  { slug: 'youtube', name: 'YouTube', categories: ['Social Media'], description: 'Video sharing platform' },
  { slug: 'twitter', name: 'X (Twitter)', categories: ['Social Media'], description: 'Social media platform' },
  { slug: 'linkedin', name: 'LinkedIn', categories: ['Social Media'], description: 'Professional networking' },
  { slug: 'facebook', name: 'Facebook', categories: ['Social Media'], description: 'Social media platform' },
  { slug: 'instagram', name: 'Instagram', categories: ['Social Media'], description: 'Photo and video sharing' },
  { slug: 'pagerduty', name: 'PagerDuty', categories: ['Developer Tools'], description: 'Incident management' },
  { slug: 'datadog', name: 'Datadog', categories: ['Developer Tools'], description: 'Monitoring and analytics' },
  { slug: 'vercel', name: 'Vercel', categories: ['Developer Tools'], description: 'Frontend deployment platform' },
  { slug: 'supabase', name: 'Supabase', categories: ['Developer Tools'], description: 'Open source Firebase alternative' },
  { slug: 'neon', name: 'Neon', categories: ['Developer Tools'], description: 'Serverless Postgres database' },
  { slug: 'elevenlabs', name: 'ElevenLabs', categories: ['AI'], description: 'AI voice generation' },
  { slug: 'tavily', name: 'Tavily', categories: ['AI'], description: 'AI web search API' },
  { slug: 'harvest', name: 'Harvest', categories: ['Productivity'], description: 'Time tracking and invoicing' },
  { slug: 'pipedrive', name: 'Pipedrive', categories: ['CRM'], description: 'Sales CRM' },
  { slug: 'basecamp', name: 'Basecamp', categories: ['Project Management'], description: 'Project management and communication' },
]

export async function listApps(): Promise<ComposioApp[]> {
  const key = process.env.COMPOSIO_API_KEY
  if (!key) return POPULAR_APPS_FALLBACK

  try {
    const url = 'https://backend.composio.dev/api/v2/toolkits?limit=200&sortBy=usage'
    const res = await fetch(url, { headers: { 'x-api-key': key } })
    if (!res.ok) return POPULAR_APPS_FALLBACK
    const data = await res.json() as { items?: any[] }
    const items = data.items ?? []
    if (items.length === 0) return POPULAR_APPS_FALLBACK
    return items.map((item: any) => ({
      slug: item.slug ?? item.name?.toLowerCase().replace(/\s+/g, '_') ?? '',
      name: item.displayName ?? item.name ?? '',
      categories: item.categories ?? [],
      description: (item.description ?? '').slice(0, 100),
    })).filter((a: ComposioApp) => a.slug && a.name)
  } catch {
    return POPULAR_APPS_FALLBACK
  }
}
