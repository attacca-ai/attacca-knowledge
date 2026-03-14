import { ipcMain, app, shell, dialog } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { IPC } from './channels'
import { getGatewayState, startGateway, stopGateway, restartGateway } from '../gateway/lifecycle'
import { checkGatewayHealth } from '../gateway/health'
import { validateNewKey, checkExistingLicense } from '../license/validator'
import { loadLicense } from '../license/store'
import { writeConfig, readConfig, getGatewayToken, writeAgentAuthProfiles } from '../gateway/config'
import { registerActiveCollabHandlers } from './activecollab-handlers'
import { getMainWindow } from '../window/main-window'
import {
  relayInitiateOAuth,
  relayGetOAuthStatus,
  relayGetUsage,
  relayGetConnectedApps,
  relayProxyToolAction,
  relayLLMCompletion,
  relayListApps,
  relayExtractUrl
} from '../relay/client'
import { getTelemetryCollector } from '../telemetry/collector'

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

  ipcMain.handle(IPC.GATEWAY_GET_TOKEN, () => {
    return { token: getGatewayToken() }
  })

  // ── LLM Provider ──
  ipcMain.handle(IPC.LLM_TEST_CONNECTION, async (_event, provider: string, apiKey: string) => {
    try {
      const { testLLMConnection } = await import('../license/llm-test')
      return testLLMConnection(provider, apiKey)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

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
      // Also write auth-profiles.json so the gateway process can find the key directly
      writeAgentAuthProfiles(provider, apiKey)
      return { success: true }
    }
  )

  ipcMain.handle(IPC.LLM_GET_CONFIG, () => {
    const config = readConfig()
    if (!config.llm) return null
    return {
      provider: config.llm.provider,
      model: config.llm.model,
      apiKeyHint: config.llm.apiKey ? '****' + config.llm.apiKey.slice(-4) : null
    }
  })

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

  // ── Relay ──
  ipcMain.handle(IPC.RELAY_OAUTH_INITIATE, async (_event, appName: string) => {
    try {
      return await relayInitiateOAuth(appName)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'OAuth initiation failed' }
    }
  })

  ipcMain.handle(IPC.RELAY_OAUTH_STATUS, async (_event, connectionId: string) => {
    try {
      return await relayGetOAuthStatus(connectionId)
    } catch (err) {
      return { status: 'failed', error: err instanceof Error ? err.message : 'Status check failed' }
    }
  })

  ipcMain.handle(IPC.RELAY_OAUTH_DISCONNECT, async (_event, _appName: string) => {
    // Composio connections are managed server-side; client just removes local state
    return { success: true }
  })

  ipcMain.handle(IPC.RELAY_GET_USAGE, async () => {
    try {
      return await relayGetUsage()
    } catch (err) {
      return {
        totalCostUsd: 0,
        limitUsd: 30,
        requestCount: 0,
        limitReached: false,
        resetDate: new Date().toISOString(),
        error: err instanceof Error ? err.message : 'Failed to get usage'
      }
    }
  })

  ipcMain.handle(IPC.RELAY_GET_CONNECTED, async () => {
    try {
      return await relayGetConnectedApps()
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC.RELAY_CALL_TOOL, async (_event, actionName: string, params: Record<string, unknown>) => {
    try {
      return await relayProxyToolAction(actionName, params)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Tool call failed' }
    }
  })

  ipcMain.handle(IPC.RELAY_LLM_COMPLETION, async (_event, messages: Array<{ role: string; content: string }>, opts?: { model?: string; max_tokens?: number }) => {
    try {
      return await relayLLMCompletion({ messages, ...opts })
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'LLM completion failed' }
    }
  })

  ipcMain.handle(IPC.RELAY_LIST_APPS, async () => {
    try {
      return await relayListApps()
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC.RELAY_EXTRACT_URL, async (_event, url: string) => {
    try {
      return await relayExtractUrl(url)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'URL extraction failed' }
    }
  })

  // ── Agent state persistence ──
  ipcMain.handle(IPC.AGENT_GET_STATE, () => {
    const filePath = join(app.getPath('userData'), 'agent-state.json')
    if (!existsSync(filePath)) return null
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch {
      return null
    }
  })

  ipcMain.handle(IPC.AGENT_SET_STATE, (_event, state: unknown) => {
    const filePath = join(app.getPath('userData'), 'agent-state.json')
    const dir = dirname(filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8')
  })

  // ── Knowledge Base ──
  ipcMain.handle(IPC.KB_SAVE_CAPTURE, (_event, data: {
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
  }) => {
    const kbDir = join(app.getPath('userData'), 'attacca-kb')
    const date = new Date(data.timestamp)
    const dateStr = date.toISOString().slice(0, 10)
    const timeStr = date.toTimeString().slice(0, 5)

    // Write inbox capture file
    const inboxDir = join(kbDir, 'inbox', dateStr)
    mkdirSync(inboxDir, { recursive: true })

    const actionItemsMd = data.result.actionItems.length
      ? data.result.actionItems.map(i => `- [ ] ${i.text}${i.owner ? ` (${i.owner})` : ''}`).join('\n')
      : '_None_'
    const decisionsMd = data.result.decisions.length
      ? data.result.decisions.map(d => `- ${d}`).join('\n')
      : '_None_'
    const questionsMd = data.result.openQuestions.length
      ? data.result.openQuestions.map(q => `- ${q}`).join('\n')
      : '_None_'
    const entities = data.result.entities ?? {}
    const entitiesMd = [
      entities.people?.length ? `People: ${entities.people.join(', ')}` : '',
      entities.projects?.length ? `Projects: ${entities.projects.join(', ')}` : '',
      entities.dates?.length ? `Dates: ${entities.dates.join(', ')}` : ''
    ].filter(Boolean).join('\n') || '_None_'

    const captureContent = `---
id: ${data.id}
date: ${dateStr}
source: ${data.sourceType}
title: ${data.title}
---

## Summary
${data.result.summary}

## Action Items
${actionItemsMd}

## Decisions
${decisionsMd}

## Open Questions
${questionsMd}

## Entities
${entitiesMd}
`
    writeFileSync(join(inboxDir, `${data.id}-${data.sourceType}.md`), captureContent, 'utf-8')

    // Update CONTEXT.md
    const memoryDir = join(kbDir, 'memory')
    mkdirSync(memoryDir, { recursive: true })
    const ctxPath = join(memoryDir, 'CONTEXT.md')

    let ctxContent = existsSync(ctxPath)
      ? readFileSync(ctxPath, 'utf-8')
      : `# Attacca User Context\n\n## Recent Captures (last 5)\n<!-- agent-managed: do not edit manually -->\n\n## Active Projects\n<!-- agent-managed: do not edit manually -->\n\n## Key People\n<!-- agent-managed: do not edit manually -->\n`

    // Update Recent Captures section
    const newCaptureEntry = `- [${data.sourceType}] "${data.title}" — ${dateStr} ${timeStr}`
    const recentMatch = ctxContent.match(/(## Recent Captures[^\n]*\n<!-- agent-managed[^\n]*\n)([\s\S]*?)(## Active Projects)/)
    if (recentMatch) {
      const existing = recentMatch[2].trim().split('\n').filter(l => l.startsWith('-')).slice(0, 4)
      const updated = [newCaptureEntry, ...existing].join('\n')
      ctxContent = ctxContent.replace(
        /(## Recent Captures[^\n]*\n<!-- agent-managed[^\n]*\n)[\s\S]*?(## Active Projects)/,
        `$1${updated}\n\n$2`
      )
    }

    // Update Active Projects section
    if (entities.projects?.length) {
      for (const project of entities.projects) {
        if (!ctxContent.includes(project)) {
          ctxContent = ctxContent.replace(
            /(## Active Projects\n<!-- agent-managed[^\n]*\n)([\s\S]*?)(## Key People)/,
            (_m, header, body, next) => {
              const trimmed = body.trim()
              const newBody = trimmed ? `${trimmed}\n- ${project}` : `- ${project}`
              return `${header}${newBody}\n\n${next}`
            }
          )
        }
      }
    }

    // Update Key People section
    if (entities.people?.length) {
      for (const person of entities.people) {
        if (!ctxContent.includes(person)) {
          ctxContent = ctxContent.replace(
            /(## Key People\n<!-- agent-managed[^\n]*\n)([\s\S]*?)$/,
            (_m, header, body) => {
              const trimmed = body.trim()
              return `${header}${trimmed ? `${trimmed}\n- ${person}` : `- ${person}`}\n`
            }
          )
        }
      }
    }

    writeFileSync(ctxPath, ctxContent, 'utf-8')

    // Append to daily log
    const dailyDir = join(kbDir, 'daily')
    mkdirSync(dailyDir, { recursive: true })
    const dailyPath = join(dailyDir, `${dateStr}.md`)
    const dailyHeader = existsSync(dailyPath) ? '' : `# Daily Log — ${dateStr}\n\n`
    const logEntry = `${dailyHeader}## ${timeStr} — Capture saved\nSource: ${data.sourceType}\nTitle: ${data.title}\nAction items: ${data.result.actionItems.length} | Decisions: ${data.result.decisions.length} | Open questions: ${data.result.openQuestions.length}\n\n`
    writeFileSync(dailyPath, existsSync(dailyPath) ? readFileSync(dailyPath, 'utf-8') + logEntry : logEntry, 'utf-8')

    return { success: true }
  })

  ipcMain.handle(IPC.KB_READ_CONTEXT, () => {
    const ctxPath = join(app.getPath('userData'), 'attacca-kb', 'memory', 'CONTEXT.md')
    if (!existsSync(ctxPath)) return ''
    try {
      return readFileSync(ctxPath, 'utf-8')
    } catch {
      return ''
    }
  })

  ipcMain.handle(IPC.KB_APPEND_DAILY_LOG, (_event, entry: string) => {
    const kbDir = join(app.getPath('userData'), 'attacca-kb')
    const dailyDir = join(kbDir, 'daily')
    mkdirSync(dailyDir, { recursive: true })
    const dateStr = new Date().toISOString().slice(0, 10)
    const dailyPath = join(dailyDir, `${dateStr}.md`)
    const header = existsSync(dailyPath) ? '' : `# Daily Log — ${dateStr}\n\n`
    writeFileSync(dailyPath, (existsSync(dailyPath) ? readFileSync(dailyPath, 'utf-8') : '') + header + entry + '\n', 'utf-8')
    return { success: true }
  })

  // ── Telemetry ──
  ipcMain.handle(IPC.TELEMETRY_SET_OPT_IN, (_event, optIn: boolean) => {
    const collector = getTelemetryCollector()
    collector.setOptIn(optIn)
    return { success: true }
  })

  ipcMain.handle(IPC.TELEMETRY_GET_OPT_IN, () => {
    const collector = getTelemetryCollector()
    return { optIn: collector.getOptIn() }
  })

  ipcMain.handle(IPC.TELEMETRY_DELETE_DATA, async () => {
    const collector = getTelemetryCollector()
    await collector.deleteData()
    return { success: true }
  })

  ipcMain.handle(IPC.TELEMETRY_EMIT, (_event, eventType: string, payload: Record<string, unknown>) => {
    const collector = getTelemetryCollector()
    collector.emit(eventType, payload)
    return { success: true }
  })
}
