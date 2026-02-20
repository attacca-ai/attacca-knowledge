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
      ipcRenderer.invoke('llm:save-config', provider, model, apiKey)
  },

  // App
  app: {
    quit: () => ipcRenderer.invoke('app:quit'),
    minimizeToTray: () => ipcRenderer.invoke('app:minimize-to-tray'),
    showWindow: () => ipcRenderer.invoke('app:show-window'),
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url)
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value)
  },

  // File system
  fs: {
    selectFolder: () => ipcRenderer.invoke('fs:select-folder')
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
