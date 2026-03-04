import { query } from '../db/client.js'

interface TelemetryEvent {
  eventType: string
  payload: Record<string, unknown>
  timestamp: string
  anonymousId: string
}

export async function storeBatchEvents(events: TelemetryEvent[]): Promise<void> {
  if (events.length === 0) return

  // Batch insert using parameterized query
  const values: unknown[] = []
  const placeholders: string[] = []

  for (let i = 0; i < events.length; i++) {
    const offset = i * 4
    placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`)
    values.push(
      events[i].anonymousId,
      events[i].eventType,
      JSON.stringify(events[i].payload),
      events[i].timestamp
    )
  }

  await query(
    `INSERT INTO telemetry_events (anonymous_id, event_type, payload, client_timestamp)
     VALUES ${placeholders.join(', ')}`,
    values
  )
}

export async function deleteByAnonymousId(anonymousId: string): Promise<number> {
  const result = await query(
    'DELETE FROM telemetry_events WHERE anonymous_id = $1',
    [anonymousId]
  )
  return result.rowCount ?? 0
}

// ── Analytics Queries ──

export interface PermissionApprovalRate {
  eventType: string
  total: number
  approved: number
  denied: number
  approvalRate: number
}

export async function getPermissionApprovalRates(
  days = 30
): Promise<PermissionApprovalRate[]> {
  const result = await query<{
    event_type: string
    total: string
    approved: string
    denied: string
  }>(
    `SELECT
       event_type,
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE payload->>'resolution' = 'approved') as approved,
       COUNT(*) FILTER (WHERE payload->>'resolution' = 'denied') as denied
     FROM telemetry_events
     WHERE event_type LIKE 'permission.%.resolved'
       AND server_timestamp > NOW() - INTERVAL '${days} days'
     GROUP BY event_type
     ORDER BY event_type`
  )

  return result.rows.map((row) => ({
    eventType: row.event_type,
    total: parseInt(row.total),
    approved: parseInt(row.approved),
    denied: parseInt(row.denied),
    approvalRate: parseInt(row.total) > 0 ? parseInt(row.approved) / parseInt(row.total) : 0
  }))
}

export interface TrustProfileDistribution {
  profile: string
  count: number
}

export async function getTrustProfileDistribution(
  days = 30
): Promise<TrustProfileDistribution[]> {
  const result = await query<{ profile: string; count: string }>(
    `SELECT payload->>'to_profile' as profile, COUNT(DISTINCT anonymous_id) as count
     FROM telemetry_events
     WHERE event_type = 'trust.profile_changed'
       AND server_timestamp > NOW() - INTERVAL '${days} days'
     GROUP BY payload->>'to_profile'
     ORDER BY count DESC`
  )

  return result.rows.map((row) => ({
    profile: row.profile,
    count: parseInt(row.count)
  }))
}

export interface TaskCompletionStats {
  totalCompleted: number
  totalFailed: number
  avgDurationMs: number
  fallbackRate: number
}

export async function getTaskCompletionStats(days = 30): Promise<TaskCompletionStats> {
  const completedResult = await query<{ count: string; avg_duration: string }>(
    `SELECT COUNT(*) as count, AVG((payload->>'durationMs')::numeric) as avg_duration
     FROM telemetry_events
     WHERE event_type = 'agent.task.completed'
       AND server_timestamp > NOW() - INTERVAL '${days} days'`
  )

  const failedResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM telemetry_events
     WHERE event_type = 'agent.task.failed'
       AND server_timestamp > NOW() - INTERVAL '${days} days'`
  )

  const fallbackResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM telemetry_events
     WHERE event_type = 'agent.task.fallback_created'
       AND server_timestamp > NOW() - INTERVAL '${days} days'`
  )

  const totalCompleted = parseInt(completedResult.rows[0]?.count || '0')
  const totalFailed = parseInt(failedResult.rows[0]?.count || '0')
  const totalFallbacks = parseInt(fallbackResult.rows[0]?.count || '0')
  const total = totalCompleted + totalFailed

  return {
    totalCompleted,
    totalFailed,
    avgDurationMs: parseFloat(completedResult.rows[0]?.avg_duration || '0'),
    fallbackRate: total > 0 ? totalFallbacks / total : 0
  }
}
