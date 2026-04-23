import { create } from 'zustand'

/**
 * Area — mirror of the main-process entity (see src/main/areas/manager.ts).
 * Kept structurally identical so IPC round-trips require no mapping.
 */
export interface Area {
  id: string
  name: string
  description: string
  emoji?: string
  healthScore?: number
  projectIds: string[]
  taskIds: string[]
  reviewCadence: 'weekly' | 'monthly'
  createdAt: number
  archived: boolean
  archivedAt?: number
  archiveNote?: string
  vaultPath: string
}

interface AreaStore {
  areas: Area[]
  loading: boolean
  error: string | null
  hydrate: () => Promise<void>
  create: (input: {
    name: string
    description?: string
    emoji?: string
    reviewCadence?: 'weekly' | 'monthly'
  }) => Promise<Area | null>
  update: (
    id: string,
    patch: Partial<{
      name: string
      description: string
      emoji: string
      reviewCadence: 'weekly' | 'monthly'
    }>
  ) => Promise<Area | null>
  archive: (id: string, note?: string) => Promise<boolean>
}

export const useAreaStore = create<AreaStore>((set, get) => ({
  areas: [],
  loading: false,
  error: null,

  hydrate: async () => {
    set({ loading: true, error: null })
    try {
      const res = await window.api.area.list()
      if (!res.success) {
        set({ error: res.error ?? 'Failed to load areas', loading: false })
        return
      }
      set({ areas: res.areas, loading: false })
    } catch (err) {
      set({ error: (err as Error).message, loading: false })
    }
  },

  create: async (input) => {
    const res = await window.api.area.create(input)
    if (!res.success || !res.area) {
      set({ error: res.error ?? 'Create failed' })
      return null
    }
    set((s) => ({ areas: [...s.areas, res.area!] }))
    return res.area
  },

  update: async (id, patch) => {
    const res = await window.api.area.update(id, patch)
    if (!res.success || !res.area) {
      set({ error: res.error ?? 'Update failed' })
      return null
    }
    const updated = res.area
    set((s) => ({ areas: s.areas.map((a) => (a.id === id ? updated : a)) }))
    return updated
  },

  archive: async (id, note) => {
    const res = await window.api.area.archive(id, note)
    if (!res.success) {
      set({ error: res.error ?? 'Archive failed' })
      return false
    }
    // Refresh to pick archived flag from disk.
    await get().hydrate()
    return true
  }
}))
