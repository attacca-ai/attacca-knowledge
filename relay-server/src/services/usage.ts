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

export interface RequestLogEntry {
  id: number
  logged_at: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_write_tokens: number
  cache_read_tokens: number
  cost_usd: number
  message_count: number
}

export async function logRequest(
  licenseKeyHash: string,
  data: {
    model: string
    input_tokens: number
    output_tokens: number
    cache_write_tokens: number
    cache_read_tokens: number
    cost_usd: number
    message_count: number
  }
): Promise<void> {
  try {
    await query(
      `INSERT INTO request_logs
         (license_key_hash, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd, message_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        licenseKeyHash,
        data.model,
        data.input_tokens,
        data.output_tokens,
        data.cache_write_tokens,
        data.cache_read_tokens,
        data.cost_usd,
        data.message_count
      ]
    )
  } catch (err) {
    console.error('[usage] Failed to log request:', err)
  }
}

export async function getRecentRequests(
  licenseKeyHash: string,
  limit = 50
): Promise<RequestLogEntry[]> {
  try {
    const res = await query<RequestLogEntry>(
      `SELECT id, logged_at, model, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, cost_usd::float AS cost_usd, message_count
       FROM request_logs
       WHERE license_key_hash = $1
       ORDER BY logged_at DESC
       LIMIT $2`,
      [licenseKeyHash, limit]
    )
    return res.rows
  } catch (err) {
    console.error('[usage] Failed to get request logs:', err)
    return []
  }
}

export interface AggregateUsageStats {
  totalCostUsd: number
  totalRequests: number
  activeUsers: number
  usersAtLimit: number
  limitUsd: number
}

export async function getAggregateUsageStats(): Promise<AggregateUsageStats> {
  const monthYear = currentMonthYear()
  try {
    const res = await query<{
      total_cost_usd: string
      total_requests: string
      active_users: string
      users_at_limit: string
    }>(
      `SELECT
         COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd,
         COALESCE(SUM(request_count), 0) AS total_requests,
         COUNT(*) AS active_users,
         COUNT(*) FILTER (WHERE total_cost_usd >= $2) AS users_at_limit
       FROM usage_tracking
       WHERE month_year = $1`,
      [monthYear, MONTHLY_CEILING_USD]
    )
    const row = res.rows[0]
    return {
      totalCostUsd: parseFloat(row?.total_cost_usd ?? '0'),
      totalRequests: parseInt(row?.total_requests ?? '0'),
      activeUsers: parseInt(row?.active_users ?? '0'),
      usersAtLimit: parseInt(row?.users_at_limit ?? '0'),
      limitUsd: MONTHLY_CEILING_USD
    }
  } catch (err) {
    console.error('[usage] Failed to get aggregate stats:', err)
    return { totalCostUsd: 0, totalRequests: 0, activeUsers: 0, usersAtLimit: 0, limitUsd: MONTHLY_CEILING_USD }
  }
}
