import { query } from '../db/client.js'

const MONTHLY_CEILING_USD = 30

export interface UsageInfo {
  totalCostUsd: number
  limitUsd: number
  requestCount: number
  limitReached: boolean
  resetDate: string // first of next month
}

function currentMonthYear(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function nextMonthResetDate(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 1, 1)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

export async function getCumulativeCost(licenseKeyHash: string): Promise<UsageInfo> {
  const monthYear = currentMonthYear()

  try {
    const res = await query<{ total_cost_usd: string; request_count: number }>(
      `SELECT total_cost_usd, request_count FROM usage_tracking
       WHERE license_key_hash = $1 AND month_year = $2`,
      [licenseKeyHash, monthYear]
    )

    const totalCostUsd = res.rows.length > 0 ? parseFloat(res.rows[0].total_cost_usd) : 0
    const requestCount = res.rows.length > 0 ? res.rows[0].request_count : 0

    return {
      totalCostUsd,
      limitUsd: MONTHLY_CEILING_USD,
      requestCount,
      limitReached: totalCostUsd >= MONTHLY_CEILING_USD,
      resetDate: nextMonthResetDate()
    }
  } catch (err) {
    console.error('[usage] Failed to get cumulative cost:', err)
    return {
      totalCostUsd: 0,
      limitUsd: MONTHLY_CEILING_USD,
      requestCount: 0,
      limitReached: false,
      resetDate: nextMonthResetDate()
    }
  }
}

export async function addCost(licenseKeyHash: string, costUsd: number): Promise<void> {
  const monthYear = currentMonthYear()

  try {
    await query(
      `INSERT INTO usage_tracking (license_key_hash, month_year, total_cost_usd, request_count, last_request_at)
       VALUES ($1, $2, $3, 1, NOW())
       ON CONFLICT (license_key_hash, month_year) DO UPDATE SET
         total_cost_usd = usage_tracking.total_cost_usd + $3,
         request_count = usage_tracking.request_count + 1,
         last_request_at = NOW()`,
      [licenseKeyHash, monthYear, costUsd]
    )
  } catch (err) {
    console.error('[usage] Failed to add cost:', err)
  }
}

export async function isLimitReached(licenseKeyHash: string): Promise<boolean> {
  const usage = await getCumulativeCost(licenseKeyHash)
  return usage.limitReached
}
