/**
 * Permission gate for Composio tool calls.
 * Classifies actions by risk tier, checks trust profile, and gates execution
 * by sending approval requests to the renderer via IPC.
 */

import { randomUUID } from 'crypto'
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { getMainWindow } from '../window/main-window'
import {
  classifyComposioAction,
  type RiskTier,
  type RiskContext
} from '../../shared/risk-classifier'

// ── Risk classification ──

type TrustProfile = 'cautious' | 'balanced' | 'autonomous'

function getTrustProfile(): TrustProfile {
  const filePath = join(app.getPath('userData'), 'settings.json')
  if (!existsSync(filePath)) return 'cautious'
  try {
    const settings = JSON.parse(readFileSync(filePath, 'utf-8'))
    const p = settings.trustProfile
    if (p === 'cautious' || p === 'balanced' || p === 'autonomous') return p
  } catch {
    /* use default */
  }
  return 'cautious'
}

function needsGate(tier: RiskTier, profile: TrustProfile): boolean {
  if (tier === 'low') return false
  if (tier === 'medium') return profile === 'cautious'
  return true // high always gated
}

// ── Toolkit name helper (mirrors server.ts) ──

const TOOLKIT_NAMES: Record<string, string> = {
  gmail: 'Gmail',
  googlecalendar: 'Google Calendar',
  outlook: 'Outlook',
  slack: 'Slack',
  trello: 'Trello',
  clickup: 'ClickUp',
  asana: 'Asana',
  notion: 'Notion',
  googledrive: 'Google Drive',
  onedrive: 'OneDrive',
  dropbox: 'Dropbox',
  teams: 'Teams',
  telegram: 'Telegram',
  github: 'GitHub'
}

function toolkitFromAction(actionName: string): string {
  const prefix = (actionName.split('_')[0] ?? '').toLowerCase()
  return TOOLKIT_NAMES[prefix] ?? (prefix || 'Unknown')
}

function describeAction(actionName: string): string {
  const toolkit = toolkitFromAction(actionName)
  const prefix = actionName.split('_')[0] ?? ''
  const rest = actionName.slice(prefix.length + 1)
  const readable = rest.toLowerCase().replace(/_/g, ' ')
  return `${readable.charAt(0).toUpperCase() + readable.slice(1)} (${toolkit})`
}

// ── Standing approvals ─────────────────────────────────────────────────
//
// In-memory Map hydrated from `settings.json.standingApprovals` on first read.
// Guardrails (spec-b.md DVR-1..4):
//   DVR-1: never persist high-tier grants
//   DVR-2: only persist when trust profile is `balanced`
//   DVR-3: filter expired on load
//   DVR-4: clear all grants atomically on trust-profile change
//
// Expired entries are removed lazy (on read) and on boot load. Revocation
// (from Settings UI) updates both the in-memory Map and the disk file.

const STANDING_DURATION_MS = 30 * 24 * 60 * 60 * 1000

interface StandingApprovalRecord {
  expiresAt: number
  grantedAt: number
}

// Authoritative source for standing approvals. Hydrated once on first read
// from `settings.json.standingApprovals`, then all read / write paths go
// through this Map. The UI lists from here too (H1/H2) — single source of
// truth prevents drift between what the gate enforces and what Settings shows.
const standingApprovals = new Map<string, StandingApprovalRecord>()
let standingApprovalsHydrated = false

type PersistedStandingApproval = StandingApprovalRecord

interface SettingsSnapshot {
  standingApprovals?: Record<string, PersistedStandingApproval>
  [key: string]: unknown
}

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function readSettings(): SettingsSnapshot {
  const path = getSettingsPath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as SettingsSnapshot
  } catch {
    return {}
  }
}

function writeSettings(settings: SettingsSnapshot): void {
  const path = getSettingsPath()
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8')
}

/**
 * Hydrate the in-memory Map from settings.json. Idempotent — call on every
 * gate evaluation; real work happens only the first time.
 *
 * Applies DVR-3 (expired filter) and re-classifies every persisted grant
 * against the CURRENT risk classifier, dropping any that now classify as
 * `high` (SCN-4.1 — classifier drift protection).
 */
