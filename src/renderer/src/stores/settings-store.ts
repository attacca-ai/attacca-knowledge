import { create } from 'zustand'

interface SettingsStore {
  morningBriefingTime: string
  eodSummaryTime: string
  userTimezone: string
  telegramConnected: boolean
  folderWatchEnabled: boolean
  folderWatchPath: string | null
  takeOverSummaryInterval: number
  takeOverAutoDisable: number
  byokEnabled: boolean
  byokProvider: string | null
  telemetryOptIn: boolean

  setSetting: <K extends keyof SettingsStore>(key: K, value: SettingsStore[K]) => void
  loadSettings: () => Promise<void>
  persist: () => Promise<void>
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  morningBriefingTime: '07:00',
  eodSummaryTime: '18:00',
  userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  telegramConnected: false,
  folderWatchEnabled: false,
  folderWatchPath: null,
  takeOverSummaryInterval: 2,
  takeOverAutoDisable: 8,
  byokEnabled: false,
  byokProvider: null,
  telemetryOptIn: false,

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

    // Sync telemetry opt-in from main process
    try {
      const telemetry = await window.api.telemetry.getOptIn()
      if (telemetry) {
        set({ telemetryOptIn: telemetry.optIn })
      }
    } catch {
      // ignore
    }
  },

  persist: async () => {
    const {
      morningBriefingTime,
      eodSummaryTime,
      userTimezone,
      telegramConnected,
      folderWatchEnabled,
      folderWatchPath,
      takeOverSummaryInterval,
      takeOverAutoDisable,
      byokEnabled,
      byokProvider,
      telemetryOptIn
    } = get()

    await window.api.settings.set('attacca', {
      morningBriefingTime,
      eodSummaryTime,
      userTimezone,
      telegramConnected,
      folderWatchEnabled,
      folderWatchPath,
      takeOverSummaryInterval,
      takeOverAutoDisable,
      byokEnabled,
      byokProvider,
      telemetryOptIn
    })
  }
}))
