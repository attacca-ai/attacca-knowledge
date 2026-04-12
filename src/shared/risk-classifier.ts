/**
 * Shared risk classifier — single source of truth for action risk tiers.
 * Imported by both main (permission-gate) and renderer (permission-engine).
 *
 * Two classification functions exist because the two processes operate on
 * different namespaces:
 *   - `classifyComposioAction(name)` — main-process enforcement, keyed on
 *     Composio action names like `GMAIL_SEND_EMAIL`. Uses verb-prefix heuristic.
 *   - `classifyAppAction(type)` — renderer-side display, keyed on app-level
 *     action types like `send.email`. Uses explicit floor map + context
 *     escalation.
 *
 * The `context.label` parameter on both functions is reserved for Spec B PR B3
 * (Shared-account escalation). B1 accepts it but does not apply escalation —
 * this keeps B1 a pure refactor with zero behavior change.
 */

export type RiskTier = 'low' | 'medium' | 'high'

export interface RiskContext {
  /** True if the action targets a shared resource (calendar, drive folder, etc.) */
  shared?: boolean
  /** True if the action touches a calendar event with attendees */
  hasAttendees?: boolean
  /**
   * Connection label (Work | Personal | Shared) — set by Spec B PR B3.
   * Reserved: not yet used for escalation in B1.
   */
  label?: 'Work' | 'Personal' | 'Shared'
}

export const TIER_ORDER: Record<RiskTier, number> = {
  low: 0,
  medium: 1,
  high: 2
}

// ── Composio action classifier (main-process enforcement) ────────────────

export const HIGH_VERBS = ['SEND', 'DELETE', 'REMOVE', 'POST', 'CANCEL']
export const LOW_VERBS = [
  'GET',
  'LIST',
  'FETCH',
  'FIND',
  'READ',
  'SEARCH',
  'CHECK',
  'DISCOVER',
  'COUNT'
]

/**
 * Classify a Composio action name (e.g. `GMAIL_SEND_EMAIL`) by verb-prefix.
 * High verbs (SEND/DELETE/REMOVE/POST/CANCEL) → high.
 * Low verbs (GET/LIST/FETCH/FIND/READ/SEARCH/CHECK/DISCOVER/COUNT) → low.
 * Everything else (CREATE/UPDATE/MODIFY/ARCHIVE/LABEL/etc.) → medium.
 * The `_DISCOVER_ACTIONS` meta-action is classified as low.
 *
 * Context escalation (Spec B PR B3):
 *   - `label === 'Shared'` escalates by exactly one tier (low → medium, medium → high).
 *     `high` stays `high` — the cap prevents compounding.
 *   - The escalation is additive but capped at `high`. See DVR-5.
 */
export function classifyComposioAction(
  actionName: string,
  context?: RiskContext
): RiskTier {
  let tier: RiskTier
  if (actionName === '_DISCOVER_ACTIONS') {
    tier = 'low'
  } else {
    const parts = actionName.toUpperCase().split('_')
    if (parts.some((p) => HIGH_VERBS.includes(p))) tier = 'high'
    else if (parts.some((p) => LOW_VERBS.includes(p))) tier = 'low'
    else tier = 'medium'
  }

  // Shared-label escalation: one tier up, capped at high. Applied after the
  // base classification so the floor is preserved.
  if (context?.label === 'Shared') {
    if (tier === 'low') tier = 'medium'
    else if (tier === 'medium') tier = 'high'
    // high stays high — DVR-5 cap
  }

  return tier
}

// ── App-level action classifier (renderer display) ──────────────────────

/**
 * Static risk floor map for app-level action types.
 * Agent can escalate via context but never downgrade below the floor.
 * Source: spec RD3. Any change here affects how the renderer displays risk
 * tiers in the ApprovalDialog and related UI.
 */
export const APP_ACTION_RISK_FLOOR: Record<string, RiskTier> = {
  // Read operations
  'read.calendar': 'low',
  'read.email': 'low',
  'read.tasks': 'low',
  'read.files': 'low',
  'read.messages': 'low',

  // Calendar
  'create.calendar.personal': 'medium',
  'create.calendar.shared': 'high',
  'update.calendar': 'high',
  'delete.calendar': 'high',
  'reschedule.meeting': 'high',

  // Email
  'draft.email': 'medium',
  'send.email': 'high',
  'archive.email': 'medium',
  'label.email': 'medium',

  // Project Management
  'create.task': 'medium',
  'update.task': 'medium',
  'delete.task': 'high',

  // File Storage
  'upload.file': 'medium',
  'create.file': 'medium',
  'modify.file.personal': 'medium',
  'modify.file.shared': 'high',
  'delete.file': 'high',

  // Communication
  'post.message.channel': 'high',
  'post.message.dm': 'high',
  'react.message': 'low',
  'update.status': 'medium'
}

export interface AppActionClassification {
  actionType: string
  tier: RiskTier
  floorTier: RiskTier
  escalated: boolean
}

/**
 * Classify an app-level action type. Unknown actions default to `high`.
 * Context escalation:
 *   - `shared: true` escalates medium/low to high
 *   - `hasAttendees: true` on a calendar action escalates medium/low to high
 */
export function classifyAppAction(
  actionType: string,
  context?: RiskContext
): AppActionClassification {
  const floorTier: RiskTier = APP_ACTION_RISK_FLOOR[actionType] ?? 'high'

  let tier = floorTier

  if (context?.shared && tier !== 'high') {
    tier = 'high'
  }

  if (context?.hasAttendees && actionType.includes('calendar') && tier !== 'high') {
    tier = 'high'
  }

  return {
    actionType,
    tier,
    floorTier,
    escalated: TIER_ORDER[tier] > TIER_ORDER[floorTier]
  }
}

// ── Tier UI helpers ─────────────────────────────────────────────────────

export function getTierColor(tier: RiskTier): string {
  switch (tier) {
    case 'low':
      return 'text-green-600 dark:text-green-400'
    case 'medium':
      return 'text-yellow-600 dark:text-yellow-400'
    case 'high':
      return 'text-red-600 dark:text-red-400'
  }
}

export function getTierBgColor(tier: RiskTier): string {
  switch (tier) {
    case 'low':
      return 'bg-green-500/10 border-green-500/30'
    case 'medium':
      return 'bg-yellow-500/10 border-yellow-500/30'
    case 'high':
      return 'bg-red-500/10 border-red-500/30'
  }
}

export function getTierLabel(tier: RiskTier): string {
  switch (tier) {
    case 'low':
      return 'Low Risk'
    case 'medium':
      return 'Medium Risk'
    case 'high':
      return 'High Risk — Requires Approval'
  }
}
