import { create } from 'zustand'

interface UsageStore {
  costUsd: number
  limitUsd: number
  limitReached: boolean
  resetDate: string | null
  byokActive: boolean
  loading: boolean

  fetchUsage: () => Promise<void>
  setBYOKActive: (active: boolean) => void
}

export const useUsageStore = create<UsageStore>((set) => ({
  costUsd: 0,
  limitUsd: 30,
  limitReached: false,
  resetDate: null,
  byokActive: false,
  loading: false,

  fetchUsage: async () => {
    set({ loading: true })
    try {
      const usage = await window.api.relay.getUsage()
      set({
        costUsd: usage.totalCostUsd ?? 0,
        limitUsd: usage.limitUsd ?? 30,
        limitReached: usage.limitReached ?? false,
        resetDate: usage.resetDate ?? null,
        loading: false
      })
    } catch {
      set({ loading: false })
    }
  },

  setBYOKActive: (active) => {
    set({ byokActive: active })
  }
}))
