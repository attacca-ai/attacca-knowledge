import { create } from 'zustand'

export type LicenseStatus = 'unchecked' | 'checking' | 'valid' | 'invalid' | 'expired' | 'grace'

interface LicenseStore {
  status: LicenseStatus
  plan: string | null
  error: string | null
  lastValidated: number | null

  validate: (key: string) => Promise<boolean>
  checkExisting: () => Promise<boolean>
}

export const useLicenseStore = create<LicenseStore>((set) => ({
  status: 'unchecked',
  plan: null,
  error: null,
  lastValidated: null,

  validate: async (key: string): Promise<boolean> => {
    set({ status: 'checking', error: null })
    try {
      const result = await window.api.license.validate(key)
      if (result.success) {
        set({
          status: 'valid',
          plan: result.plan || null,
          error: null,
          lastValidated: Date.now()
        })
        return true
      } else {
        set({ status: 'invalid', error: result.error || 'Invalid license key' })
        return false
      }
    } catch (err) {
      set({
        status: 'invalid',
        error: err instanceof Error ? err.message : 'Failed to validate license'
      })
      return false
    }
  },

  checkExisting: async (): Promise<boolean> => {
    set({ status: 'checking', error: null })
    try {
      const result = await window.api.license.checkExisting()
      if (result.exists && result.valid) {
        set({
          status: 'valid',
          plan: result.plan || null,
          error: null
        })
        return true
      }
      set({ status: 'unchecked' })
      return false
    } catch {
      set({ status: 'unchecked' })
      return false
    }
  }
}))
