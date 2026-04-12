import { ipcMain, app, shell, dialog } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { IPC } from './channels'
import { readLLMConfig, writeLLMConfig } from '../config/llm-config'
import { registerActiveCollabHandlers } from './activecollab-handlers'
import { llmCompletion } from '../llm/completion'
import { extractUrl } from '../capture/extractor'
import { getMonthlyUsage, ensureUsageTables } from '../usage/tracker'
import { getTaskStatuses, setTaskEnabled, runTaskNow } from '../scheduler'
import { getComposioEntityId } from '../identity/user-identity'
import {
  resolvePermission,
  clearAllStandingApprovals,
  revokeStandingApproval,
  listStandingApprovals
} from '../composio/permission-gate'
import {
  saveComposioApiKey,
  getComposioApiKeyHint,
  initiateOAuth as composioInitiateOAuth,
  getConnectionStatus as composioGetStatus,
  getConnectedApps as composioGetConnected,
  listApps as composioListApps,
  listAppActions as composioListActions,
  proxyToolAction as composioCallTool,
  executeActionDirect as composioCallToolDirect,
  disconnectAccount as composioDisconnect,
  invalidateConnectedAppsCache,
  getAccountsWithLabels as composioGetAccounts
} from '../composio/service'
import { setConnectionLabel, isValidLabel, type AccountLabel } from '../composio/connections'
import {
  setDefaultAccount,
  removeDefaultAccount,
  getAllDefaults
} from '../composio/defaults'
import { getTelemetryCollector } from '../telemetry/collector'
import { insertMemory, updateEmbedding, getMemoryStats, getIdentityTraits } from '../memory/db'
import { generateEmbedding, float32ToBuffer } from '../memory/embeddings'
import { searchMemories, searchMemoriesByKeyword } from '../memory/search'

