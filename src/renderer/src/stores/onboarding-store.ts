import { create } from 'zustand'

export interface OnboardingState {
  currentStep: number
  llmProvider: string | null
  llmModel: string | null
  apiKeyValidated: boolean
  connectedTools: string[]
  selectedUseCases: string[]
  completed: boolean
}

interface OnboardingStore extends OnboardingState {
  setStep: (step: number) => void
  nextStep: () => void
  prevStep: () => void
  setLLMProvider: (provider: string, model: string) => void
  setApiKeyValidated: (validated: boolean) => void
  addConnectedTool: (tool: string) => void
  removeConnectedTool: (tool: string) => void
  setSelectedUseCases: (useCases: string[]) => void
  complete: () => void
  loadState: () => Promise<void>
  persist: () => Promise<void>
}

const TOTAL_STEPS = 5

export const useOnboardingStore = create<OnboardingStore>((set, get) => ({
  currentStep: 0,
  llmProvider: null,
  llmModel: null,
  apiKeyValidated: false,
  connectedTools: [],
  selectedUseCases: [],
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

  setLLMProvider: (provider, model) => {
    set({ llmProvider: provider, llmModel: model })
    get().persist()
  },

  setApiKeyValidated: (validated) => {
    set({ apiKeyValidated: validated })
    get().persist()
  },

  addConnectedTool: (tool) => {
    const { connectedTools } = get()
    if (!connectedTools.includes(tool)) {
      set({ connectedTools: [...connectedTools, tool] })
      get().persist()
    }
  },

  removeConnectedTool: (tool) => {
    set({ connectedTools: get().connectedTools.filter((t) => t !== tool) })
    get().persist()
  },

  setSelectedUseCases: (useCases) => {
    set({ selectedUseCases: useCases })
    get().persist()
  },

  complete: async () => {
    set({ completed: true })
    await window.api.onboarding.complete()
  },

  loadState: async () => {
    const state = await window.api.onboarding.getState()
    if (state) {
      set({
        currentStep: state.currentStep ?? 0,
        llmProvider: state.llmProvider ?? null,
        llmModel: state.llmModel ?? null,
        apiKeyValidated: state.apiKeyValidated ?? false,
        connectedTools: state.connectedTools ?? [],
        selectedUseCases: state.selectedUseCases ?? [],
        completed: state.completed ?? false
      })
    }
  },

  persist: async () => {
    const {
      currentStep,
      llmProvider,
      llmModel,
      apiKeyValidated,
      connectedTools,
      selectedUseCases,
      completed
    } = get()

    await window.api.onboarding.saveState({
      currentStep,
      llmProvider,
      llmModel,
      apiKeyValidated,
      connectedTools,
      selectedUseCases,
      completed
    })
  }
}))
