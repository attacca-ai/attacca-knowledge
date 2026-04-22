import { create } from 'zustand'
import {
  registerSlice,
  schedulePersist,
  loadSnapshot
} from '@/lib/agent-state-persist'

export interface ActivityEntry {
  id: string
  timestamp: number
  type: 'info' | 'action' | 'tool_call' | 'tool_result' | 'error' | 'message'
  description: string
  details?: string
  expanded?: boolean
}

interface ActivityStore {
  activityFeed: ActivityEntry[]
  hydrate: () => Promise<void>
  addActivity: (entry: Omit<ActivityEntry, 'id' | 'timestamp'>) => void
  clearActivity: () => void
}

const MAX_ACTIVITY_ENTRIES = 100
let activityIdCounter = 0

export const useActivityStore = create<ActivityStore>((set) => ({
  activityFeed: [],

  hydrate: async () => {
    const snap = await loadSnapshot()
    if (!snap) return
    set({ activityFeed: (snap.activityFeed as ActivityEntry[] | undefined) ?? [] })
  },

  addActivity: (entry) => {
    const full: ActivityEntry = {
      ...entry,
      id: `act_${++activityIdCounter}`,
      timestamp: Date.now()
    }
    set((s) => ({ activityFeed: [...s.activityFeed, full] }))
    // Activity feed churns fast — persist only on clear / hydrate boundaries
    // to avoid IPC storms. The snapshot on the next real persist call will
    // pick up the latest entries.
  },

  clearActivity: () => {
    set({ activityFeed: [] })
    schedulePersist()
  }
}))

registerSlice('activity-store', () => ({
  activityFeed: useActivityStore.getState().activityFeed.slice(-MAX_ACTIVITY_ENTRIES)
}))
