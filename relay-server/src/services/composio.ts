import { createHash } from 'crypto'

// Composio SDK wrapper
// Entity ID = SHA-256 hash of license key (privacy-preserving)

const COMPOSIO_API_BASE = 'https://backend.composio.dev/api/v1'

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

function getApiKey(): string {
  const key = process.env.COMPOSIO_API_KEY
  if (!key) throw new Error('COMPOSIO_API_KEY not configured')
  return key
}

export async function initiateOAuth(
  licenseKeyHash: string,
  appName: string
): Promise<ComposioOAuthInitResult> {
  const entityId = getEntityId(licenseKeyHash)
  const apiKey = getApiKey()

  const response = await fetch(`${COMPOSIO_API_BASE}/connectedAccounts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify({
      integrationId: appName,
      entityId,
      redirectUri: 'https://attacca.app/oauth/callback'
    })
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Composio OAuth initiation failed: ${response.status} ${text}`)
  }

  const data = (await response.json()) as {
    connectedAccountId: string
    redirectUrl: string
  }

  return {
    connectionId: data.connectedAccountId,
    redirectUrl: data.redirectUrl
  }
}

export async function getConnectionStatus(
  connectionId: string
): Promise<ComposioConnectionStatus> {
  const apiKey = getApiKey()

  const response = await fetch(
    `${COMPOSIO_API_BASE}/connectedAccounts/${connectionId}`,
    {
      headers: { 'x-api-key': apiKey }
    }
  )

  if (!response.ok) {
    throw new Error(`Composio status check failed: ${response.status}`)
  }

  const data = (await response.json()) as {
    id: string
    status: string
    appName: string
  }

  return {
    id: data.id,
    status: data.status as ComposioConnectionStatus['status'],
    appName: data.appName
  }
}

export async function proxyToolAction(
  licenseKeyHash: string,
  actionName: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const entityId = getEntityId(licenseKeyHash)
  const apiKey = getApiKey()

  const response = await fetch(`${COMPOSIO_API_BASE}/actions/${actionName}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
    body: JSON.stringify({
      entityId,
      input: params
    })
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Composio action failed: ${response.status} ${text}`)
  }

  return response.json()
}

export async function getConnectedApps(
  licenseKeyHash: string
): Promise<string[]> {
  const entityId = getEntityId(licenseKeyHash)
  const apiKey = getApiKey()

  const response = await fetch(
    `${COMPOSIO_API_BASE}/connectedAccounts?entityId=${entityId}&status=active`,
    {
      headers: { 'x-api-key': apiKey }
    }
  )

  if (!response.ok) return []

  const data = (await response.json()) as {
    items: Array<{ appName: string }>
  }

  return data.items.map((item) => item.appName)
}
