import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Onboarding
  onboarding: {
    getState: () => ipcRenderer.invoke('onboarding:get-state'),
    saveState: (state: unknown) => ipcRenderer.invoke('onboarding:save-state', state),
    complete: () => ipcRenderer.invoke('onboarding:complete')
  },

  // LLM Provider
  llm: {
    testConnection: (provider: string, apiKey: string) =>
      ipcRenderer.invoke('llm:test-connection', provider, apiKey),
    saveConfig: (provider: string, model: string, apiKey: string) =>
      ipcRenderer.invoke('llm:save-config', provider, model, apiKey),
    getConfig: () => ipcRenderer.invoke('llm:get-config')
  },

  // App
  app: {
    quit: () => ipcRenderer.invoke('app:quit'),
    minimizeToTray: () => ipcRenderer.invoke('app:minimize-to-tray'),
    showWindow: () => ipcRenderer.invoke('app:show-window'),
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url)
  },

  // Agent state persistence (legacy — used by agent-store for persisted state)
  agentState: {
    getState: () => ipcRenderer.invoke('agent:get-state'),
    setState: (state: unknown) => ipcRenderer.invoke('agent:set-state', state)
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value)
  },

  // File system
  fs: {
    selectFolder: () => ipcRenderer.invoke('fs:select-folder')
  },

  // ActiveCollab (non-OAuth — credential-based auth)
  activecollab: {
    connectCloud: (email: string, password: string) =>
      ipcRenderer.invoke('activecollab:connect-cloud', email, password),
    connectSelfHosted: (url: string, email: string, password: string) =>
      ipcRenderer.invoke('activecollab:connect-selfhosted', url, email, password),
    status: () => ipcRenderer.invoke('activecollab:status'),
    disconnect: () => ipcRenderer.invoke('activecollab:disconnect')
  },

  // Direct integrations
  clickup: {
    connect: (token: string) => ipcRenderer.invoke('clickup:connect', token),
    disconnect: () => ipcRenderer.invoke('clickup:disconnect'),
    status: () => ipcRenderer.invoke('clickup:status'),
    callAction: (actionName: string, params: Record<string, unknown>) =>
      ipcRenderer.invoke('clickup:call-action', actionName, params)
  },

  // Relay (remaining — moved to local in Phase 3)
  relay: {
    getUsage: () => ipcRenderer.invoke('relay:get-usage'),
    llmCompletion: (
      messages: Array<{ role: string; content: string }>,
      opts?: { model?: string; max_tokens?: number }
    ) => ipcRenderer.invoke('relay:llm-completion', messages, opts),
    extractUrl: (url: string) => ipcRenderer.invoke('relay:extract-url', url)
  },

  // Knowledge Base (legacy alias — routes through vault manager)
  kb: {
    saveCapture: (data: unknown) => ipcRenderer.invoke('kb:save-capture', data),
    readContext: () => ipcRenderer.invoke('kb:read-context'),
    appendDailyLog: (entry: string) => ipcRenderer.invoke('kb:append-daily-log', entry),
    getPath: () => ipcRenderer.invoke('kb:get-path'),
    openFolder: () => ipcRenderer.invoke('kb:open-folder'),
    importFiles: (filePaths: string[]) => ipcRenderer.invoke('kb:import-files', filePaths)
  },

  // Vault (Life OS v0.3)
  vault: {
    getMode: () => ipcRenderer.invoke('vault:get-mode'),
    setMode: (
      mode: { kind: 'managed' | 'external'; path: string },
      opts?: { createMissing?: boolean }
    ) => ipcRenderer.invoke('vault:set-mode', mode, opts),
    scanFolders: (root: string) => ipcRenderer.invoke('vault:scan-folders', root),
    listTree: (opts?: { maxDepth?: number }) => ipcRenderer.invoke('vault:list-tree', opts),
    readNote: (relPath: string) => ipcRenderer.invoke('vault:read-note', relPath),
    writeNote: (
      relPath: string,
      body: string,
      frontmatter: Record<string, unknown>,
      opts?: { preserveRaw?: string }
    ) => ipcRenderer.invoke('vault:write-note', relPath, body, frontmatter, opts),
    deleteNote: (relPath: string) => ipcRenderer.invoke('vault:delete-note', relPath),
    getPath: () => ipcRenderer.invoke('vault:get-path'),
    openFolder: () => ipcRenderer.invoke('vault:open-folder'),
    onChanged: (
      callback: (data: {
        kind: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
        path: string
        absPath: string
      }) => void
    ) => {
      const handler = (_event: unknown, data: Parameters<typeof callback>[0]): void =>
        callback(data)
      ipcRenderer.on('event:vault:changed', handler)
      return () => ipcRenderer.removeListener('event:vault:changed', handler)
    }
  },

  // Areas (Life OS v0.3 Phase 1)
  area: {
    list: () => ipcRenderer.invoke('area:list'),
    create: (input: {
      name: string
      description?: string
      emoji?: string
      reviewCadence?: 'weekly' | 'monthly'
    }) => ipcRenderer.invoke('area:create', input),
    update: (
      id: string,
      patch: Partial<{
        name: string
        description: string
        emoji: string
        reviewCadence: 'weekly' | 'monthly'
      }>
    ) => ipcRenderer.invoke('area:update', id, patch),
    archive: (id: string, note?: string) => ipcRenderer.invoke('area:archive', id, note),
    getHealth: (id: string) => ipcRenderer.invoke('area:get-health', id)
  },

  // Reviews (Life OS v0.3 Phase 1)
  review: {
    list: (period?: 'week' | 'month') => ipcRenderer.invoke('review:list', period),
    get: (id: string) => ipcRenderer.invoke('review:get', id),
    generate: (period: 'week' | 'month') => ipcRenderer.invoke('review:generate', period),
    acknowledge: (id: string) => ipcRenderer.invoke('review:acknowledge', id),
    addNotes: (id: string, notes: string) => ipcRenderer.invoke('review:add-notes', id, notes)
  },

  // Decisions (Life OS v0.3 Phase 1)
  decision: {
    list: () => ipcRenderer.invoke('decision:list'),
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
    }) => ipcRenderer.invoke('decision:create', input),
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
    ) => ipcRenderer.invoke('decision:update', id, patch),
    revisit: (id: string) => ipcRenderer.invoke('decision:revisit', id),
    complete: (
      id: string,
      retro: { actualOutcome: string; didMatch: boolean | 'partly'; lessons: string }
    ) => ipcRenderer.invoke('decision:complete', id, retro),
    supersede: (oldId: string, newId: string) =>
      ipcRenderer.invoke('decision:supersede', oldId, newId),
    scanDue: () => ipcRenderer.invoke('decision:scan-due')
  },

  // Memory
  memory: {
    search: (query: string) => ipcRenderer.invoke('memory:search', query),
    save: (data: {
      content: string
      type?: string
      summary?: string
      tags?: string[]
      importance?: number
      source_id?: string
    }) => ipcRenderer.invoke('memory:save', data),
    getStats: () => ipcRenderer.invoke('memory:get-stats'),
    getIdentity: () => ipcRenderer.invoke('memory:get-identity')
  },

  // Scheduler
  scheduler: {
    getTasks: () => ipcRenderer.invoke('scheduler:get-tasks'),
    setEnabled: (taskId: string, enabled: boolean) =>
      ipcRenderer.invoke('scheduler:set-enabled', taskId, enabled),
    runNow: (taskId: string) => ipcRenderer.invoke('scheduler:run-now', taskId)
  },

  // Telemetry
  telemetry: {
    setOptIn: (optIn: boolean) => ipcRenderer.invoke('telemetry:set-opt-in', optIn),
    getOptIn: () => ipcRenderer.invoke('telemetry:get-opt-in'),
    deleteData: () => ipcRenderer.invoke('telemetry:delete-data'),
    emit: (eventType: string, payload: Record<string, unknown>) =>
      ipcRenderer.invoke('telemetry:emit', eventType, payload),
    getQueue: () => ipcRenderer.invoke('telemetry:get-queue'),
    getStatus: () => ipcRenderer.invoke('telemetry:get-status')
  },

  // Agent Runtime (new — Anthropic-native, replaces gateway for chat)
  agent: {
    send: (sessionKey: string, message: string, idempotencyKey: string) =>
      ipcRenderer.invoke('agent:chat:send', sessionKey, message, idempotencyKey),
    stop: (sessionKey: string) => ipcRenderer.invoke('agent:chat:stop', sessionKey),
    listSessions: () => ipcRenderer.invoke('agent:session:list'),
    clearSession: (sessionKey: string) =>
      ipcRenderer.invoke('agent:session:clear', sessionKey),
    onStream: (
      callback: (data: { sessionKey: string; delta: string; type: string }) => void
    ) => {
      const handler = (_event: unknown, data: Parameters<typeof callback>[0]): void =>
        callback(data)
      ipcRenderer.on('event:agent:stream', handler)
      return () => ipcRenderer.removeListener('event:agent:stream', handler)
    },
    onToolCall: (
      callback: (data: {
        sessionKey: string
        toolName: string
        toolInput: Record<string, unknown>
      }) => void
    ) => {
      const handler = (_event: unknown, data: Parameters<typeof callback>[0]): void =>
        callback(data)
      ipcRenderer.on('event:agent:tool-call', handler)
      return () => ipcRenderer.removeListener('event:agent:tool-call', handler)
    },
    onToolResult: (
      callback: (data: {
        sessionKey: string
        toolName: string
        success: boolean
        summary: string
      }) => void
    ) => {
      const handler = (_event: unknown, data: Parameters<typeof callback>[0]): void =>
        callback(data)
      ipcRenderer.on('event:agent:tool-result', handler)
      return () => ipcRenderer.removeListener('event:agent:tool-result', handler)
    },
    onFinal: (
      callback: (data: {
        sessionKey: string
        message: string
        usage: { input_tokens: number; output_tokens: number }
      }) => void
    ) => {
      const handler = (_event: unknown, data: Parameters<typeof callback>[0]): void =>
        callback(data)
      ipcRenderer.on('event:agent:final', handler)
      return () => ipcRenderer.removeListener('event:agent:final', handler)
    },
    onError: (
      callback: (data: { sessionKey: string; error: string; partial?: string | null }) => void
    ) => {
      const handler = (_event: unknown, data: Parameters<typeof callback>[0]): void =>
        callback(data)
      ipcRenderer.on('event:agent:error', handler)
      return () => ipcRenderer.removeListener('event:agent:error', handler)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.api = api
}
