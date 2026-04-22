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

  // Composio (local)
  composio: {
    setApiKey: (apiKey: string) => ipcRenderer.invoke('composio:set-api-key', apiKey),
    getApiKey: () => ipcRenderer.invoke('composio:get-api-key'),
    initiateOAuth: (appName: string) => ipcRenderer.invoke('composio:initiate-oauth', appName),
    getStatus: (connectionId: string) => ipcRenderer.invoke('composio:get-status', connectionId),
    getConnected: () => ipcRenderer.invoke('composio:get-connected'),
    listApps: () => ipcRenderer.invoke('composio:list-apps'),
    listActions: (appSlug: string) => ipcRenderer.invoke('composio:list-actions', appSlug),
    callTool: (actionName: string, params: Record<string, unknown>) =>
      ipcRenderer.invoke('composio:call-tool', actionName, params),
    disconnect: (toolkitSlug: string) => ipcRenderer.invoke('composio:disconnect', toolkitSlug),
    getAccounts: () => ipcRenderer.invoke('composio:get-accounts'),
    setLabel: (connectionId: string, label: string, customName?: string | null) =>
      ipcRenderer.invoke('composio:set-label', connectionId, label, customName ?? null),
    setDefault: (toolkit: string, connectionId: string | null) =>
      ipcRenderer.invoke('composio:set-default', toolkit, connectionId),
    getDefaults: () => ipcRenderer.invoke('composio:get-defaults')
  },

  // Direct integrations
  clickup: {
    connect: (token: string) => ipcRenderer.invoke('clickup:connect', token),
    disconnect: () => ipcRenderer.invoke('clickup:disconnect'),
    status: () => ipcRenderer.invoke('clickup:status')
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

  // Knowledge Base
  kb: {
    saveCapture: (data: unknown) => ipcRenderer.invoke('kb:save-capture', data),
    readContext: () => ipcRenderer.invoke('kb:read-context'),
    appendDailyLog: (entry: string) => ipcRenderer.invoke('kb:append-daily-log', entry),
    getPath: () => ipcRenderer.invoke('kb:get-path'),
    openFolder: () => ipcRenderer.invoke('kb:open-folder'),
    importFiles: (filePaths: string[]) => ipcRenderer.invoke('kb:import-files', filePaths)
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

  // Permissions
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
    ) => {
      const handler = (_event: unknown, request: unknown): void =>
        callback(request as Parameters<typeof callback>[0])
      ipcRenderer.on('event:permission-request', handler)
      return () => ipcRenderer.removeListener('event:permission-request', handler)
    },
    resolve: (requestId: string, approved: boolean, standing: boolean) =>
      ipcRenderer.invoke('permission:resolve', requestId, approved, standing),
    listStanding: () => ipcRenderer.invoke('permission:list-standing'),
    revokeStanding: (actionName: string) =>
      ipcRenderer.invoke('permission:revoke-standing', actionName)
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
