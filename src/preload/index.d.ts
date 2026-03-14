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
    getToken: () => Promise<{ token: string | null }>
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
    onCallback: (
      callback: (result: { provider: string; success: boolean; error?: string }) => void
    ) => () => void
  }

  llm: {
    testConnection: (
      provider: string,
      apiKey: string
    ) => Promise<{ success: boolean; error?: string }>
    saveConfig: (provider: string, model: string, apiKey: string) => Promise<{ success: boolean }>
    getConfig: () => Promise<{
      provider: string
      model: string
      apiKeyHint: string | null
    } | null>
  }

  app: {
    quit: () => Promise<void>
    minimizeToTray: () => Promise<void>
    showWindow: () => Promise<void>
    getVersion: () => Promise<string>
    openExternal: (url: string) => Promise<void>
  }

  agent: {
    getState: () => Promise<PersistedAgentState | null>
    setState: (state: PersistedAgentState) => Promise<void>
  }

  settings: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
  }

  fs: {
    selectFolder: () => Promise<string | null>
  }

  activecollab: {
    connectCloud: (
      email: string,
      password: string
    ) => Promise<{
      success: boolean
      error?: string
      config?: { companyName?: string; email: string }
    }>
    connectSelfHosted: (
      url: string,
      email: string,
      password: string
    ) => Promise<{
      success: boolean
      error?: string
      config?: { instanceUrl: string; email: string }
    }>
    status: () => Promise<{
      connected: boolean
      config: { companyName?: string; email: string; isCloud: boolean } | null
    }>
    disconnect: () => Promise<{ success: boolean; error?: string }>
  }

  relay: {
    initiateOAuth: (appName: string) => Promise<{
      success: boolean
      connectionId?: string
      redirectUrl?: string
      error?: string
    }>
    getOAuthStatus: (connectionId: string) => Promise<{
      connectionId: string
      status: 'initiated' | 'active' | 'failed' | 'expired'
      appName: string
      error?: string
    }>
    disconnectOAuth: (appName: string) => Promise<{ success: boolean; error?: string }>
    getUsage: () => Promise<{
      totalCostUsd: number
      limitUsd: number
      requestCount: number
      limitReached: boolean
      resetDate: string
      error?: string
    }>
    getConnected: () => Promise<string[]>
    callTool: (
      actionName: string,
      params: Record<string, unknown>
    ) => Promise<{ success: boolean; result?: unknown; error?: string }>
    llmCompletion: (
      messages: Array<{ role: string; content: string }>,
      opts?: { model?: string; max_tokens?: number }
    ) => Promise<{ id: string; model: string; content: string; usage: { input_tokens: number; output_tokens: number }; provider: string } | { success: false; error: string }>
    listApps: () => Promise<Array<{ slug: string; name: string; categories: string[]; description: string }>>
    extractUrl: (url: string) => Promise<{
      success: boolean
      type?: 'youtube' | 'article'
      title?: string
      text?: string
      wordCount?: number
      error?: string
    }>
  }

  kb: {
    saveCapture: (data: {
      id: string
      sourceType: string
      title: string
      content: string
      result: {
        summary: string
        actionItems: Array<{ text: string; owner?: string }>
        decisions: string[]
        openQuestions: string[]
        keyPoints: string[]
        entities?: { people?: string[]; projects?: string[]; dates?: string[] }
      }
      timestamp: number
    }) => Promise<{ success: boolean }>
    readContext: () => Promise<string>
    appendDailyLog: (entry: string) => Promise<{ success: boolean }>
  }

  telemetry: {
    setOptIn: (optIn: boolean) => Promise<{ success: boolean }>
    getOptIn: () => Promise<{ optIn: boolean }>
    deleteData: () => Promise<{ success: boolean }>
    emit: (eventType: string, payload: Record<string, unknown>) => Promise<{ success: boolean }>
  }
}

interface PersistedAgentState {
  morningBriefing: string | null
  briefingDate: string | null
  morningLandscape?: {
    message: string
    question: string | null
    suggestedActions: Array<{ label: string; actionType: string; payload: unknown }>
    generatedAt: number
  } | null
  themes?: Array<{
    id: string
    title: string
    description: string
    weight: 'high' | 'mid' | 'low' | 'neutral'
    tags: string[]
    mentionCount: number
    deadline?: string
  }>
  taskQueue: Array<{
    id: string
    description: string
    status: 'pending' | 'in_progress' | 'completed' | 'failed'
    createdAt: number
    startedAt?: number
    completedAt?: number
    result?: string
    error?: string
  }>
  activityFeed: Array<{
    id: string
    timestamp: number
    type: 'info' | 'action' | 'tool_call' | 'tool_result' | 'error' | 'message'
    description: string
    details?: string
    expanded?: boolean
  }>
  scheduleChatHistory?: Array<{
    id: string
    role: 'user' | 'assistant'
    text: string
  }>
  rawCaptures?: Array<{
    id: string
    text: string
    type: 'thought' | 'action' | 'question'
    timestamp: number
    agentNote: string | null
    linkedThemeId?: string
    linkedThreadId?: string
  }>
  threads?: Array<{
    id: string
    title: string
    holdingNote: string
    createdAt: number
    relatedThemeId?: string
  }>
}

interface OnboardingState {
  currentStep: number
  connectedTools: string[]
  selectedUseCases: string[]
  telemetryOptIn: boolean
  completed: boolean
}

declare global {
  interface Window {
    api: AttaccaAPI
  }
}
