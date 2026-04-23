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

    settings[key] = value
    writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8')
  })

  // ── Direct Integrations ──

  ipcMain.handle(IPC.CLICKUP_CONNECT, async (_event, token: string) => {
    try {
      const { connectClickUp } = await import('../integrations/clickup/provider')
      return await connectClickUp(token)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Connection failed' }
    }
  })

  ipcMain.handle(IPC.CLICKUP_DISCONNECT, async () => {
    try {
      const { clickupProvider } = await import('../integrations/clickup/provider')
      await clickupProvider.disconnect()
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Disconnect failed' }
    }
  })

  ipcMain.handle(IPC.CLICKUP_STATUS, async () => {
    try {
      const { getClickUpStatus } = await import('../integrations/clickup/provider')
      return getClickUpStatus()
    } catch {
      return { connected: false, workspaceName: null }
    }
  })

  ipcMain.handle(
    IPC.CLICKUP_CALL_ACTION,
    async (_event, actionName: string, params: Record<string, unknown>) => {
      try {
        const { clickupProvider } = await import('../integrations/clickup/provider')
        if (!(await clickupProvider.hasConnections())) {
          return { success: false, error: 'ClickUp is not connected.' }
        }
        const result = await clickupProvider.executeAction(actionName, params)
        return { success: true, result, error: null }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'ClickUp action failed' }
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
      const { resolveVaultRoot } = require('../vault') as typeof import('../vault')
      const kbDir = resolveVaultRoot()
      const date = new Date(data.timestamp)
      const dateStr = date.toISOString().slice(0, 10)
      const timeStr = date.toTimeString().slice(0, 5)

      // Write inbox capture file (Life OS layout: 00-Inbox/YYYY-MM-DD/)
      const inboxDir = join(kbDir, '00-Inbox', dateStr)
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

      // Route decisions to 05-Decisions/ (Life OS §2.4)
      if (data.result?.decisions?.length > 0) {
        const decisionsDir = join(kbDir, '05-Decisions')
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

      // Self-heal: if section headers are missing (e.g. after 150-line trim), rebuild scaffold
      const hasAllHeaders =
        ctxContent.includes('## Recent Captures') &&
        ctxContent.includes('## Active Projects') &&
        ctxContent.includes('## Key People')
      if (!hasAllHeaders) {
        console.warn('[kb] CONTEXT.md missing section headers — rebuilding scaffold')
        ctxContent = `# Attacca User Context\n\n## Recent Captures (last 5)\n<!-- agent-managed: do not edit manually -->\n\n## Active Projects\n<!-- agent-managed: do not edit manually -->\n\n## Key People\n<!-- agent-managed: do not edit manually -->\n`
      }

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
      } else {
        console.warn('[kb] CONTEXT.md: Recent Captures regex did not match after rebuild')
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

      // Enforce 150-line cap — keep scaffold (headers, agent-managed markers)
      // plus the most recent content lines. Previous logic could keep the
      // OLDEST 150 lines or drop headers that appeared after the window.
      const ctxLines = ctxContent.split('\n')
      if (ctxLines.length > 150) {
        const isScaffold = (line: string): boolean =>
          line.startsWith('# ') || line.startsWith('## ') || line.startsWith('<!-- agent')
        const scaffold: string[] = []
        const content: string[] = []
        for (const line of ctxLines) {
          if (isScaffold(line)) scaffold.push(line)
          else content.push(line)
        }
        const budget = Math.max(0, 150 - scaffold.length)
        const trimmedContent = content.slice(-budget)
        const trimmed = [...scaffold, ...trimmedContent].join('\n')
        console.log(`[kb] CONTEXT.md trimmed from ${ctxLines.length} to ${scaffold.length + trimmedContent.length} lines`)
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

  ipcMain.handle(IPC.KB_READ_CONTEXT, async () => {
    const { resolveVaultRoot } = await import('../vault')
    const ctxPath = join(resolveVaultRoot(), 'memory', 'CONTEXT.md')
    if (!existsSync(ctxPath)) return ''
    try {
      return readFileSync(ctxPath, 'utf-8')
    } catch {
      return ''
    }
  })

  ipcMain.handle(IPC.KB_APPEND_DAILY_LOG, async (_event, entry: string) => {
    const { resolveVaultRoot } = await import('../vault')
    const kbDir = resolveVaultRoot()
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

  ipcMain.handle(IPC.KB_GET_PATH, async () => {
    const { resolveVaultRoot } = await import('../vault')
    return resolveVaultRoot()
  })

  ipcMain.handle(IPC.KB_OPEN_FOLDER, async () => {
    const { resolveVaultRoot } = await import('../vault')
    const root = resolveVaultRoot()
    mkdirSync(root, { recursive: true })
    const { shell } = await import('electron')
    shell.openPath(root)
    return { success: true }
  })

  ipcMain.handle(
    IPC.KB_IMPORT_FILES,
    async (_event, paths: string[]) => {
      const { readdirSync, statSync } = await import('fs')
      const { resolveVaultRoot } = await import('../vault')
      const kbDir = join(resolveVaultRoot(), '00-Inbox', 'imported')
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

  // ── Vault (Life OS v0.3) ──
  ipcMain.handle(IPC.VAULT_GET_MODE, async () => {
    const { readVaultMode, resolveVaultRoot } = await import('../vault')
    return { mode: readVaultMode(), path: resolveVaultRoot() }
  })

  ipcMain.handle(
    IPC.VAULT_SET_MODE,
    async (
      _event,
      mode: { kind: 'managed' | 'external'; path: string },
      opts?: { createMissing?: boolean }
    ) => {
      try {
        const { applyVaultMode, startWatcher, stopWatcher } = await import('../vault')
        const report = applyVaultMode(mode, opts)
        await stopWatcher()
        await startWatcher()
        return { success: true, report }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(IPC.VAULT_SCAN_FOLDERS, async (_event, root: string) => {
    try {
      const { scanFolders } = await import('../vault')
      return { success: true, report: scanFolders(root) }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.VAULT_LIST_TREE, async (_event, opts?: { maxDepth?: number }) => {
    try {
      const { listTree } = await import('../vault')
      return { success: true, tree: listTree(undefined, opts?.maxDepth) }
    } catch (err) {
      return { success: false, error: (err as Error).message, tree: [] }
    }
  })

  ipcMain.handle(IPC.VAULT_READ_NOTE, async (_event, relPath: string) => {
    try {
      const { readNote } = await import('../vault')
      return { success: true, ...readNote(relPath) }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(
    IPC.VAULT_WRITE_NOTE,
    async (
      _event,
      relPath: string,
      body: string,
      frontmatter: Record<string, unknown>,
      opts?: { preserveRaw?: string }
    ) => {
      try {
        const { writeNote } = await import('../vault')
        const result = writeNote(
          relPath,
          body,
          frontmatter as Parameters<typeof writeNote>[2],
          opts
        )
        return { success: true, ...result }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(IPC.VAULT_DELETE_NOTE, async (_event, relPath: string) => {
    try {
      const { archiveNote } = await import('../vault')
      return { success: true, ...archiveNote(relPath) }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.VAULT_GET_PATH, async () => {
    const { resolveVaultRoot } = await import('../vault')
    return resolveVaultRoot()
  })

  ipcMain.handle(IPC.VAULT_OPEN_FOLDER, async () => {
    const { resolveVaultRoot } = await import('../vault')
    const root = resolveVaultRoot()
    mkdirSync(root, { recursive: true })
    shell.openPath(root)
    return { success: true }
  })

  // ── Areas ──
  ipcMain.handle(IPC.AREA_LIST, async () => {
    try {
      const { listAreas } = await import('../areas/manager')
      return { success: true, areas: listAreas() }
    } catch (err) {
      return { success: false, error: (err as Error).message, areas: [] }
    }
  })

  ipcMain.handle(
    IPC.AREA_CREATE,
    async (
      _event,
      input: { name: string; description?: string; emoji?: string; reviewCadence?: 'weekly' | 'monthly' }
    ) => {
      try {
        const { createArea } = await import('../areas/manager')
        return { success: true, area: createArea(input) }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(
    IPC.AREA_UPDATE,
    async (
      _event,
      id: string,
      patch: Partial<{
        name: string
        description: string
        emoji: string
        reviewCadence: 'weekly' | 'monthly'
      }>
    ) => {
      try {
        const { updateArea } = await import('../areas/manager')
        return { success: true, area: updateArea(id, patch) }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(IPC.AREA_ARCHIVE, async (_event, id: string, note?: string) => {
    try {
      const { archiveArea } = await import('../areas/manager')
      archiveArea(id, note)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.AREA_GET_HEALTH, async (_event, id: string) => {
    try {
      const { computeHealth } = await import('../areas/manager')
      return { success: true, health: computeHealth(id) }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // ── Decisions (Life OS v0.3 Phase 1) ──
  ipcMain.handle(IPC.DECISION_LIST, async () => {
    try {
      const { listDecisions } = await import('../decisions/manager')
      return { success: true, decisions: listDecisions() }
    } catch (err) {
      return { success: false, error: (err as Error).message, decisions: [] }
    }
  })

  ipcMain.handle(
    IPC.DECISION_CREATE,
    async (
      _event,
      input: {
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
      }
    ) => {
      try {
        const { createDecision } = await import('../decisions/manager')
        return { success: true, decision: createDecision(input) }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(
    IPC.DECISION_UPDATE,
    async (
      _event,
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
    ) => {
      try {
        const { updateDecision } = await import('../decisions/manager')
        return { success: true, decision: updateDecision(id, patch) }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(IPC.DECISION_REVISIT, async (_event, id: string) => {
    try {
      const { revisitDecisionNow } = await import('../decisions/manager')
      return { success: true, decision: revisitDecisionNow(id) }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(
    IPC.DECISION_COMPLETE,
    async (
      _event,
      id: string,
      retro: { actualOutcome: string; didMatch: boolean | 'partly'; lessons: string }
    ) => {
      try {
        const { completeDecision } = await import('../decisions/manager')
        return { success: true, decision: completeDecision(id, retro) }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle(IPC.DECISION_SUPERSEDE, async (_event, oldId: string, newId: string) => {
    try {
      const { supersedeDecision } = await import('../decisions/manager')
      return { success: true, decision: supersedeDecision(oldId, newId) }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle(IPC.DECISION_SCAN_DUE, async () => {
    try {
      const { scanDueDecisions } = await import('../decisions/manager')
      return { success: true, decisions: scanDueDecisions() }
    } catch (err) {
      return { success: false, error: (err as Error).message, decisions: [] }
    }
  })
}