function hydrateStandingApprovals(): void {
  if (standingApprovalsHydrated) return
  standingApprovalsHydrated = true

  const persisted = readSettings().standingApprovals ?? {}
  const now = Date.now()
  const kept: Record<string, PersistedStandingApproval> = {}

  for (const [actionName, entry] of Object.entries(persisted)) {
    // DVR-3: filter expired
    if (entry.expiresAt < now) continue
    // Drift guard: if the action would now classify as high, drop it
    if (classifyComposioAction(actionName) === 'high') continue

    standingApprovals.set(actionName, { expiresAt: entry.expiresAt, grantedAt: entry.grantedAt })
    kept[actionName] = entry
  }

  // If any entries were filtered, persist the cleaned map so the disk file
  // doesn't accumulate stale entries across boots.
  if (Object.keys(kept).length !== Object.keys(persisted).length) {
    const settings = readSettings()
    settings.standingApprovals = kept
    writeSettings(settings)
  }
}

function hasStandingApproval(actionName: string): boolean {
  hydrateStandingApprovals()
  const record = standingApprovals.get(actionName)
  if (!record) return false
  if (Date.now() > record.expiresAt) {
    // Lazy expiry — also drop from disk
    standingApprovals.delete(actionName)
    const settings = readSettings()
    if (settings.standingApprovals && actionName in settings.standingApprovals) {
      delete settings.standingApprovals[actionName]
      writeSettings(settings)
    }
    return false
  }
  return true
}

/**
 * Grant a standing approval for an action. Applies all four DVR guardrails:
 *   DVR-1: refuses to persist if current tier is high
 *   DVR-2: refuses to persist if profile is not balanced
 *   DVR-3: implicit via the 30-day TTL
 *   DVR-4: separate entry point (`clearAllStandingApprovals`)
 *
 * Always updates the in-memory Map for the session (legacy behavior). The
 * disk persist is gated by the guardrails.
 */
function grantStandingApproval(actionName: string, context?: RiskContext): void {
  const grantedAt = Date.now()
  const expiresAt = grantedAt + STANDING_DURATION_MS
  standingApprovals.set(actionName, { expiresAt, grantedAt })

  // DVR-1: never persist high-tier. Classify WITH context so the Shared-label
  // escalation path is also blocked from persistence.
  const tier = classifyComposioAction(actionName, context)
  if (tier === 'high') {
    console.log(
      `[permission-gate] standing approval for ${actionName} (high tier) NOT persisted (DVR-1)`
    )
    return
  }

  // DVR-2: balanced profile only
  const profile = getTrustProfile()
  if (profile !== 'balanced') {
    console.log(
      `[permission-gate] standing approval for ${actionName} (${profile} profile) NOT persisted (DVR-2)`
    )
    return
  }

  const settings = readSettings()
  settings.standingApprovals = {
    ...(settings.standingApprovals ?? {}),
    [actionName]: { expiresAt, grantedAt }
  }
  writeSettings(settings)
}

/**
 * DVR-4: clear every standing approval — in-memory AND on disk — atomically.
 * Called on trust-profile change.
 */
export function clearAllStandingApprovals(): number {
  hydrateStandingApprovals()
  const count = standingApprovals.size
  standingApprovals.clear()

  const settings = readSettings()
  if (settings.standingApprovals) {
    settings.standingApprovals = {}
    writeSettings(settings)
  }
  return count
}

/**
 * Revoke a single standing approval by action name. Updates in-memory + disk.
 */
export function revokeStandingApproval(actionName: string): boolean {
  hydrateStandingApprovals()
  const hadInMemory = standingApprovals.delete(actionName)

  const settings = readSettings()
  let hadOnDisk = false
  if (settings.standingApprovals && actionName in settings.standingApprovals) {
    delete settings.standingApprovals[actionName]
    writeSettings(settings)
    hadOnDisk = true
  }
  return hadInMemory || hadOnDisk
}

