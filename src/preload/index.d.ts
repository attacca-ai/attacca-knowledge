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

  clickup: {
    connect: (token: string) => Promise<{ success: boolean; workspaceName?: string; error?: string }>
    disconnect: () => Promise<{ success: boolean; error?: string }>
    status: () => Promise<{ connected: boolean; workspaceName: string | null }>
    callAction: (
      actionName: string,
      params: Record<string, unknown>
    ) => Promise<{ success: boolean; result?: unknown; error?: string | null }>
  }

  relay: {
    getUsage: () => Promise<{
      totalCostUsd: number
      requestCount: number
      models: Record<string, number>
      budgetAlert: number | null
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

  vault: {
    getMode: () => Promise<{ mode: VaultMode | null; path: string }>
    setMode: (
      mode: VaultMode,
      opts?: { createMissing?: boolean }
    ) => Promise<{
      success: boolean
      error?: string
      report?: VaultScanReport
    }>
    scanFolders: (root: string) => Promise<{
      success: boolean
      error?: string
      report?: VaultScanReport
    }>
    listTree: (opts?: { maxDepth?: number }) => Promise<{
      success: boolean
      error?: string
      tree: VaultTreeNode[]
    }>
    readNote: (relPath: string) => Promise<{
      success: boolean
      error?: string
      frontmatter?: Record<string, unknown>
      rawFrontmatter?: string
      body?: string
      path?: string
      absPath?: string
    }>
    writeNote: (
      relPath: string,
      body: string,
      frontmatter: Record<string, unknown>,
      opts?: { preserveRaw?: string }
    ) => Promise<{ success: boolean; error?: string; absPath?: string }>
    deleteNote: (relPath: string) => Promise<{
      success: boolean
      error?: string
      archivedTo?: string
    }>
    getPath: () => Promise<string>
    openFolder: () => Promise<{ success: boolean }>
    getExternalWrites: () => Promise<{
      success: boolean
      error?: string
      isExternal: boolean
      writes: Record<string, boolean>
      folders: string[]
    }>
    setExternalWrite: (
      folder: string,
      writable: boolean
    ) => Promise<{ success: boolean; error?: string }>
    listExternalTopFolders: () => Promise<{
      success: boolean
      error?: string
      folders: string[]
    }>
    onChanged: (
      callback: (data: {
        kind: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
        path: string
        absPath: string
      }) => void
    ) => () => void
  }

  area: {
    list: () => Promise<{ success: boolean; error?: string; areas: Area[] }>
    create: (input: {
      name: string
      description?: string
      emoji?: string
      reviewCadence?: 'weekly' | 'monthly'
    }) => Promise<{ success: boolean; error?: string; area?: Area }>
    update: (
      id: string,
      patch: Partial<{
        name: string
        description: string
        emoji: string
        reviewCadence: 'weekly' | 'monthly'
      }>
    ) => Promise<{ success: boolean; error?: string; area?: Area }>
    archive: (id: string, note?: string) => Promise<{ success: boolean; error?: string }>
    getHealth: (
      id: string
    ) => Promise<{ success: boolean; error?: string; health?: number }>
  }

  review: {
    list: (
      period?: 'week' | 'month'
    ) => Promise<{ success: boolean; error?: string; reviews: Review[] }>
    get: (id: string) => Promise<{ success: boolean; error?: string; review?: Review | null }>
    generate: (
      period: 'week' | 'month'
    ) => Promise<{ success: boolean; error?: string; review?: Review }>
    acknowledge: (
      id: string
    ) => Promise<{ success: boolean; error?: string; review?: Review }>
    addNotes: (
      id: string,
      notes: string
    ) => Promise<{ success: boolean; error?: string; review?: Review }>
  }

  decision: {
    list: () => Promise<{ success: boolean; error?: string; decisions: Decision[] }>
    create: (input: {
      title: string
      context: string
      options?: string[]
      chosen: string
      reasoning: string
      expectedOutcome: string
      revisitInDays: number
      areaId?: string
      projectId?: string
      tags?: string[]
    }) => Promise<{ success: boolean; error?: string; decision?: Decision }>
    update: (
      id: string,
      patch: Partial<{
        title: string
        context: string
        options: string[]
        chosen: string
        reasoning: string
        expectedOutcome: string
        revisitAt: number
        areaId: string
        projectId: string
        tags: string[]
      }>
    ) => Promise<{ success: boolean; error?: string; decision?: Decision }>
    revisit: (id: string) => Promise<{ success: boolean; error?: string; decision?: Decision }>
    complete: (
      id: string,
      retro: { actualOutcome: string; didMatch: boolean | 'partly'; lessons: string }
    ) => Promise<{ success: boolean; error?: string; decision?: Decision }>
    supersede: (
      oldId: string,
      newId: string
    ) => Promise<{ success: boolean; error?: string; decision?: Decision }>
    scanDue: () => Promise<{ success: boolean; error?: string; decisions: Decision[] }>
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

export type VaultMode =
  | { kind: 'managed'; path: string }
  | { kind: 'external'; path: string }

export interface VaultScanReport {
  root: string
  mode: 'managed' | 'external'
  present: string[]
  missing: string[]
  hasClaudeMd: boolean
}

export interface VaultTreeNode {
  name: string
  path: string
  absPath: string
  kind: 'folder' | 'file'
  size?: number
  mtime?: number
  children?: VaultTreeNode[]
}

export interface ReviewActivity {
  rangeStart: number
  rangeEnd: number
  capturesProcessed: number
  decisionsMade: string[]
  decisionsRevisited: string[]
  areasActive: string[]
  areasNeglected: string[]
  tasksCompleted: number
  tasksMoved: number
  projectsArchived: string[]
  lessonsExtracted: string[]
  patternsDetected: string[]
}

export interface Review {
  id: string
  period: 'week' | 'month'
  generatedAt: number
  rangeStart: number
  rangeEnd: number
  content: string
  highlights: ReviewActivity
  userNotes?: string
  acknowledged: boolean
  vaultPath: string
}

export interface DecisionRetrospective {
  actualOutcome: string
  didMatch: boolean | 'partly'
  lessons: string
  createdLessonId?: string
  revisitedAt: number
}

export interface Decision {
  id: string
  title: string
  context: string
  options: string[]
  chosen: string
  reasoning: string
  expectedOutcome: string
  revisitAt: number
  retrospective?: DecisionRetrospective
  areaId?: string
  projectId?: string
  tags: string[]
  createdAt: number
  status: 'active' | 'revisited' | 'reversed' | 'superseded'
  supersededBy?: string
  vaultPath: string
}

export interface Area {
  id: string
  name: string
  description: string
  emoji?: string
  healthScore?: number
  projectIds: string[]
  taskIds: string[]
  reviewCadence: 'weekly' | 'monthly'
  createdAt: number
  archived: boolean
  archivedAt?: number
  archiveNote?: string
  vaultPath: string
}

interface OnboardingState {
  currentStep: number
  vaultMode: VaultMode | null
  telemetryOptIn: boolean
  completed: boolean
  selectedAreas?: Array<{ name: string; emoji?: string }>
}

declare global {
  interface Window {
    api: AttaccaAPI
  }
}
