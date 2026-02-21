import { createHash } from 'crypto'
import { query } from '../db/client.js'

const GUMROAD_VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify'
const PRODUCT_ID = process.env.GUMROAD_PRODUCT_ID || 'GHIxOJd-ONuldh9bhDQkYQ=='
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

export interface LicenseInfo {
  valid: boolean
  plan: string
  email?: string
  keyHash: string
}

export function hashLicenseKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

export async function verifyLicense(licenseKey: string): Promise<LicenseInfo> {
  const keyHash = hashLicenseKey(licenseKey)

  // Check cache first
  const cached = await getCachedLicense(keyHash)
  if (cached) return cached

  // Verify with Gumroad
  const result = await verifyWithGumroad(licenseKey)
  result.keyHash = keyHash

  // Cache the result
  await cacheLicenseResult(result)

  return result
}

async function getCachedLicense(keyHash: string): Promise<LicenseInfo | null> {
  try {
    const res = await query<{
      plan: string
      email: string | null
      valid: boolean
    }>(
      `SELECT plan, email, valid FROM license_cache
       WHERE license_key_hash = $1 AND expires_at > NOW()`,
      [keyHash]
    )

    if (res.rows.length === 0) return null

    const row = res.rows[0]
    return {
      valid: row.valid,
      plan: row.plan,
      email: row.email ?? undefined,
      keyHash
    }
  } catch {
    return null
  }
}

async function cacheLicenseResult(info: LicenseInfo): Promise<void> {
  try {
    await query(
      `INSERT INTO license_cache (license_key_hash, plan, email, valid, verified_at, expires_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW() + INTERVAL '1 hour')
       ON CONFLICT (license_key_hash) DO UPDATE SET
         plan = $2, email = $3, valid = $4, verified_at = NOW(),
         expires_at = NOW() + INTERVAL '1 hour'`,
      [info.keyHash, info.plan, info.email ?? null, info.valid]
    )
  } catch (err) {
    console.error('[license] Cache write failed:', err)
  }
}

export async function invalidateCache(keyHash: string): Promise<void> {
  try {
    await query('DELETE FROM license_cache WHERE license_key_hash = $1', [keyHash])
  } catch {
    // best effort
  }
}

interface GumroadResponse {
  success: boolean
  purchase?: {
    product_id: string
    license_key: string
    email: string
    refunded: boolean
    subscription_cancelled_at: string | null
    subscription_failed_at: string | null
    variants?: string
  }
  message?: string
}

async function verifyWithGumroad(licenseKey: string): Promise<LicenseInfo> {
  const keyHash = hashLicenseKey(licenseKey)

  try {
    const body = new URLSearchParams({
      product_id: PRODUCT_ID,
      license_key: licenseKey,
      increment_uses_count: 'false'
    })

    const response = await fetch(GUMROAD_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    })

    // Invalidate cache on 4xx
    if (response.status >= 400 && response.status < 500) {
      await invalidateCache(keyHash)
    }

    const data = (await response.json()) as GumroadResponse

    if (!data.success || !data.purchase) {
      return { valid: false, plan: 'none', keyHash }
    }

    const p = data.purchase
    if (p.refunded || p.subscription_cancelled_at || p.subscription_failed_at) {
      return { valid: false, plan: 'none', keyHash }
    }

    const plan = determinePlan(p.variants)
    return { valid: true, plan, email: p.email, keyHash }
  } catch (err) {
    console.error('[license] Gumroad verification failed:', err)
    return { valid: false, plan: 'none', keyHash }
  }
}

function determinePlan(variants?: string): string {
  if (!variants) return 'monthly'
  const lower = variants.toLowerCase()
  if (lower.includes('lifetime')) return 'lifetime'
  if (lower.includes('yearly') || lower.includes('annual')) return 'yearly'
  return 'monthly'
}
