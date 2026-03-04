import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow, destroyMainWindow, getMainWindow } from './window/main-window'
import { createTray, destroyTray } from './tray/tray'
import { registerIpcHandlers } from './ipc/handlers'
import { startGateway, stopGateway } from './gateway/lifecycle'
import { startRelayServer, stopRelayServer } from './relay/lifecycle'
import { initTelemetryCollector, getTelemetryCollector } from './telemetry/collector'

// DEPRECATED: Direct OAuth integrations replaced by Composio relay in v1.1
// Kept for backward compatibility during migration
// import './oauth/integrations/gmail'
// import './oauth/integrations/clickup'
// import './oauth/integrations/google-drive'
// import './oauth/integrations/slack'
// import './oauth/integrations/outlook-email'

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const mainWindow = getMainWindow()
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.attacca.app')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Initialize telemetry collector
    initTelemetryCollector()

    // Register IPC handlers before creating windows
    registerIpcHandlers()

    // Create main window
    createMainWindow()

    // Create system tray
    createTray(() => quitApp())

    // Start local relay server (dev only; no-op when app.isPackaged)
    startRelayServer()

    // Start OpenClaw gateway
    try {
      await startGateway()
      console.log('[main] OpenClaw gateway started')
    } catch (err) {
      console.error('[main] Failed to start OpenClaw gateway:', err)
    }
  })

  // Keep app running when all windows are closed (tray mode)
  app.on('window-all-closed', () => {
    // Don't quit — stay in tray
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
}

let isQuitting = false

async function quitApp(): Promise<void> {
  if (isQuitting) return
  isQuitting = true

  console.log('[main] Quitting application...')

  try {
    await stopGateway()
  } catch (err) {
    console.error('[main] Error stopping gateway:', err)
  }

  stopRelayServer()
  destroyTray()
  destroyMainWindow()
  app.quit()
}

app.on('before-quit', async () => {
  isQuitting = true
  // Flush telemetry queue before quitting
  try {
    const collector = getTelemetryCollector()
    await collector.flush()
  } catch {
    // Best effort
  }
})
