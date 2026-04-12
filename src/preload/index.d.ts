export interface AttaccaAPI {
  onboarding: {
    getState: () => Promise<OnboardingState | null>
    saveState: (state: OnboardingState) => Promise<void>
    complete: () => Promise<void>
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

  agentState: {
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

  composio: {
    setApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
    getApiKey: () => Promise<{ hint: string | null }>
    initiateOAuth: (appName: string) => Promise<{
      success: boolean
      connectionId?: string
      redirectUrl?: string
      error?: string
    }>
    getStatus: (connectionId: string) => Promise<{
      id: string
      status: 'initiated' | 'active' | 'failed' | 'expired'
      appName: string
      error?: string
    }>
    getConnected: () => Promise<string[]>
    listApps: () => Promise<
      Array<{ slug: string; name: string; categories: string[]; description: string }>
    >
    listActions: (appSlug: string) => Promise<
      Array<{ name: string; description: string }>
    >
    callTool: (
      actionName: string,
      params: Record<string, unknown>
    ) => Promise<{ success: boolean; result?: unknown; error?: string }>
    disconnect: (
      toolkitSlug: string
    ) => Promise<{ success: boolean; deleted: number; error?: string }>
    getAccounts: () => Promise<{
      success: boolean
      accounts: Array<{
        connectionId: string
        toolkit: string
        status: string
        label: 'Work' | 'Personal' | 'Shared'
        customName: string | null
      }>
      error?: string
    }>
    setLabel: (
      connectionId: string,
      label: string,
      customName?: string | null
    ) => Promise<{ success: boolean; error?: string }>
    setDefault: (
      toolkit: string,
      connectionId: string | null
    ) => Promise<{ success: boolean; error?: string }>
    getDefaults: () => Promise<{
      success: boolean
      defaults: Record<string, string>
      error?: string
    }>
  }

  relay: {
    getUsage: () => Promise<{
      totalCostUsd: number
      limitUsd: number
      requestCount: number
      limitReached: boolean
      resetDate: string
      error?: string
    }>
    llmCompletion: (
      messages: Array<{ role: string; content: string }>,
      opts?: { model?: string; max_tokens?: number }
    ) => Promise<
      | {
          id: string
          model: string
          content: string
          usage: { input_tokens: number; output_tokens: number }
          provider: string
        }
      | { success: false; error: string }
    >
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
    getPath: () => Promise<string>
    openFolder: () => Promise<{ success: boolean }>
    importFiles: (filePaths: string[]) => Promise<{
      success: boolean
      imported: Array<{ fileName: string; title: string }>
    }>
  }

  memory: {
    search: (query: string) => Promise<{
      success: boolean
      results: Array<{
        id: string
        type: string
        summary: string
        content: string
        score: number
        created_at: number
      }>
      error?: string
    }>
    save: (data: {
      content: string
      type?: string
      summary?: string
      tags?: string[]
      importance?: number
      source_id?: string
    }) => Promise<{ success: boolean; id?: string; error?: string }>
    getStats: () => Promise<{
      success: boolean
      total?: number
      byType?: Record<string, number>
      withEmbeddings?: number
      error?: string
    }>
    getIdentity: () => Promise<{
      success: boolean
      traits?: Array<{ key: string; value: string; confidence: number }>
      error?: string
    }>
  }

  scheduler: {
    getTasks: () => Promise<
      Array<{
        id: string
        name: string
        description: string
        enabled: boolean
        lastRun: number | null
        lastResult: string | null
        lastError: string | null
      }>
    >
    setEnabled: (taskId: string, enabled: boolean) => Promise<{ success: boolean }>
    runNow: (taskId: string) => Promise<{ success: boolean; error?: string }>
  }

  permission: {
    onRequest: (
      callback: (request: {
        requestId: string
        actionName: string
        toolkit: string
        tier: 'low' | 'medium' | 'high'
        description: string
        params: Record<string, unknown>
      }) => void
    ) => () => void
    resolve: (
      requestId: string,
      approved: boolean,
      standing: boolean
    ) => Promise<{ success: boolean }>
    listStanding: () => Promise<{
      success: boolean
      approvals: Array<{ actionName: string; expiresAt: number; grantedAt: number }>
      error?: string
    }>
    revokeStanding: (
      actionName: string
    ) => Promise<{ success: boolean; revoked?: boolean; error?: string }>
  }

  telemetry: {
    setOptIn: (optIn: boolean) => Promise<{ success: boolean }>
    getOptIn: () => Promise<{ optIn: boolean }>
    deleteData: () => Promise<{ success: boolean }>
    emit: (eventType: string, payload: Record<string, unknown>) => Promise<{ success: boolean }>
    getQueue: () => Promise<{
      events: Array<{
        eventType: string
        payload: Record<string, unknown>
        timestamp: string
        anonymousId: string
      }>
    }>
    getStatus: () => Promise<{
      optedIn: boolean
      lastFlush: string | null
      queueSize: number
    }>
  }

  agent: {
    send: (
      sessionKey: string,
      message: string,
      idempotencyKey: string
    ) => Promise<{ success: boolean; error?: string }>
    stop: (sessionKey: string) => Promise<{ success: boolean }>
    listSessions: () => Promise<{
      success: boolean
      sessions?: Array<{
        key: string
        type: 'main' | 'feature'
        messageCount: number
        createdAt: number
      }>
    }>
    clearSession: (sessionKey: string) => Promise<{ success: boolean }>
    onStream: (
      callback: (data: { sessionKey: string; delta: string; type: string }) => void
    ) => () => void
    onToolCall: (
      callback: (data: {
        sessionKey: string
        toolName: string
        toolInput: Record<string, unknown>
      }) => void
    ) => () => void
    onToolResult: (
      callback: (data: {
        sessionKey: string
        toolName: string
        success: boolean
        summary: string
      }) => void
    ) => () => void
    onFinal: (
      callback: (data: {
        sessionKey: string
        message: string
        usage: { input_tokens: number; output_tokens: number }
      }) => void
    ) => () => void
    onError: (
      callback: (data: { sessionKey: string; error: string; partial?: string | null }) => void
    ) => () => void
  }
}

interface PersistedAgentState {
  morningBriefing: string | null
  briefingDate: string | null
  scheduleReadCache?: {
    message: string
    question: string | null
    suggestedActions: Array<{
      label: string
      icon: 'warn' | 'plus' | 'move' | 'send'
      risk: 'low' | 'mid' | 'high'
      prompt: string
    }>
    generatedAt: number
    eventsHash: string
  } | null
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
    quickAction?: { actionType: string; params: unknown; riskTier: string }
    archived?: boolean
    archiveNote?: string
    archivedAt?: number
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
  threadMessages?: Record<string, Array<{ role: 'agent' | 'user'; text: string; ts: number }>>
  activeThreadId?: string | null
  workflowLibrary?: Array<{
    id: string
    name: string
    description?: string
    status: 'active' | 'paused'
    runs: number
  }>
  transcriptHistory?: Array<{
    id: string
    fileName: string
    status: 'processing' | 'completed' | 'failed'
    startedAt: number
    completedAt?: number
    error?: string
  }>
  localTasks?: Array<{
    id: string
    description: string
    status: 'pending' | 'in_progress' | 'completed' | 'failed'
    createdAt: number
    startedAt?: number
    completedAt?: number
    result?: string
    error?: string
    projectId?: string
    sourceType?: 'capture' | 'theme' | 'thread' | 'manual' | 'clickup'
    sourceId?: string
  }>
  taskChatMessages?: Record<string, Array<{ role: 'user' | 'agent'; text: string; ts: number }>>
  projects?: Array<{
    id: string
    name: string
    description: string
    createdAt: number
    status: 'active' | 'archived'
    taskIds: string[]
    contextFiles: Array<{
      id: string
      fileName: string
      filePath: string
      uploadedAt: number
      sizeBytes: number
    }>
  }>
  kbEntries?: Array<{
    id: string
    title: string
    sourceType: 'capture' | 'transcript' | 'manual' | 'agent'
    sourceId?: string
    summary: string
    savedAt: number
    tags: string[]
    folder?: string
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
