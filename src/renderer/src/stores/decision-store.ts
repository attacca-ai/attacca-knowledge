import { create } from 'zustand'

/**
 * Decision — renderer mirror of main-process entity
 * (see src/main/decisions/manager.ts). Kept identical so IPC
 * round-trips don't need mapping.
 */
export interface DecisionRetrospective {
  actualOutcome: string
  didMatch: boolean | 'partly'
  lessons: string
  createdLessonId?: string
  revisitedAt: number
}

export interface Decision {
  id: string
  title: string
  context: string
  options: string[]
  chosen: string
  reasoning: string
  expectedOutcome: string
  revisitAt: number
  retrospective?: DecisionRetrospective
  areaId?: string
  projectId?: string
  tags: string[]
  createdAt: number
  status: 'active' | 'revisited' | 'reversed' | 'superseded'
  supersededBy?: string
  vaultPath: string
}

export interface DecisionCreateInput {
  title: string
  context: string
  options?: string[]
  chosen: string
  reasoning: string
  expectedOutcome: string
  revisitInDays: number
  areaId?: string
  projectId?: string
  tags?: string[]
}

export interface DecisionRetroInput {
  actualOutcome: string
  didMatch: boolean | 'partly'
  lessons: string
}

interface DecisionStore {
  decisions: Decision[]
  revisitQueue: Decision[]
  loading: boolean
  error: string | null
  hydrate: () => Promise<void>
  refreshRevisitQueue: () => Promise<void>
  create: (input: DecisionCreateInput) => Promise<Decision | null>
  complete: (id: string, retro: DecisionRetroInput) => Promise<Decision | null>
  revisitNow: (id: string) => Promise<Decision | null>
  supersede: (oldId: string, newId: string) => Promise<Decision | null>
}

export const useDecisionStore = create<DecisionStore>((set, get) => ({
  decisions: [],
  revisitQueue: [],
  loading: false,
  error: null,

  hydrate: async () => {
    set({ loading: true, error: null })
    try {
      const res = await window.api.decision.list()
      if (!res.success) {
        set({ error: res.error ?? 'Failed to load decisions', loading: false })
        return
      }
      set({ decisions: res.decisions, loading: false })
      await get().refreshRevisitQueue()
    } catch (err) {
      set({ error: (err as Error).message, loading: false })
    }
  },

  refreshRevisitQueue: async () => {
    try {
      const res = await window.api.decision.scanDue()
      if (res.success) set({ revisitQueue: res.decisions })
    } catch {
      /* tolerate */
    }
  },

  create: async (input) => {
    const res = await window.api.decision.create(input)
    if (!res.success || !res.decision) {
      set({ error: res.error ?? 'Create failed' })
      return null
    }
    set((s) => ({ decisions: [res.decision!, ...s.decisions] }))
    return res.decision
  },

  complete: async (id, retro) => {
    const res = await window.api.decision.complete(id, retro)
    if (!res.success || !res.decision) {
      set({ error: res.error ?? 'Complete failed' })
      return null
    }
    const updated = res.decision
    set((s) => ({
      decisions: s.decisions.map((d) => (d.id === id ? updated : d)),
      revisitQueue: s.revisitQueue.filter((d) => d.id !== id)
    }))
    return updated
  },

  revisitNow: async (id) => {
    const res = await window.api.decision.revisit(id)
    if (!res.success || !res.decision) {
      set({ error: res.error ?? 'Revisit failed' })
      return null
    }
    await get().hydrate()
    return res.decision
  },

  supersede: async (oldId, newId) => {
    const res = await window.api.decision.supersede(oldId, newId)
    if (!res.success || !res.decision) {
      set({ error: res.error ?? 'Supersede failed' })
      return null
    }
    await get().hydrate()
    return res.decision
  }
}))
