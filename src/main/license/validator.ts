import { verifyLicenseKey } from './gumroad'
import { loadLicense, saveLicense, type StoredLicense } from './store'

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const GRACE_PERIOD_MS = 7 * ONE_DAY_MS

export type LicenseStatus = 'unchecked' | 'valid' | 'invalid' | 'expired' | 'grace'

interface ValidationResult {
  status: LicenseStatus
  plan?: string
  error?: string
  lastValidated?: number
}

let revalidationTimer: ReturnType<typeof setInterval> | null = null

export async function checkExistingLicense(): Promise<ValidationResult> {
  const stored = loadLicense()
  if (!stored) {
    return { status: 'unchecked' }
  }

  const timeSinceValidation = Date.now() - stored.validatedAt

  // If validated within 24 hours, accept without re-check
  if (timeSinceValidation < ONE_DAY_MS) {
    return {
      status: 'valid',
      plan: stored.plan,
      lastValidated: stored.validatedAt
    }
  }

  // Need re-validation
  const result = await verifyLicenseKey(stored.key)

  if (result.success) {
    // Update validation timestamp
    saveLicense({
      ...stored,
      plan: result.plan || stored.plan,
      validatedAt: Date.now()
    })
    return {
      status: 'valid',
      plan: result.plan || stored.plan,
      lastValidated: Date.now()
    }
  }

  // Re-validation failed — check grace period
  if (timeSinceValidation < GRACE_PERIOD_MS) {
    return {
      status: 'grace',
      plan: stored.plan,
      error: result.error,
      lastValidated: stored.validatedAt
    }
  }

  // Past grace period
  return {
    status: 'expired',
    error: result.error || 'License validation failed and grace period has expired'
  }
}

export async function validateNewKey(
  key: string
): Promise<ValidationResult> {
  const result = await verifyLicenseKey(key)

  if (!result.success) {
    return {
      status: 'invalid',
      error: result.error
    }
  }

  const stored: StoredLicense = {
    key,
    plan: result.plan || 'monthly',
    email: result.email,
    validatedAt: Date.now()
  }

  saveLicense(stored)

  return {
    status: 'valid',
    plan: stored.plan,
    lastValidated: stored.validatedAt
  }
}

export function startDailyRevalidation(): void {
  stopDailyRevalidation()
  // Check every 6 hours
  revalidationTimer = setInterval(async () => {
    const result = await checkExistingLicense()
    if (result.status !== 'valid' && result.status !== 'grace') {
      console.warn('[license] Revalidation failed:', result.error)
    }
  }, 6 * 60 * 60 * 1000)
}

export function stopDailyRevalidation(): void {
  if (revalidationTimer) {
    clearInterval(revalidationTimer)
    revalidationTimer = null
  }
}
