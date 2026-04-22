import { create } from 'zustand'
import {
  registerSlice,
  schedulePersist,
  loadSnapshot
} from '@/lib/agent-state-persist'

/**
 * VaultNode — the Life OS rename of the old `KBEntry`. Shape kept compatible
 * with the persisted `kbEntries` key for now so hydration from existing
 * `agent-state.json` blobs continues to work. The Life OS spec (v0.3 §3.2)
 * will extend this with `vaultPath` and richer frontmatter in Phase 1.
 */
export interface VaultNode {
  id: string
  title: string
  sourceType: 'capture' | 'transcript' | 'manual' | 'agent'
  sourceId?: string
  summary: string
  savedAt: number
  tags: string[]
  folder?: string
}

interface VaultStore {
  entries: VaultNode[]
  hydrate: () => Promise<void>
  addEntry: (entry: Omit<VaultNode, 'id' | 'savedAt'>) => string
  deleteEntry: (id: string) => void
}

export const useVaultStore = create<VaultStore>((set) => ({
  entries: [],

  hydrate: async () => {
    const snap = await loadSnapshot()
    if (!snap) return
    set({ entries: (snap.kbEntries as VaultNode[] | undefined) ?? [] })
  },

  addEntry: (entry) => {
    const id = `kb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const full: VaultNode = { ...entry, id, savedAt: Date.now() }
    set((s) => ({ entries: [full, ...s.entries] }))
    schedulePersist()
    return id
  },

  deleteEntry: (id) => {
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }))
    schedulePersist()
  }
}))

registerSlice('vault-store', () => ({
  // Persist under the legacy `kbEntries` key for hydration compatibility.
  kbEntries: useVaultStore.getState().entries.slice(0, 500)
}))