export function registerIpcHandlers(): void {
  registerActiveCollabHandlers()
  // ── LLM Provider ──
  ipcMain.handle(IPC.LLM_TEST_CONNECTION, async (_event, provider: string, apiKey: string) => {
    try {
      const { testLLMConnection } = await import('../llm/test-connection')
      return testLLMConnection(provider, apiKey)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  })

  ipcMain.handle(
    IPC.LLM_SAVE_CONFIG,
    async (_event, provider: string, model: string, apiKey: string) => {
      console.log(`[llm] Saving config: provider=${provider} model=${model}`)
      writeLLMConfig({
        provider: provider as 'anthropic',
        model,
        apiKey
      })
      console.log('[llm] Config saved')
      return { success: true }
    }
  )

  ipcMain.handle(IPC.LLM_GET_CONFIG, () => {
    const config = readLLMConfig()
    if (!config) return null
    return {
      provider: config.provider,
      model: config.model,
      apiKeyHint: config.apiKey ? '****' + config.apiKey.slice(-4) : null
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
    console.log('[onboarding] Completed')
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

    // DVR-4: changing trust profile clears all standing approvals atomically.
    // `clearAllStandingApprovals` updates both the in-memory Map and the
    // on-disk `standingApprovals` key BEFORE the new profile is written, so
    // no in-flight gate check can observe the new profile with old grants.
    if (key === 'trustProfile' && settings.trustProfile !== value) {
      // M1: Snapshot the old profile BEFORE any mutation. Previously we
      // re-read settings.json after clearAllStandingApprovals and read
      // `settings.trustProfile` — correct in practice but fragile to changes
      // in the re-read path. Capture once, use throughout.
      const oldProfile = settings.trustProfile
      try {
        const cleared = clearAllStandingApprovals()
        if (cleared > 0) {
          console.log(
            `[settings] Trust profile changed — cleared ${cleared} standing approvals (DVR-4)`
          )
          // Re-read so our next write doesn't clobber the standingApprovals
          // reset that clearAllStandingApprovals just performed.
          settings = JSON.parse(readFileSync(filePath, 'utf-8'))
        }
        getTelemetryCollector().emit('standing_approval.cleared_on_profile_change', {
          count: cleared,
          oldProfile,
          newProfile: value
        })
      } catch (err) {
        console.error('[settings] Failed to clear standing approvals on profile change:', err)
      }
    }

    settings[key] = value
    writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8')
  })

  // ── Composio (local) ──
  ipcMain.handle(IPC.COMPOSIO_SET_API_KEY, (_event, apiKey: string) => {
    try {
      saveComposioApiKey(apiKey)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to save key' }
    }
  })

  ipcMain.handle(IPC.COMPOSIO_GET_API_KEY, () => {
    return { hint: getComposioApiKeyHint() }
  })

  ipcMain.handle(IPC.COMPOSIO_INITIATE_OAUTH, async (_event, appName: string) => {
    try {
      const entityId = getComposioEntityId()
      const result = await composioInitiateOAuth(entityId, appName)
      return { success: true, ...result }
    } catch (err) {
      console.error('[composio] OAuth initiation failed:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'OAuth initiation failed'
      }
    }
  })

  ipcMain.handle(IPC.COMPOSIO_GET_STATUS, async (_event, connectionId: string) => {
    try {
      const status = await composioGetStatus(connectionId)
      // A newly-active connection changes the connected-apps list — drop the cache
      // so the next agent turn and the next ConnectionsPage read pick it up.
      if (status.status === 'active') {
        invalidateConnectedAppsCache()
      }
      return status
    } catch (err) {
      return { status: 'failed', error: err instanceof Error ? err.message : 'Status check failed' }
    }
  })

  ipcMain.handle(IPC.COMPOSIO_DISCONNECT, async (_event, toolkitSlug: string) => {
    try {
      const entityId = getComposioEntityId()
      const result = await composioDisconnect(entityId, toolkitSlug)
      return result
    } catch (err) {
      return {
        success: false,
        deleted: 0,
        error: err instanceof Error ? err.message : 'Disconnect failed'
      }
    }
  })

  ipcMain.handle(IPC.COMPOSIO_GET_ACCOUNTS, async () => {
    try {
      const entityId = getComposioEntityId()
      const accounts = await composioGetAccounts(entityId)
      return { success: true, accounts }
    } catch (err) {
      return {
        success: false,
        accounts: [],
        error: err instanceof Error ? err.message : 'Failed to get accounts'
      }
    }
  })

  ipcMain.handle(
    IPC.COMPOSIO_SET_LABEL,
    (_event, connectionId: string, label: string, customName?: string | null) => {
      try {
        if (!isValidLabel(label)) {
          return { success: false, error: `Invalid label: ${label}` }
        }
        const ok = setConnectionLabel(connectionId, label as AccountLabel, customName)
        if (!ok) {
          return { success: false, error: 'Unknown connection' }
        }
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Set label failed' }
      }
    }
  )

  ipcMain.handle(
    IPC.COMPOSIO_SET_DEFAULT,
    (_event, toolkit: string, connectionId: string | null) => {
      try {
        if (connectionId) {
          setDefaultAccount(toolkit, connectionId)
        } else {
          removeDefaultAccount(toolkit)
        }
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Set default failed' }
      }
    }
  )

  ipcMain.handle(IPC.COMPOSIO_GET_DEFAULTS, () => {
    try {
      return { success: true, defaults: getAllDefaults() }
    } catch (err) {
      return {
        success: false,
        defaults: {},
        error: err instanceof Error ? err.message : 'Get defaults failed'
      }
    }
  })

  ipcMain.handle(IPC.COMPOSIO_GET_CONNECTED, async () => {
    try {
      const entityId = getComposioEntityId()
      const connected = await composioGetConnected(entityId)
      console.log('[composio] Connected tools:', connected)
      return connected
    } catch (err) {
      console.error('[composio] Failed to get connected tools:', err)
      return []
    }
  })

  ipcMain.handle(IPC.COMPOSIO_LIST_APPS, async () => {
    try {
      return await composioListApps()
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC.COMPOSIO_LIST_ACTIONS, async (_event, appSlug: string) => {
    try {
      return await composioListActions(appSlug)
    } catch {
      return []
    }
  })

  ipcMain.handle(
    IPC.COMPOSIO_CALL_TOOL,
    async (_event, actionName: string, params: Record<string, unknown>) => {
      try {
        const entityId = getComposioEntityId()
        let raw: Record<string, unknown>

        // Try SDK first, fall back to REST API (same pattern as composio server)
        try {
          raw = (await composioCallTool(entityId, actionName, params)) as Record<string, unknown>
        } catch (sdkErr) {
          console.warn(
            `[ipc] SDK call failed for ${actionName}, trying REST:`,
            (sdkErr as Error).message
          )
          raw = (await composioCallToolDirect(entityId, actionName, params)) as Record<
            string,
            unknown
          >
        }

        // Normalize Composio SDK response { successful, data, error }
        // to the shape callers expect { success, result, error }
        return {
          success: raw?.successful ?? true,
          result: raw?.data ?? raw,
          error: raw?.error ?? null
        }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Tool call failed' }
      }
    }
  )

  // ── Usage (local) ──
  ipcMain.handle(IPC.RELAY_GET_USAGE, () => {
    try {
      ensureUsageTables()
      const usage = getMonthlyUsage()
      return {
        totalCostUsd: usage.totalCostUsd,
        requestCount: usage.requestCount,
        models: usage.models,
        budgetAlert: usage.budgetAlert
      }
    } catch (err) {
      return {
        totalCostUsd: 0,
        requestCount: 0,
        models: {},
        budgetAlert: null,
        error: err instanceof Error ? err.message : 'Failed to get usage'
      }
    }
  })

  // ── LLM Completion (local BYOK) ──
  ipcMain.handle(
    IPC.RELAY_LLM_COMPLETION,
    async (
      _event,
      messages: Array<{ role: string; content: string }>,
      opts?: { model?: string; max_tokens?: number }
    ) => {
      console.log(
        `[ipc] relay:llm-completion messages=${messages.length} model=${opts?.model || 'default'}`
      )
      try {
        const result = await llmCompletion({ messages, ...opts })
        return result
      } catch (err) {
        console.error('[ipc] relay:llm-completion error:', err)
        return {
          success: false,
          error: err instanceof Error ? err.message : 'LLM completion failed'
        }
      }
    }
  )

  // ── URL Extraction (local) ──
  ipcMain.handle(IPC.RELAY_EXTRACT_URL, async (_event, url: string) => {
    try {
      return await extractUrl(url)
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
  ipcMain.handle(
    IPC.KB_SAVE_CAPTURE,
    (
      _event,
      data: {
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
      }
    ) => {
      console.log(
        `[kb] Saving capture: id=${data.id} type=${data.sourceType} title="${data.title}"`
      )
      const kbDir = join(app.getPath('userData'), 'attacca-kb')
      const date = new Date(data.timestamp)
      const dateStr = date.toISOString().slice(0, 10)
      const timeStr = date.toTimeString().slice(0, 5)

      // Write inbox capture file
      const inboxDir = join(kbDir, 'inbox', dateStr)
      mkdirSync(inboxDir, { recursive: true })

      const actionItemsMd = data.result.actionItems.length
        ? data.result.actionItems
            .map((i) => `- [ ] ${i.text}${i.owner ? ` (${i.owner})` : ''}`)
            .join('\n')
        : '_None_'
      const decisionsMd = data.result.decisions.length
        ? data.result.decisions.map((d) => `- ${d}`).join('\n')
        : '_None_'
      const questionsMd = data.result.openQuestions.length
        ? data.result.openQuestions.map((q) => `- ${q}`).join('\n')
        : '_None_'
      const entities = data.result.entities ?? {}
      const entitiesMd =
        [
          entities.people?.length ? `People: ${entities.people.join(', ')}` : '',
          entities.projects?.length ? `Projects: ${entities.projects.join(', ')}` : '',
          entities.dates?.length ? `Dates: ${entities.dates.join(', ')}` : ''
        ]
          .filter(Boolean)
          .join('\n') || '_None_'

      const tags: string[] = []
      if (entities.projects?.length)
        tags.push(...entities.projects.map((p) => p.toLowerCase()))
      if (entities.people?.length)
        tags.push(
          ...entities.people.slice(0, 3).map((p) => `person:${p.toLowerCase()}`)
        )

      const captureContent = `---
id: ${data.id}
date: ${dateStr}
type: capture
status: active
tags: [${tags.map((t) => `"${t}"`).join(', ')}]
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

      // Route decisions to dedicated decisions/ directory
      if (data.result?.decisions?.length > 0) {
        const decisionsDir = join(app.getPath('userData'), 'attacca-kb', 'decisions')
        if (!existsSync(decisionsDir)) mkdirSync(decisionsDir, { recursive: true })

        for (const decision of data.result.decisions) {
          const slug = decision
            .slice(0, 40)
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9 ]/g, '')
            .trim()
            .replace(/ +/g, '-')
          const decisionFile = join(decisionsDir, `${dateStr}-${slug}.md`)
          const decisionContent = `---
date: ${dateStr}
type: decision
status: active
tags: [${tags.map((t) => `"${t}"`).join(', ')}]
source: ${data.sourceType || 'conversation'}
---

## Decision

${decision}

## Context

From: ${data.title || 'Untitled capture'}
Date: ${dateStr}
`
          writeFileSync(decisionFile, decisionContent, 'utf-8')

          // Insert each decision as a separate memory with higher importance
          const decisionMemId = `mem_decision_${data.id}_${slug.slice(0, 20)}`
          insertMemory({
            id: decisionMemId,
            type: 'decision',
            content: decision,
            summary: decision.slice(0, 200),
            embedding: null,
            source_id: data.id,
            tags: JSON.stringify(tags),
            importance: 0.7,
            created_at: data.timestamp,
            superseded_by: null
          })

          // Generate embedding async for each decision memory
          generateEmbedding(decision)
            .then((emb) => {
              if (emb) {
                updateEmbedding(decisionMemId, float32ToBuffer(emb))
              }
            })
            .catch(() => {
              /* embedding backfill will catch this later */
            })
        }
      }

      // Update CONTEXT.md
      const memoryDir = join(kbDir, 'memory')
      mkdirSync(memoryDir, { recursive: true })
      const ctxPath = join(memoryDir, 'CONTEXT.md')

      let ctxContent = existsSync(ctxPath)
        ? readFileSync(ctxPath, 'utf-8')
        : `# Attacca User Context\n\n## Recent Captures (last 5)\n<!-- agent-managed: do not edit manually -->\n\n## Active Projects\n<!-- agent-managed: do not edit manually -->\n\n## Key People\n<!-- agent-managed: do not edit manually -->\n`

      // Update Recent Captures section
      const newCaptureEntry = `- [${data.sourceType}] "${data.title}" — ${dateStr} ${timeStr}`
      const recentMatch = ctxContent.match(
        /(## Recent Captures[^\n]*\n<!-- agent-managed[^\n]*\n)([\s\S]*?)(## Active Projects)/
      )
      if (recentMatch) {
        const existing = recentMatch[2]
          .trim()
          .split('\n')
          .filter((l) => l.startsWith('-'))
          .slice(0, 4)
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

      // Enforce 150-line cap — trim oldest content from the top
      const ctxLines = ctxContent.split('\n')
      if (ctxLines.length > 150) {
        const trimmed = ctxLines.slice(ctxLines.length - 150).join('\n')
        writeFileSync(ctxPath, trimmed, 'utf-8')
      } else {
        writeFileSync(ctxPath, ctxContent, 'utf-8')
      }

      // Append to daily log
      const dailyDir = join(kbDir, 'daily')
      mkdirSync(dailyDir, { recursive: true })
      const dailyPath = join(dailyDir, `${dateStr}.md`)
      const dailyHeader = existsSync(dailyPath) ? '' : `# Daily Log — ${dateStr}\n\n`
      const logEntry = `${dailyHeader}## ${timeStr} — ${data.sourceType} saved\nSource: ${data.sourceType}\nType: capture\nTitle: ${data.title}\nAction items: ${data.result.actionItems.length} | Decisions: ${data.result.decisions.length} | Open questions: ${data.result.openQuestions.length}\n\n`
      writeFileSync(
        dailyPath,
        existsSync(dailyPath) ? readFileSync(dailyPath, 'utf-8') + logEntry : logEntry,
        'utf-8'
      )

      // Persist to memory DB for semantic search (embedding generated async — non-blocking)
      const memId = `mem_capture_${data.id}`
      const memContent = `${data.result.summary}\n\nKey points: ${(data.result.keyPoints || []).join('; ')}\nDecisions: ${data.result.decisions.join('; ') || 'none'}`
      const memTags = [
        ...(entities.people || []).map((p) => `person:${p}`),
        ...(entities.projects || []).map((p) => `project:${p}`),
        `source:${data.sourceType}`
      ]

      insertMemory({
        id: memId,
        type: 'capture',
        content: memContent,
        summary: data.result.summary,
        embedding: null, // filled async below
        source_id: data.id,
        tags: JSON.stringify(memTags),
        importance: data.result.decisions.length > 0 ? 0.7 : 0.5,
        created_at: data.timestamp,
        superseded_by: null
      })

      // OpenClaw dual-write removed — single write to Attacca memory DB only

      // Generate embedding async — don't block the capture save
      generateEmbedding(`${data.result.summary}\n${memContent}`)
        .then((emb) => {
          if (emb) {
            updateEmbedding(memId, float32ToBuffer(emb))
          }
        })
        .catch(() => {
          /* embedding backfill will catch this later */
        })

      return { success: true }
    }
  )

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
    writeFileSync(
      dailyPath,
      (existsSync(dailyPath) ? readFileSync(dailyPath, 'utf-8') : '') + header + entry + '\n',
      'utf-8'
    )
    return { success: true }
  })

  ipcMain.handle(IPC.KB_GET_PATH, () => {
    return join(app.getPath('userData'), 'attacca-kb')
  })

  ipcMain.handle(IPC.KB_OPEN_FOLDER, async () => {
    const kbPath = join(app.getPath('userData'), 'attacca-kb')
    mkdirSync(kbPath, { recursive: true })
    const { shell } = await import('electron')
    shell.openPath(kbPath)
    return { success: true }
  })

  ipcMain.handle(
    IPC.KB_IMPORT_FILES,
    async (_event, paths: string[]) => {
      const { readdirSync, statSync } = await import('fs')
      const kbDir = join(app.getPath('userData'), 'attacca-kb', 'inbox', 'imported')
      mkdirSync(kbDir, { recursive: true })
      const imported: Array<{ fileName: string; title: string }> = []

      // Collect all .md files — input can be file paths or folder paths
      const mdFiles: string[] = []
      for (const p of paths) {
        try {
          if (statSync(p).isDirectory()) {
            const entries = readdirSync(p).filter((f) => f.endsWith('.md') || f.endsWith('.txt'))
            mdFiles.push(...entries.map((f) => join(p, f)))
          } else if (p.endsWith('.md') || p.endsWith('.txt')) {
            mdFiles.push(p)
          }
        } catch {
          /* skip inaccessible paths */
        }
      }

      for (const fp of mdFiles) {
        try {
          const fileName = fp.split(/[/\\]/).pop() ?? 'unknown.md'
          const content = readFileSync(fp, 'utf-8')
          const destPath = join(kbDir, fileName)
          writeFileSync(destPath, content, 'utf-8')
          const titleMatch = content.match(/^#\s+(.+)/m)
          const title = titleMatch ? titleMatch[1].trim() : fileName.replace(/\.(md|txt)$/, '')
          imported.push({ fileName, title })
        } catch {
          /* skip unreadable files */
        }
      }
      return { success: true, imported }
    }
  )

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

  ipcMain.handle(
    IPC.TELEMETRY_EMIT,
    (_event, eventType: string, payload: Record<string, unknown>) => {
      const collector = getTelemetryCollector()
      collector.emit(eventType, payload)
      return { success: true }
    }
  )

  ipcMain.handle(IPC.TELEMETRY_GET_QUEUE, () => {
    const collector = getTelemetryCollector()
    return { events: collector.getQueuedEvents() }
  })

  ipcMain.handle(IPC.TELEMETRY_GET_STATUS, () => {
    const collector = getTelemetryCollector()
    return {
      optedIn: collector.getOptIn(),
      lastFlush: collector.getLastFlush(),
      queueSize: collector.getQueueSize()
    }
  })

  // ── Scheduler ──
  ipcMain.handle(IPC.SCHEDULER_GET_TASKS, () => {
    return getTaskStatuses()
  })

  ipcMain.handle(IPC.SCHEDULER_SET_ENABLED, (_event, taskId: string, enabled: boolean) => {
    setTaskEnabled(taskId, enabled)
    return { success: true }
  })

  ipcMain.handle(IPC.SCHEDULER_RUN_NOW, async (_event, taskId: string) => {
    try {
      await runTaskNow(taskId)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Task failed' }
    }
  })

  // ── Permissions ──
  ipcMain.handle(
    IPC.PERMISSION_RESOLVE,
    (_event, requestId: string, approved: boolean, standing: boolean) => {
      resolvePermission(requestId, approved, standing)
      return { success: true }
    }
  )

  ipcMain.handle(IPC.PERMISSION_LIST_STANDING, () => {
    try {
      return { success: true, approvals: listStandingApprovals() }
    } catch (err) {
      return {
        success: false,
        approvals: [],
        error: err instanceof Error ? err.message : 'List failed'
      }
    }
  })

  ipcMain.handle(IPC.PERMISSION_REVOKE_STANDING, (_event, actionName: string) => {
    try {
      const revoked = revokeStandingApproval(actionName)
      return { success: true, revoked }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Revoke failed' }
    }
  })

  // ── Memory ──
  ipcMain.handle(IPC.MEMORY_SEARCH, async (_event, query: string) => {
    console.log(`[memory] Search: "${query.slice(0, 80)}"`)
    try {
      const queryEmb = await generateEmbedding(query)
      const results = queryEmb ? searchMemories(queryEmb) : searchMemoriesByKeyword(query)
      console.log(
        `[memory] Search results: ${results.length} found (${queryEmb ? 'semantic' : 'keyword'})`
      )
      return { success: true, results }
    } catch (err) {
      console.error('[memory] Search error:', err)
      return { success: false, error: (err as Error).message, results: [] }
    }
  })

  ipcMain.handle(
    IPC.MEMORY_SAVE,
    async (
      _event,
      data: {
        content: string
        type?: string
        summary?: string
        tags?: string[]
        importance?: number
        source_id?: string
      }
    ) => {
      try {
        console.log(
          `[memory] Save: type=${data.type || 'preference'} content="${data.content.slice(0, 80)}..."`
        )
        const id = `mem_${crypto.randomUUID()}`
        const summary = data.summary || data.content.slice(0, 200)
        const embedding = await generateEmbedding(`${summary}\n${data.content}`)

        insertMemory({
          id,
          type: (data.type || 'preference') as
            | 'capture'
            | 'preference'
            | 'decision'
            | 'identity'
            | 'synthesis',
          content: data.content,
          summary,
          embedding: embedding ? float32ToBuffer(embedding) : null,
          source_id: data.source_id || null,
          tags: JSON.stringify(data.tags || []),
          importance: data.importance ?? 0.5,
          created_at: Date.now(),
          superseded_by: null
        })

        return { success: true, id }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(IPC.MEMORY_GET_STATS, () => {
    try {
      return { success: true, ...getMemoryStats() }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.MEMORY_GET_IDENTITY, () => {
    try {
      const traits = getIdentityTraits()
      return {
        success: true,
        traits: traits.map((t) => ({ key: t.key, value: t.value, confidence: t.confidence }))
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // ── Agent Runtime ──
  ipcMain.handle(
    IPC.AGENT_CHAT_SEND,
    async (_event, sessionKey: string, message: string, idempotencyKey: string) => {
      try {
        const { sendMessage } = await import('../runtime/agent')
        await sendMessage(sessionKey, message, idempotencyKey)
        return { success: true }
      } catch (err) {
        console.error('[agent] Chat send error:', err)
        return { success: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(IPC.AGENT_CHAT_STOP, (_event, sessionKey: string) => {
    try {
      const { stopSession } = require('../runtime/agent') as typeof import('../runtime/agent')
      stopSession(sessionKey)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.AGENT_SESSION_LIST, () => {
    try {
      const { listSessions } = require('../runtime/agent') as typeof import('../runtime/agent')
      return { success: true, sessions: listSessions() }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.AGENT_SESSION_CLEAR, (_event, sessionKey: string) => {
    try {
      const { clearSession } = require('../runtime/agent') as typeof import('../runtime/agent')
      clearSession(sessionKey)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}