export interface StandingApprovalEntry {
  actionName: string
  expiresAt: number
  grantedAt: number
}

/**
 * List all currently-active standing approvals for the Settings UI.
 *
 * Reads from the in-memory Map (post-hydration), not directly from disk. The
 * Map is the authoritative source — any entry the gate has already dropped
 * (expired, drift-guarded) is also absent here, so the UI cannot display an
 * entry enforcement would not honor. Fixes H1/H2.
 */
export function listStandingApprovals(): StandingApprovalEntry[] {
  hydrateStandingApprovals()
  const now = Date.now()
  const result: StandingApprovalEntry[] = []

  for (const [actionName, record] of standingApprovals) {
    if (record.expiresAt < now) continue
    result.push({
      actionName,
      expiresAt: record.expiresAt,
      grantedAt: record.grantedAt
    })
  }
  return result.sort((a, b) => b.grantedAt - a.grantedAt)
}

// ── Pending requests ──

const GATE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const pendingRequests = new Map<
  string,
  { resolve: (approved: boolean) => void; timeout: ReturnType<typeof setTimeout> }
>()

/**
 * Called by the IPC handler when the renderer resolves a permission request.
 */
export function resolvePermission(requestId: string, approved: boolean, standing: boolean): void {
  const pending = pendingRequests.get(requestId)
  if (!pending) return
  clearTimeout(pending.timeout)
  pendingRequests.delete(requestId)

  // Store standing approval if granted (persists to disk when DVR guardrails pass)
  if (approved && standing) {
    const actionName = pendingActionNames.get(requestId)
    if (actionName) {
      grantStandingApproval(actionName, pendingContexts.get(requestId))
      pendingActionNames.delete(requestId)
      pendingContexts.delete(requestId)
    }
  } else {
    pendingActionNames.delete(requestId)
    pendingContexts.delete(requestId)
  }

  pending.resolve(approved)
}

// Map requestId → actionName so resolvePermission can store standing approvals
const pendingActionNames = new Map<string, string>()
// Parallel map carrying the RiskContext at the time of the gate check, so
// grantStandingApproval() can re-classify with the same context (DVR-1 path).
const pendingContexts = new Map<string, RiskContext | undefined>()

/**
 * Main entry point: checks if a tool call needs user approval.
 * Returns true if approved (or no gate needed), false if denied.
 *
 * The optional `context` carries the connection label, which the shared
 * classifier uses to escalate Shared-account actions one tier (DVR-5).
 */
export async function checkPermission(
  actionName: string,
  params: Record<string, unknown>,
  context?: RiskContext
): Promise<boolean> {
  const tier = classifyComposioAction(actionName, context)
  const profile = getTrustProfile()

  if (!needsGate(tier, profile)) return true
  // C1: Never let a medium-tier standing approval bypass the gate when the
  // effective tier is `high`. This closes the Shared-label escalation loophole
  // (spec-b.md SCN-7.5 + DVR-1 at read time). Grants are keyed on action name
  // alone, but the classifier may return `high` for the SAME action when called
  // against a `Shared`-labeled connection — the escalation must win.
  if (tier !== 'high' && hasStandingApproval(actionName)) return true

  const mainWindow = getMainWindow()
  if (!mainWindow || mainWindow.isDestroyed()) {
    console.warn('[permission-gate] No window available — denying action')
    return false
  }

  const requestId = randomUUID()
  pendingActionNames.set(requestId, actionName)
  pendingContexts.set(requestId, context)

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      pendingActionNames.delete(requestId)
      pendingContexts.delete(requestId)
      console.warn(`[permission-gate] Timeout for ${actionName} — denying`)
      resolve(false)
    }, GATE_TIMEOUT_MS)

    pendingRequests.set(requestId, { resolve, timeout })

    mainWindow.webContents.send('event:permission-request', {
      requestId,
      actionName,
      toolkit: toolkitFromAction(actionName),
      tier,
      description: describeAction(actionName),
      params
    })

    console.log(
      `[permission-gate] ⏳ Awaiting approval for ${actionName} (${tier} risk, ${profile} profile)`
    )
  })
}
