import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow, destroyMainWindow, getMainWindow } from './window/main-window'
import { createTray, destroyTray } from './tray/tray'
import { registerIpcHandlers } from './ipc/handlers'
import { ensureUsageTables } from './usage/tracker'
import { registerAllTasks } from './scheduler/tasks'
import { stopAll as stopScheduler } from './scheduler'
import { initTelemetryCollector, getTelemetryCollector } from './telemetry/collector'
import { getMemoryDb, closeMemoryDb } from './memory/db'
import { registerProvider } from './integrations/registry'
import { clickupProvider } from './integrations/clickup/provider'
import { migrateLegacyKbIfNeeded, startWatcher, onVaultChange } from './vault'
import { IPC } from './ipc/channels'

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
    electronApp.setAppUserModelId('com.attaccaclaw.app')

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // Initialize telemetry collector
    const collector = initTelemetryCollector()

    // Emit session started event
    collector.emit('app.session_started', {
      platform: process.platform,
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged
    })

    // Register direct integration providers (before IPC handlers so they're available immediately)
    registerProvider(clickupProvider)

    // Register IPC handlers
    registerIpcHandlers()

    // Vault migration + watcher (Life OS v0.3 Phase 1)
    try {
      migrateLegacyKbIfNeeded()
      await startWatcher()
      onVaultChange((event) => {
        const win = getMainWindow()
        if (win && !win.isDestroyed()) {
          win.webContents.send(IPC.EVENT_VAULT_CHANGED, event)
        }
      })
    } catch (err) {
      console.warn('[vault] Init failed:', err)
    }

    // Create main window
    createMainWindow()

    // Create system tray
    createTray(() => quitApp())

    // Initialize memory database (creates tables if needed)
    getMemoryDb()

    // Memory server removed — memory tools execute directly via SQLite

    // Initialize usage tracking tables
    ensureUsageTables()

    // Register background scheduler tasks
    registerAllTasks()
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

  stopScheduler()
  closeMemoryDb()
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
