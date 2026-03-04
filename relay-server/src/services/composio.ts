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

export async function listAppActions(
  appSlug: string
): Promise<Array<{ name: string; description: string }>> {
  const key = process.env.COMPOSIO_API_KEY
  if (!key) throw new Error('COMPOSIO_API_KEY not configured')

  const url = `https://backend.composio.dev/api/v1/actions?apps=${encodeURIComponent(appSlug)}&limit=100&filterImportantActions=false`
  const res = await fetch(url, { headers: { 'x-api-key': key } })
  if (!res.ok) throw new Error(`Composio actions API error: ${res.status}`)
  const data = await res.json() as { items?: Array<{ name?: string; description?: string }> }
  return (data.items ?? []).map((a) => ({
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
