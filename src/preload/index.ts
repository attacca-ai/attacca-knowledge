import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // License
  license: {
    validate: (key: string) => ipcRenderer.invoke('license:validate', key),
    checkExisting: () => ipcRenderer.invoke('license:check-existing'),
    getStatus: () => ipcRenderer.invoke('license:get-status')
  },

  // Gateway
  gateway: {
    start: () => ipcRenderer.invoke('gateway:start'),
    stop: () => ipcRenderer.invoke('gateway:stop'),
    restart: () => ipcRenderer.invoke('gateway:restart'),
    status: () => ipcRenderer.invoke('gateway:status'),
    health: () => ipcRenderer.invoke('gateway:health'),
    getToken: () => ipcRenderer.invoke('gateway:get-token'),
    onStateChanged: (callback: (state: unknown) => void) => {
      const handler = (_event: unknown, state: unknown): void => callback(state)
      ipcRenderer.on('event:gateway-state-changed', handler)
      return () => ipcRenderer.removeListener('event:gateway-state-changed', handler)
    }
  },

  // Onboarding
  onboarding: {
    getState: () => ipcRenderer.invoke('onboarding:get-state'),
    saveState: (state: unknown) => ipcRenderer.invoke('onboarding:save-state', state),
    complete: () => ipcRenderer.invoke('onboarding:complete')
  },

  // OAuth
  oauth: {
    start: (provider: string) => ipcRenderer.invoke('oauth:start', provider),
    getStatus: (provider: string) => ipcRenderer.invoke('oauth:status', provider),
    disconnect: (provider: string) => ipcRenderer.invoke('oauth:disconnect', provider),
    getConnected: () => ipcRenderer.invoke('oauth:get-connected'),
    onCallback: (callback: (result: unknown) => void) => {
      const handler = (_event: unknown, result: unknown): void => callback(result)
      ipcRenderer.on('event:oauth-callback', handler)
      return () => ipcRenderer.removeListener('event:oauth-callback', handler)
    }
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

  // Agent state persistence
  agent: {
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

  // Relay (managed service)
  relay: {
    initiateOAuth: (appName: string) => ipcRenderer.invoke('relay:oauth-initiate', appName),
    getOAuthStatus: (connectionId: string) =>
      ipcRenderer.invoke('relay:oauth-status', connectionId),
    disconnectOAuth: (appName: string) => ipcRenderer.invoke('relay:oauth-disconnect', appName),
    getUsage: () => ipcRenderer.invoke('relay:get-usage'),
    getConnected: () => ipcRenderer.invoke('relay:get-connected'),
    callTool: (actionName: string, params: Record<string, unknown>) =>
      ipcRenderer.invoke('relay:call-tool', actionName, params)
  },

  // Telemetry
  telemetry: {
    setOptIn: (optIn: boolean) => ipcRenderer.invoke('telemetry:set-opt-in', optIn),
    getOptIn: () => ipcRenderer.invoke('telemetry:get-opt-in'),
    deleteData: () => ipcRenderer.invoke('telemetry:delete-data'),
    emit: (eventType: string, payload: Record<string, unknown>) =>
      ipcRenderer.invoke('telemetry:emit', eventType, payload)
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
