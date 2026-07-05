import { create } from 'zustand'
import {
  registerSlice,
  schedulePersist,
  loadSnapshot
} from '@/lib/agent-state-persist'

export interface CaptureEntry {
  id: string
  text: string
  type: 'thought' | 'action' | 'question'
  sourceType?: 'text' | 'url' | 'file' | 'transcript' | 'landscape-chat'
  timestamp: number
  agentNote: string | null
  archived?: boolean
  /** session key used to send this capture (for confirmation flow) */
  sessionKey?: string
  /** if set, agent is waiting for user to confirm/cancel this action */
  pendingConfirmation?: string
  linkedThemeId?: string
  linkedThreadId?: string
}

interface CaptureStore {
  rawCaptures: CaptureEntry[]
  rawCapturesCount: number
  hydrate: () => Promise<void>
  addRawCapture: (e: Omit<CaptureEntry, 'id' | 'timestamp'>) => void
  updateCaptureNote: (id: string, agentNote: string) => void
  setCaptureConfirmation: (id: string, pendingConfirmation: string | null) => void
  deleteCapture: (id: string) => void
  archiveCapture: (id: string) => void
}

const RAW_CAPTURES_LIMIT = 200
let captureIdCounter = 0

/** Derived pending count — manual increment/decrement bookkeeping drifted
 * (double decrements from the confirm flow, hydrate resetting to 0). */
function pendingCount(list: CaptureEntry[]): number {
  return list.filter((c) => c.agentNote === null && !c.archived).length
}

export const useCaptureStore = create<CaptureStore>((set) => ({
  rawCaptures: [],
  rawCapturesCount: 0,

  hydrate: async () => {
    const snap = await loadSnapshot()
    if (!snap) return
    const saved: CaptureEntry[] = (snap.rawCaptures as CaptureEntry[] | undefined) ?? []
    for (const c of saved) {
      const n = parseInt(c.id.replace('cap_', ''))
      if (!isNaN(n) && n > captureIdCounter) captureIdCounter = n
    }
    set({ rawCaptures: saved, rawCapturesCount: pendingCount(saved) })
  },

  addRawCapture: (e) => {
    const entry: CaptureEntry = {
      ...e,
      id: `cap_${++captureIdCounter}`,
      timestamp: Date.now()
    }
    set((s) => {
      const rawCaptures = [entry, ...s.rawCaptures].slice(0, RAW_CAPTURES_LIMIT)
      return { rawCaptures, rawCapturesCount: pendingCount(rawCaptures) }
    })
    schedulePersist()
  },

  updateCaptureNote: (id, agentNote) => {
    set((s) => {
      const rawCaptures = s.rawCaptures.map((c) => (c.id === id ? { ...c, agentNote } : c))
      return { rawCaptures, rawCapturesCount: pendingCount(rawCaptures) }
    })
    schedulePersist()
  },

  setCaptureConfirmation: (id, pendingConfirmation) => {
    set((s) => ({
      rawCaptures: s.rawCaptures.map((c) =>
        c.id === id ? { ...c, pendingConfirmation: pendingConfirmation ?? undefined } : c
      )
    }))
    schedulePersist()
  },

  deleteCapture: (id) => {
    set((s) => {
      const rawCaptures = s.rawCaptures.filter((c) => c.id !== id)
      return { rawCaptures, rawCapturesCount: pendingCount(rawCaptures) }
    })
    schedulePersist()
  },

  archiveCapture: (id) => {
    set((s) => {
      const rawCaptures = s.rawCaptures.map((c) => (c.id === id ? { ...c, archived: true } : c))
      return { rawCaptures, rawCapturesCount: pendingCount(rawCaptures) }
    })
    schedulePersist()
  }
}))

registerSlice('capture-store', () => ({
  rawCaptures: useCaptureStore.getState().rawCaptures.slice(0, RAW_CAPTURES_LIMIT)
}))
