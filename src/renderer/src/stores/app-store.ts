import { create } from 'zustand'

export type AppPage = 'license' | 'onboarding' | 'dashboard'

interface AppStore {
  page: AppPage
  version: string | null
  isOnline: boolean

  setPage: (page: AppPage) => void
  setVersion: (version: string) => void
  setOnline: (online: boolean) => void
}

export const useAppStore = create<AppStore>((set) => ({
  page: 'license',
  version: null,
  isOnline: navigator.onLine,

  setPage: (page) => set({ page }),
  setVersion: (version) => set({ version }),
  setOnline: (isOnline) => set({ isOnline })
}))
