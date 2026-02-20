import { create } from 'zustand'
import type { RiskTier } from '@/lib/permission-engine'

export interface PermissionGrant {
  toolId: string
  actionType: string
  tier: RiskTier
  grantedAt: number
  standing: boolean
  expiresAt: number | null // null = permanent for low tier
}

export interface PendingApproval {
  id: string
  actionType: string
  toolId: string
  tier: RiskTier
  description: string
  params?: Record<string, unknown>
  requestedAt: number
}

interface PermissionStore {
  grants: Map<string, PermissionGrant>
  pendingApprovals: PendingApproval[]

  grantPermission: (approval: PendingApproval, standing?: boolean) => void
  denyPermission: (approvalId: string) => void
  revokeStanding: (toolId: string, actionType: string) => void
  isApproved: (toolId: string, actionType: string, tier: RiskTier) => boolean
  addPendingApproval: (approval: Omit<PendingApproval, 'id' | 'requestedAt'>) => string
  getPendingApprovals: () => PendingApproval[]
}

const STANDING_DURATION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
let approvalIdCounter = 0

function grantKey(toolId: string, actionType: string): string {
  return `${toolId}:${actionType}`
}

export const usePermissionStore = create<PermissionStore>((set, get) => ({
  grants: new Map(),
  pendingApprovals: [],

  grantPermission: (approval, standing = false) => {
    const key = grantKey(approval.toolId, approval.actionType)
    const grants = new Map(get().grants)

    grants.set(key, {
      toolId: approval.toolId,
      actionType: approval.actionType,
      tier: approval.tier,
      grantedAt: Date.now(),
      standing,
      expiresAt: standing ? Date.now() + STANDING_DURATION_MS : approval.tier === 'low' ? null : null
    })

    set({
      grants,
      pendingApprovals: get().pendingApprovals.filter((a) => a.id !== approval.id)
    })
  },

  denyPermission: (approvalId) => {
    set({
      pendingApprovals: get().pendingApprovals.filter((a) => a.id !== approvalId)
    })
  },

  revokeStanding: (toolId, actionType) => {
    const key = grantKey(toolId, actionType)
    const grants = new Map(get().grants)
    grants.delete(key)
    set({ grants })
  },

  isApproved: (toolId, actionType, tier) => {
    const key = grantKey(toolId, actionType)
    const grant = get().grants.get(key)

    if (!grant) return false

    // Check expiration
    if (grant.expiresAt && Date.now() > grant.expiresAt) {
      const grants = new Map(get().grants)
      grants.delete(key)
      set({ grants })
      return false
    }

    // Low tier: always approved after first grant
    if (tier === 'low') return true

    // Medium tier: auto-approved
    if (tier === 'medium') return true

    // High tier: only if standing approval exists
    if (tier === 'high') return grant.standing

    return false
  },

  addPendingApproval: (approval) => {
    const id = `approval_${++approvalIdCounter}`
    const pending: PendingApproval = {
      ...approval,
      id,
      requestedAt: Date.now()
    }
    set({ pendingApprovals: [...get().pendingApprovals, pending] })
    return id
  },

  getPendingApprovals: () => get().pendingApprovals
}))
