import { create } from 'zustand'

export type VaultMode =
  | { kind: 'managed'; path: string }
  | { kind: 'external'; path: string }

export interface OnboardingState {
  currentStep: number
  vaultMode: VaultMode | null
  telemetryOptIn: boolean
  completed: boolean
}

interface OnboardingStore extends OnboardingState {
  setStep: (step: number) => void
  nextStep: () => void
  prevStep: () => void
  setVaultMode: (mode: VaultMode) => void
  setTelemetryOptIn: (optIn: boolean) => void
  complete: () => void
  loadState: () => Promise<void>
  persist: () => Promise<void>
}

const TOTAL_STEPS = 5

export const useOnboardingStore = create<OnboardingStore>((set, get) => ({
  currentStep: 0,
  vaultMode: null,
  telemetryOptIn: false,
  completed: false,

  setStep: (step) => {
    set({ currentStep: Math.max(0, Math.min(step, TOTAL_STEPS - 1)) })
    get().persist()
  },

  nextStep: () => {
    const { currentStep } = get()
    if (currentStep < TOTAL_STEPS - 1) {
      set({ currentStep: currentStep + 1 })
      get().persist()
    }
  },

  prevStep: () => {
    const { currentStep } = get()
    if (currentStep > 0) {
      set({ currentStep: currentStep - 1 })
      get().persist()
    }
  },

  setVaultMode: (mode) => {
    set({ vaultMode: mode })
    get().persist()
  },

  setTelemetryOptIn: (optIn) => {
    set({ telemetryOptIn: optIn })
    get().persist()
  },

  complete: async () => {
    set({ completed: true })
    const { telemetryOptIn, vaultMode } = get()
    await window.api.telemetry.setOptIn(telemetryOptIn)
    if (vaultMode) {
      await window.api.settings.set('vaultMode', vaultMode)
    }
    await window.api.onboarding.complete()
  },

  loadState: async () => {
    const state = (await window.api.onboarding.getState()) as Partial<OnboardingState> | null
    if (state) {
      set({
        currentStep: state.currentStep ?? 0,
        vaultMode: state.vaultMode ?? null,
        telemetryOptIn: state.telemetryOptIn ?? false,
        completed: state.completed ?? false
      })
    }
  },

  persist: async () => {
    const { currentStep, vaultMode, telemetryOptIn, completed } = get()
    await window.api.onboarding.saveState({
      currentStep,
      vaultMode,
      telemetryOptIn,
      completed
    })
  }
}))
