// Three-tier risk classification per spec RD3
// Agent can escalate but never downgrade below the static floor
//
// Classification logic lives in `src/shared/risk-classifier.ts` so both
// main (enforcement) and renderer (display) use the same source of truth.
// This file re-exports the renderer-facing pieces for backwards compatibility
// with existing consumers.

import {
  classifyAppAction as _classifyAppAction,
  type RiskTier,
  type RiskContext,
  type AppActionClassification
} from '@shared/risk-classifier'

export {
  getTierColor,
  getTierBgColor,
  getTierLabel,
  type RiskTier
} from '@shared/risk-classifier'

export type ActionClassification = AppActionClassification

export function classifyAction(
  actionType: string,
  context?: RiskContext
): ActionClassification {
  return _classifyAppAction(actionType, context)
}

// ── Trust Profile Behavior ──

import type { TrustProfile } from '@/types/trust'

export interface ActionBehavior {
  requireConfirmation?: boolean
  showNotification?: boolean
  undoAvailable?: boolean
  silentLog?: boolean
  blockingApproval?: boolean
  delayMs?: number
}

/**
 * Determines presentation behavior based on risk tier and trust profile.
 * classifyAction() always returns the same risk tier regardless of profile (never downgrades).
 * This function only affects how the action is presented to the user.
 */
export function getActionBehavior(tier: RiskTier, profile: TrustProfile): ActionBehavior {
  if (tier === 'low') {
    // Low-risk: always auto-approved
    return { silentLog: true }
  }

  if (tier === 'medium') {
    switch (profile) {
      case 'cautious':
        return { requireConfirmation: true }
      case 'balanced':
        return { showNotification: true, undoAvailable: true }
      case 'autonomous':
        return { silentLog: true }
    }
  }

  // High-risk
  switch (profile) {
    case 'cautious':
    case 'balanced':
      return { blockingApproval: true }
    case 'autonomous':
      return { delayMs: 120_000, undoAvailable: true }
  }
}
