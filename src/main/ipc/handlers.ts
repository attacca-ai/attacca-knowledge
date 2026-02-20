import { ipcMain, app, shell, dialog } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { IPC } from './channels'
import { getGatewayState, startGateway, stopGateway, restartGateway } from '../gateway/lifecycle'
import { checkGatewayHealth } from '../gateway/health'
import { validateNewKey, checkExistingLicense } from '../license/validator'
import { loadLicense } from '../license/store'
import { writeConfig, readConfig } from '../gateway/config'
import { registerActiveCollabHandlers } from './activecollab-handlers'
import { getMainWindow } from '../window/main-window'

export function registerIpcHandlers(): void {
  // Register non-OAuth integration handlers
  registerActiveCollabHandlers()
  // ── License ──
  ipcMain.handle(IPC.LICENSE_VALIDATE, async (_event, key: string) => {
    const result = await validateNewKey(key)
    return {
      success: result.status === 'valid',
      plan: result.plan,
      error: result.error
    }
  })

  ipcMain.handle(IPC.LICENSE_CHECK_EXISTING, async () => {
    const result = await checkExistingLicense()
    return {
      exists: result.status !== 'unchecked',
      valid: result.status === 'valid' || result.status === 'grace',
      plan: result.plan,
      error: result.error
    }
  })

  ipcMain.handle(IPC.LICENSE_GET_STATUS, () => {
    const stored = loadLicense()
    if (!stored) return { status: 'unchecked' }
    return {
      status: 'valid',
      plan: stored.plan,
      lastValidated: stored.validatedAt
    }
  })

  // ── Gateway ──
  ipcMain.handle(IPC.GATEWAY_START, async () => {
    await startGateway()
    return { success: true }
  })

  ipcMain.handle(IPC.GATEWAY_STOP, async () => {
    await stopGateway()
    return { success: true }
  })

  ipcMain.handle(IPC.GATEWAY_RESTART, async () => {
    await restartGateway()
    return { success: true }
  })

  ipcMain.handle(IPC.GATEWAY_STATUS, () => {
    return getGatewayState()
  })

  ipcMain.handle(IPC.GATEWAY_HEALTH, async () => {
    return checkGatewayHealth()
  })

  // ── LLM Provider ──
  ipcMain.handle(
    IPC.LLM_TEST_CONNECTION,
    async (_event, provider: string, apiKey: string) => {
      try {
        const { testLLMConnection } = await import('../license/llm-test')
        return testLLMConnection(provider, apiKey)
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
      }
    }
  )

  ipcMain.handle(
    IPC.LLM_SAVE_CONFIG,
    async (_event, provider: string, model: string, apiKey: string) => {
      const config = readConfig()
      config.llm = {
        provider: provider as 'anthropic' | 'openai' | 'google',
        model,
        apiKey
      }
      writeConfig(config)
      return { success: true }
    }
  )

  // ── Onboarding ──
  ipcMain.handle(IPC.ONBOARDING_GET_STATE, () => {
    const filePath = join(app.getPath('userData'), 'onboarding.json')
    if (!existsSync(filePath)) return null
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.ONBOARDING_SAVE_STATE, (_event, state: unknown) => {
    const filePath = join(app.getPath('userData'), 'onboarding.json')
    const dir = dirname(filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8')
  })

  ipcMain.handle(IPC.ONBOARDING_COMPLETE, () => {
    const filePath = join(app.getPath('userData'), 'onboarding.json')
    const dir = dirname(filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    let state: Record<string, unknown> = {}
    if (existsSync(filePath)) {
      try {
        state = JSON.parse(readFileSync(filePath, 'utf-8'))
      } catch {
        /* empty */
      }
    }
    state.completed = true
    writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8')
  })

  // ── OAuth ──
  ipcMain.handle(IPC.OAUTH_START, async (_event, provider: string) => {
    // Telegram uses a bot token + deep link flow, not standard OAuth
    if (provider === 'telegram') {
      try {
        const { startConnection } = await import('../integrations/telegram/connector')
        await startConnection()
        const mainWindow = getMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC.EVENT_OAUTH_CALLBACK, {
            provider: 'telegram',
            success: true
          })
        }
        return { success: true }
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Telegram connection failed'
        const mainWindow = getMainWindow()
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC.EVENT_OAUTH_CALLBACK, {
            provider: 'telegram',
            success: false,
            error
          })
        }
        return { success: false, error }
      }
    }

    try {
      const { startOAuthFlow } = await import('../oauth/server')
      return startOAuthFlow(provider)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'OAuth failed' }
    }
  })

  ipcMain.handle(IPC.OAUTH_STATUS, async (_event, provider: string) => {
    try {
      const { getOAuthStatus } = await import('../oauth/server')
      return getOAuthStatus(provider)
    } catch {
      return { connected: false }
    }
  })

  ipcMain.handle(IPC.OAUTH_DISCONNECT, async (_event, provider: string) => {
    try {
      // Non-OAuth tools have their own disconnect logic
      if (provider === 'telegram') {
        const { disconnect } = await import('../integrations/telegram/connector')
        disconnect()
        return { success: true }
      }
      if (provider === 'activecollab') {
        const { disconnect } = await import('../integrations/activecollab/connector')
        disconnect()
        return { success: true }
      }

      const { disconnectTool } = await import('../oauth/server')
      disconnectTool(provider)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Disconnect failed' }
    }
  })

  ipcMain.handle(IPC.OAUTH_GET_CONNECTED, async () => {
    try {
      const { getConnectedTools } = await import('../oauth/server')
      return getConnectedTools()
    } catch {
      return []
    }
  })

  // ── App ──
  ipcMain.handle(IPC.APP_GET_VERSION, () => {
    return app.getVersion()
  })

  ipcMain.handle(IPC.APP_OPEN_EXTERNAL, async (_event, url: string) => {
    await shell.openExternal(url)
  })

  ipcMain.handle(IPC.APP_QUIT, () => {
    app.quit()
  })

  // ── File system ──
  ipcMain.handle(IPC.FS_SELECT_FOLDER, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    if (result.canceled) return null
    return result.filePaths[0]
  })

  // ── Settings ──
  ipcMain.handle(IPC.SETTINGS_GET, (_event, key: string) => {
    const filePath = join(app.getPath('userData'), 'settings.json')
    if (!existsSync(filePath)) return null
    try {
      const settings = JSON.parse(readFileSync(filePath, 'utf-8'))
      return settings[key] ?? null
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.SETTINGS_SET, (_event, key: string, value: unknown) => {
    const filePath = join(app.getPath('userData'), 'settings.json')
    let settings: Record<string, unknown> = {}
    if (existsSync(filePath)) {
      try {
        settings = JSON.parse(readFileSync(filePath, 'utf-8'))
      } catch {
        /* empty */
      }
    }
    settings[key] = value
    writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8')
  })
}
