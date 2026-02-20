import { create } from 'zustand'

interface SettingsStore {
  morningBriefingTime: string
  eodSummaryTime: string
  telegramConnected: boolean
  folderWatchEnabled: boolean
  folderWatchPath: string | null
  takeOverSummaryInterval: number
  takeOverAutoDisable: number

  setSetting: <K extends keyof SettingsStore>(key: K, value: SettingsStore[K]) => void
  loadSettings: () => Promise<void>
  persist: () => Promise<void>
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  morningBriefingTime: '07:00',
  eodSummaryTime: '18:00',
  telegramConnected: false,
  folderWatchEnabled: false,
  folderWatchPath: null,
  takeOverSummaryInterval: 2,
  takeOverAutoDisable: 8,

  setSetting: (key, value) => {
    set({ [key]: value } as Partial<SettingsStore>)
    get().persist()
  },

  loadSettings: async () => {
    try {
      const settings = await window.api.settings.get('attacca')
      if (settings && typeof settings === 'object') {
        set(settings as Partial<SettingsStore>)
      }
    } catch {
      // Use defaults
    }
  },

  persist: async () => {
    const {
      morningBriefingTime,
      eodSummaryTime,
      telegramConnected,
      folderWatchEnabled,
      folderWatchPath,
      takeOverSummaryInterval,
      takeOverAutoDisable
    } = get()

    await window.api.settings.set('attacca', {
      morningBriefingTime,
      eodSummaryTime,
      telegramConnected,
      folderWatchEnabled,
      folderWatchPath,
      takeOverSummaryInterval,
      takeOverAutoDisable
    })
  }
}))
