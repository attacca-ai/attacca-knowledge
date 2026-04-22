import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createMainWindow, destroyMainWindow, getMainWindow } from './window/main-window'
import { createTray, destroyTray } from './tray/tray'
import { registerIpcHandlers } from './ipc/handlers'
import { invalidateConnectedAppsCache, runMultiAccountMigration } from './composio/service'
import { getComposioEntityId } from './identity/user-identity'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { ensureUsageTables } from './usage/tracker'
import { registerAllTasks } from './scheduler/tasks'
import { stopAll as stopScheduler } from './scheduler'
import { initTelemetryCollector, getTelemetryCollector } from './telemetry/collector'
import { getMemoryDb, closeMemoryDb } from './memory/db'
import { registerProvider } from './integrations/registry'
import { clickupProvider } from './integrations/clickup/provider'

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

    // When the main window regains focus (user returning from an external OAuth
    // browser tab), drop the connected-apps cache so the next read reflects any
    // connection made out-of-band.
    app.on('browser-window-focus', () => {
      invalidateConnectedAppsCache()
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

    // One-time multi-account migration (Spec B PR B2). Idempotent — gated by
    // settings.migrationsApplied.multi_account_v1. Runs in the background so
    // app boot isn't blocked on a Composio round-trip.
    void runOneTimeMigrations()
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

async function runOneTimeMigrations(): Promise<void> {
  try {
    const settingsPath = join(app.getPath('userData'), 'settings.json')
    let settings: Record<string, any> = {}
    if (existsSync(settingsPath)) {
      try {
        settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      } catch {
        settings = {}
      }
    }
    const migrationsApplied = (settings.migrationsApplied ?? {}) as Record<string, boolean>
    if (migrationsApplied.multi_account_v1) {
      return
    }

    const entityId = getComposioEntityId()
    const count = await runMultiAccountMigration(entityId)
    console.log(`[migration] multi_account_v1: auto-labeled ${count} existing connections as Work`)

    settings.migrationsApplied = { ...migrationsApplied, multi_account_v1: true }
    const dir = dirname(settingsPath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')

    try {
      getTelemetryCollector().emit('migration.multi_account_v1', { autoLabeled: count })
    } catch {
      /* telemetry is best-effort */
    }
  } catch (err) {
    console.error('[migration] multi_account_v1 failed:', err)
  }
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
