export interface OnboardingState {
  currentStep: number
  llmProvider: string | null
  llmModel: string | null
  apiKeyValidated: boolean
  connectedTools: string[]
  selectedUseCases: string[]
  completed: boolean
}

export type OnboardingStep = 'welcome' | 'llm-provider' | 'tool-connection' | 'use-case' | 'completion'
