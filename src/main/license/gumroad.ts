import { net } from 'electron'

const GUMROAD_VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify'
const PRODUCT_ID = 'attacca'

export interface GumroadLicenseResult {
  success: boolean
  plan?: 'monthly' | 'yearly' | 'lifetime'
  email?: string
  error?: string
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
    test?: boolean
  }
  message?: string
}

export async function verifyLicenseKey(licenseKey: string): Promise<GumroadLicenseResult> {
  try {
    const body = new URLSearchParams({
      product_id: PRODUCT_ID,
      license_key: licenseKey,
      increment_uses_count: 'false'
    })

    const response = await net.fetch(GUMROAD_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    })

    const data = (await response.json()) as GumroadResponse

    if (!data.success) {
      return { success: false, error: data.message || 'Invalid license key' }
    }

    const purchase = data.purchase
    if (!purchase) {
      return { success: false, error: 'No purchase data found' }
    }

    // Check if refunded
    if (purchase.refunded) {
      return { success: false, error: 'This license has been refunded' }
    }

    // Check if subscription cancelled
    if (purchase.subscription_cancelled_at) {
      return { success: false, error: 'This subscription has been cancelled' }
    }

    // Check if subscription failed
    if (purchase.subscription_failed_at) {
      return { success: false, error: 'This subscription payment has failed' }
    }

    // Determine plan type from variants or default
    const plan = determinePlan(purchase.variants)

    return {
      success: true,
      plan,
      email: purchase.email
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error'
    return { success: false, error: `Could not verify license: ${message}` }
  }
}

function determinePlan(variants?: string): 'monthly' | 'yearly' | 'lifetime' {
  if (!variants) return 'monthly'
  const lower = variants.toLowerCase()
  if (lower.includes('lifetime')) return 'lifetime'
  if (lower.includes('yearly') || lower.includes('annual')) return 'yearly'
  return 'monthly'
}
