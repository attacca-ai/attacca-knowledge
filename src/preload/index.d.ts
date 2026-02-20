export interface AttaccaAPI {
  license: {
    validate: (key: string) => Promise<{ success: boolean; error?: string; plan?: string }>
    checkExisting: () => Promise<{
      exists: boolean
      valid: boolean
      plan?: string
      error?: string
    }>
    getStatus: () => Promise<{
      status: 'unchecked' | 'valid' | 'invalid' | 'expired' | 'grace'
      plan?: string
      lastValidated?: number
    }>
  }

  gateway: {
    start: () => Promise<{ success: boolean }>
    stop: () => Promise<{ success: boolean }>
    restart: () => Promise<{ success: boolean }>
    status: () => Promise<{
      state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error'
      pid: number | null
      restartCount: number
      lastError: string | null
      startedAt: number | null
    }>
    health: () => Promise<{
      ok: boolean
      latency: number | null
      error: string | null
      checkedAt: number
    }>
    onStateChanged: (
      callback: (state: {
        state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error'
        pid: number | null
        restartCount: number
        lastError: string | null
        startedAt: number | null
      }) => void
    ) => () => void
  }

  onboarding: {
    getState: () => Promise<OnboardingState | null>
    saveState: (state: OnboardingState) => Promise<void>
    complete: () => Promise<void>
  }

  oauth: {
    start: (provider: string) => Promise<{ success: boolean; error?: string }>
    getStatus: (provider: string) => Promise<{ connected: boolean; error?: string }>
    disconnect: (provider: string) => Promise<{ success: boolean; error?: string }>
    getConnected: () => Promise<string[]>
    onCallback: (callback: (result: { provider: string; success: boolean; error?: string }) => void) => () => void
  }

  llm: {
    testConnection: (
      provider: string,
      apiKey: string
    ) => Promise<{ success: boolean; error?: string }>
    saveConfig: (
      provider: string,
      model: string,
      apiKey: string
    ) => Promise<{ success: boolean }>
  }

  app: {
    quit: () => Promise<void>
    minimizeToTray: () => Promise<void>
    showWindow: () => Promise<void>
    getVersion: () => Promise<string>
    openExternal: (url: string) => Promise<void>
  }

  settings: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
  }

  fs: {
    selectFolder: () => Promise<string | null>
  }
}

interface OnboardingState {
  currentStep: number
  llmProvider: string | null
  llmModel: string | null
  apiKeyValidated: boolean
  connectedTools: string[]
  selectedUseCases: string[]
  completed: boolean
}

declare global {
  interface Window {
    api: AttaccaAPI
  }
}
