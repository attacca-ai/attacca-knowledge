/**
 * Tool executor for the Attacca agent runtime.
 * Routes tool calls through the permission gate and executes via Composio SDK.
 * Replaces the HTTP-based Composio server (port 3102) with direct function calls.
 */

import { resolveComposioAction, isInternalTool, TOOLKIT_SUMMARIES, normalizeToolkitSlug } from './tools'
import { checkPermission } from '../composio/permission-gate'
import {
  proxyToolAction,
  executeActionDirect,
  getConnectedApps,
  getAccountsWithLabels,
  type ConnectedAccountWithLabel
} from '../composio/service'
import { getDefaultAccount } from '../composio/defaults'
import { getComposioEntityId } from '../identity/user-identity'
import { getTelemetryCollector } from '../telemetry/collector'
import { markToolkitLoaded, getLoadedToolkits } from './sessions'
import type { AccountLabel } from '../composio/connections'
import { classifyComposioAction } from '../../shared/risk-classifier'
import { getProvider } from '../integrations/registry'

export interface ToolExecutionResult {
  success: boolean
  result?: unknown
  error?: string
}

/**
 * Execute a tool call. Routes to internal handlers (memory + router meta-tools)
 * or Composio (external tools). Internal tools need `sessionKey` to read/mutate
 * per-session state such as the loaded-toolkits set.
 */
export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  sessionKey?: string
): Promise<ToolExecutionResult> {
  // Handle internal tools (memory + router) directly — no Composio, no permission gate
  if (isInternalTool(toolName)) {
    return executeInternalTool(toolName, toolInput, sessionKey)
  }

  const composioAction = resolveComposioAction(toolName)
  if (!composioAction) {
    return { success: false, error: `Unknown tool: ${toolName}` }
  }

  const toolkit = extractToolkit(composioAction)
  const toolkitSlug = normalizeToolkitSlug(composioAction.split('_')[0] ?? '')

  // Direct provider takes priority over Composio when registered
  const directProvider = getProvider(toolkitSlug)
  if (directProvider) {
    const directArgs: Record<string, unknown> = { ...toolInput }
    delete directArgs.connectionId

    try {
      const approved = await checkPermission(composioAction, directArgs)
      if (!approved) {
        getTelemetryCollector().emit('agent.tool_call.failed', {
          actionName: composioAction,
          toolkit,
          errorCategory: 'permission_denied'
        })
        return { success: false, error: 'Action requires approval. The user denied or did not respond in time.' }
      }
    } catch (err) {
      console.error('[tool-executor] Permission check error:', err)
      return { success: false, error: 'Permission check failed.' }
    }

    try {
      const result = await directProvider.executeAction(composioAction, directArgs)
      getTelemetryCollector().emit('agent.tool_call.succeeded', {
        actionName: composioAction,
        toolkit,
        method: 'direct'
      })
      return { success: true, result }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[tool-executor] Direct provider ${toolkitSlug} failed:`, msg)
      getTelemetryCollector().emit('agent.tool_call.failed', {
        actionName: composioAction,
        toolkit,
        errorCategory: 'direct_provider_error'
      })
      return { success: false, error: msg }
    }
  }

  const entityId = getComposioEntityId()

  // Extract explicit connectionId from the agent's tool input (optional). If the
  // agent passed `connectionId` as a parameter, honor it regardless of defaults.
  const explicitConnectionId =
    typeof toolInput.connectionId === 'string' ? (toolInput.connectionId as string) : undefined
  // Strip it from the Composio call arguments — it's a routing concern, not a
  // parameter Composio expects to see.
  const composioArgs: Record<string, unknown> = { ...toolInput }
  delete composioArgs.connectionId

  // Resolve which connection to use. Fetch the merged account list once.
  let accounts: ConnectedAccountWithLabel[] = []
  try {
    accounts = await getAccountsWithLabels(entityId)
  } catch {
    // Treat as single-account path — fall through with empty list
  }

  const resolution = resolveConnectionId(toolkitSlug, accounts, explicitConnectionId)

  // Multi-account fan-out for low-risk reads: when the agent would otherwise
  // error with `multiple_accounts_no_default` AND the action is low-risk (no
  // mutations), fetch from every connected account and merge the results. This
  // lets users say "show my calendar" and get events from all connected
  // Google Calendar accounts in a single response.
  if (
    !resolution.ok &&
    resolution.errorCategory === 'multiple_accounts_no_default' &&
    !explicitConnectionId &&
    classifyComposioAction(composioAction) === 'low'
  ) {
    const toolkitAccounts = accounts.filter(
      (a) => normalizeToolkitSlug(a.toolkit) === toolkitSlug
    )
    return executeMultiAccountRead(
      entityId,
      composioAction,
      composioArgs,
      toolkit,
      toolkitAccounts
    )
  }

  if (!resolution.ok) {
    getTelemetryCollector().emit('agent.tool_call.failed', {
      actionName: composioAction,
      toolkit,
      errorCategory: resolution.errorCategory
    })
    return { success: false, error: resolution.error }
  }

  const { connectionId, label } = resolution

  // Permission gate — pass the connection label so the shared classifier can
  // apply Shared-account escalation (DVR-5).
  try {
    const approved = await checkPermission(composioAction, composioArgs, { label })
    if (!approved) {
      getTelemetryCollector().emit('agent.tool_call.failed', {
        actionName: composioAction,
        toolkit,
        errorCategory: 'permission_denied'
      })
      return { success: false, error: 'Action requires approval. The user denied or did not respond in time.' }
    }
  } catch (err) {
    console.error('[tool-executor] Permission check error:', err)
    return { success: false, error: 'Permission check failed.' }
  }

  // Execute via Composio SDK with REST fallback. Pass connectionId so Composio
  // targets the specific account when multi-account is in play.
  try {
    const result = await proxyToolAction(entityId, composioAction, composioArgs, connectionId)
    getTelemetryCollector().emit('agent.tool_call.succeeded', {
      actionName: composioAction,
      toolkit,
      method: 'sdk'
    })
    return { success: true, result }
  } catch (sdkErr) {
    const sdkMsg = sdkErr instanceof Error ? sdkErr.message : String(sdkErr)

    // Check for "not connected" errors — don't retry via REST
    if (/ConnectedAccountNotFound|No connected account found|No active connection exists/i.test(sdkMsg)) {
      getTelemetryCollector().emit('agent.tool_call.failed', {
        actionName: composioAction,
        toolkit,
        errorCategory: 'not_connected'
      })
      return { success: false, error: `${toolkit} is not connected. Please connect it in Settings.` }
    }

    // Check for "tool not found" errors
    if (/Tool_ToolNotFound|Tool .+ not found/i.test(sdkMsg)) {
      getTelemetryCollector().emit('agent.tool_call.failed', {
        actionName: composioAction,
        toolkit,
        errorCategory: 'tool_not_found'
      })
      return { success: false, error: `Action ${toolName} is not available.` }
    }

    // Fallback to REST API
    try {
      const result = await executeActionDirect(
        entityId,
        composioAction,
        composioArgs,
        undefined,
        connectionId
      )
      getTelemetryCollector().emit('agent.tool_call.succeeded', {
        actionName: composioAction,
        toolkit,
        method: 'rest'
      })
      return { success: true, result }
    } catch (restErr) {
      const restMsg = restErr instanceof Error ? restErr.message : String(restErr)
      console.error(`[tool-executor] Both SDK and REST failed for ${composioAction}:`, restMsg)
      getTelemetryCollector().emit('agent.tool_call.failed', {
        actionName: composioAction,
        toolkit,
        errorCategory: 'unknown'
      })
      return { success: false, error: 'The tool encountered an error. Please try again.' }
    }
  }
}

/**
 * Execute internal tools: memory_search/memory_save (SQLite) and
 * list_available_toolkits/load_toolkit (session state + Composio lookup).
 */
async function executeInternalTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  sessionKey?: string
): Promise<ToolExecutionResult> {
  try {
    if (toolName === 'list_available_toolkits') {
      try {
        // Merge direct providers + Composio connected apps
        const { getDirectConnectedSlugs } = require('../integrations/registry') as typeof import('../integrations/registry')
        const directSlugs = await getDirectConnectedSlugs()

        let composioSlugs: string[] = []
        try {
          const entityId = getComposioEntityId()
          composioSlugs = await getConnectedApps(entityId)
        } catch {
          // Composio may not be configured — that's OK
        }

        const allSlugs = [...new Set([...directSlugs, ...composioSlugs])]
        const toolkits = allSlugs.map((slug) => {
          const key = normalizeToolkitSlug(slug)
          const summary = TOOLKIT_SUMMARIES[key]
          return {
            slug: key,
            name: summary?.name ?? slug,
            what: summary?.what ?? 'External tool'
          }
        })
        return { success: true, result: { toolkits } }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Could not list toolkits'
        }
      }
    }

    if (toolName === 'load_toolkit') {
      const slug = String(toolInput.slug || '').trim()
      if (!slug) return { success: false, error: 'slug is required' }
      if (!sessionKey) {
        return { success: false, error: 'load_toolkit requires an active session' }
      }

      const normalized = normalizeToolkitSlug(slug)

      // Verify the toolkit is actually connected (direct providers OR Composio)
      const directProvider = getProvider(normalized)
      let isDirectConnected = false
      if (directProvider) {
        try { isDirectConnected = await directProvider.hasConnections() } catch { /* */ }
      }

      if (!isDirectConnected) {
        try {
          const entityId = getComposioEntityId()
          const connected = await getConnectedApps(entityId)
          const connectedNormalized = connected.map(normalizeToolkitSlug)

          if (!connectedNormalized.includes(normalized)) {
            return {
              success: true,
              result: {
                ok: false,
                error: 'Toolkit not connected',
                connectedToolkits: connectedNormalized
              }
            }
          }
        } catch {
          return {
            success: true,
            result: {
              ok: false,
              error: 'Could not verify connected toolkits',
              connectedToolkits: []
            }
          }
        }
      }

      // Check if already loaded before mutating
      const currentlyLoaded = getLoadedToolkits(sessionKey)
      if (currentlyLoaded.includes(normalized)) {
        return { success: true, result: { ok: true, alreadyLoaded: true } }
      }

      const newlyLoaded = markToolkitLoaded(sessionKey, normalized)
      if (!newlyLoaded) {
        // Session missing — shouldn't happen since agent.ts creates session first
        return { success: false, error: 'Session not found' }
      }

      // Report the list of now-callable action names for this toolkit, so the
      // agent knows what it can invoke in the next turn.
      const { getToolkitActionNames } = require('./tools') as typeof import('./tools')
      const loaded = getToolkitActionNames(normalized)
      return { success: true, result: { ok: true, loaded } }
    }

    if (toolName === 'memory_search') {
      const query = String(toolInput.query || '')
      if (!query) return { success: false, error: 'Search query is required.' }

      const { generateEmbedding } = require('../memory/embeddings') as typeof import('../memory/embeddings')
      const { searchMemories, searchMemoriesByKeyword } = require('../memory/search') as typeof import('../memory/search')

      const queryEmb = await generateEmbedding(query)
      const results = queryEmb ? searchMemories(queryEmb) : searchMemoriesByKeyword(query)

      return {
        success: true,
        result: results.map((r) => ({
          type: r.type,
          summary: r.summary,
          content: r.content.slice(0, 1000),
          score: r.score,
          date: new Date(r.created_at).toISOString().slice(0, 10)
        }))
      }
    }

    if (toolName === 'memory_save') {
      const content = String(toolInput.content || '')
      const type = String(toolInput.type || 'capture') as 'preference' | 'decision' | 'capture'
      const summary = String(toolInput.summary || '')

      if (!content) return { success: false, error: 'Content is required.' }
      if (!summary) return { success: false, error: 'Summary is required.' }

      const { insertMemory } = require('../memory/db') as typeof import('../memory/db')
      const { generateEmbedding, float32ToBuffer } = require('../memory/embeddings') as typeof import('../memory/embeddings')

      const id = `mem_agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      insertMemory({
        id,
        type,
        content,
        summary,
        embedding: null,
        source_id: null,
        tags: '[]',
        importance: type === 'decision' ? 0.7 : 0.5,
        created_at: Date.now(),
        superseded_by: null
      })

      // Generate embedding async (non-blocking)
      generateEmbedding(summary + '\n' + content).then((emb) => {
        if (emb) {
          const { updateEmbedding } = require('../memory/db') as typeof import('../memory/db')
          updateEmbedding(id, float32ToBuffer(emb))
        }
      }).catch(() => { /* embedding backfill will pick it up */ })

      return { success: true, result: { saved: true, id } }
    }

    return { success: false, error: `Unknown internal tool: ${toolName}` }
  } catch (err) {
    console.error(`[tool-executor] Internal tool ${toolName} error:`, err)
    return { success: false, error: 'Memory operation failed.' }
  }
}

/**
 * Fan out a low-risk read across every connected account of a toolkit and
 * merge the results. Called from `executeTool` when a multi-account toolkit
 * has no default set (the common case — users rarely set defaults manually)
 * and the action is a read.
 *
 * Each per-account call still goes through the permission gate with that
 * account's label as context. In practice low-risk reads never fire the gate
 * on `balanced`/`autonomous` profiles, but the `cautious` profile or a
 * `Shared` label escalation can still cause per-account prompts.
 *
 * The result shape is flat — the LLM sees which account each slice of data
 * came from and can attribute "from Work" / "from Personal" in its response.
 */
async function executeMultiAccountRead(
  entityId: string,
  composioAction: string,
  composioArgs: Record<string, unknown>,
  toolkit: string,
  toolkitAccounts: ConnectedAccountWithLabel[]
): Promise<ToolExecutionResult> {
  const results: Array<{
    label: AccountLabel
    customName: string | null
    connectionId: string
    success: boolean
    data?: unknown
    error?: string
  }> = []

  for (const account of toolkitAccounts) {
    // Gate per account — the label context may escalate on 'Shared'
    try {
      const approved = await checkPermission(composioAction, composioArgs, {
        label: account.label
      })
      if (!approved) {
        results.push({
          label: account.label,
          customName: account.customName,
          connectionId: account.connectionId,
          success: false,
          error: 'denied by user'
        })
        continue
      }
    } catch {
      results.push({
        label: account.label,
        customName: account.customName,
        connectionId: account.connectionId,
        success: false,
        error: 'permission check failed'
      })
      continue
    }

    try {
      const data = await proxyToolAction(
        entityId,
        composioAction,
        composioArgs,
        account.connectionId
      )
      results.push({
        label: account.label,
        customName: account.customName,
        connectionId: account.connectionId,
        success: true,
        data
      })
      getTelemetryCollector().emit('agent.tool_call.succeeded', {
        actionName: composioAction,
        toolkit,
        method: 'sdk-fanout'
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // REST fallback per account
      try {
        const data = await executeActionDirect(
          entityId,
          composioAction,
          composioArgs,
          undefined,
          account.connectionId
        )
        results.push({
          label: account.label,
          customName: account.customName,
          connectionId: account.connectionId,
          success: true,
          data
        })
        getTelemetryCollector().emit('agent.tool_call.succeeded', {
          actionName: composioAction,
          toolkit,
          method: 'rest-fanout'
        })
      } catch (restErr) {
        const restMsg = restErr instanceof Error ? restErr.message : String(restErr)
        results.push({
          label: account.label,
          customName: account.customName,
          connectionId: account.connectionId,
          success: false,
          error: restMsg.slice(0, 200)
        })
        getTelemetryCollector().emit('agent.tool_call.failed', {
          actionName: composioAction,
          toolkit,
          errorCategory: 'fanout_account_failed'
        })
        // Continue with other accounts even if one fails
        console.warn(
          `[tool-executor] fan-out: ${composioAction} failed for ${account.label} (${account.connectionId}):`,
          msg
        )
      }
    }
  }

  const anySuccess = results.some((r) => r.success)

  // M3: When every per-account call fails, surface a top-level error string
  // alongside the per-account breakdown. Prevents the caller from stringifying
  // the whole accounts array as an error body. The per-account `results` are
  // still included so the agent can explain exactly which account failed and
  // why.
  if (!anySuccess) {
    const summary = results
      .map((r) => `${r.label}${r.customName ? ` (${r.customName})` : ''}: ${r.error ?? 'unknown'}`)
      .join('; ')
    return {
      success: false,
      error: `All ${results.length} ${toolkit} accounts failed — ${summary}`,
      result: {
        multi_account: true,
        accounts: results
      }
    }
  }

  return {
    success: true,
    result: {
      multi_account: true,
      accounts: results
    }
  }
}

type ResolutionResult =
  | { ok: true; connectionId: string | undefined; label?: AccountLabel }
  | { ok: false; error: string; errorCategory: string }

/**
 * Pick the connection to use for a Composio call (DVR-7).
 *
 * Rules:
 * 1. Explicit `connectionId` always wins, provided it exists in the account list.
 * 2. If no accounts exist for the toolkit → pass `undefined` (legacy single-account
 *    path — Composio picks whichever account is connected for that user_id).
 * 3. Exactly 1 account → use it automatically.
 * 4. ≥2 accounts:
 *    a. If a default is set via `defaultAccounts[toolkit]` → use it.
 *    b. Otherwise → error `multiple_accounts_no_default`.
 * 5. Unknown explicit id → error `unknown_connection`. Does NOT fall back to default.
 */
function resolveConnectionId(
  toolkitSlug: string,
  accounts: ConnectedAccountWithLabel[],
  explicitConnectionId?: string
): ResolutionResult {
  const toolkitAccounts = accounts.filter(
    (a) => normalizeToolkitSlug(a.toolkit) === toolkitSlug
  )

  // Rule 1: explicit wins if it matches
  if (explicitConnectionId) {
    const match = toolkitAccounts.find((a) => a.connectionId === explicitConnectionId)
    if (match) {
      return { ok: true, connectionId: match.connectionId, label: match.label }
    }
    // L2: Error message surfaces labels + custom names only — never the raw
    // connectionId — since this text is returned to the LLM. The unknown id
    // is logged for debugging but not echoed.
    console.warn(
      `[tool-executor] resolveConnectionId: unknown connectionId "${explicitConnectionId}" for ${toolkitSlug}`
    )
    const availableLabels =
      toolkitAccounts
        .map((a) => `${a.label}${a.customName ? ` "${a.customName}"` : ''}`)
        .join(', ') || 'none'
    return {
      ok: false,
      error: `Unknown ${toolkitSlug} connection. Available: ${availableLabels}.`,
      errorCategory: 'unknown_connection'
    }
  }

  // Rule 2: no accounts in the merged list — fall through to legacy single-account path
  if (toolkitAccounts.length === 0) {
    return { ok: true, connectionId: undefined }
  }

  // Rule 3: single account
  if (toolkitAccounts.length === 1) {
    const only = toolkitAccounts[0]
    return { ok: true, connectionId: only.connectionId, label: only.label }
  }

  // Rule 4: multi-account
  const defaultConnId = getDefaultAccount(toolkitSlug)
  if (defaultConnId) {
    const match = toolkitAccounts.find((a) => a.connectionId === defaultConnId)
    if (match) {
      return { ok: true, connectionId: match.connectionId, label: match.label }
    }
    // Default points at a stale connectionId — fall through to the error path
    // so the agent re-asks rather than silently picking.
  }

  // L2: surface labels + custom names, not raw connectionIds, to the LLM
  const available = toolkitAccounts
    .map((a) => `${a.label}${a.customName ? ` "${a.customName}"` : ''}`)
    .join(', ')
  return {
    ok: false,
    error: `Multiple ${toolkitSlug} accounts connected: ${available}. Ask the user which one to use (by label) and call this tool again with the connectionId parameter set to the matching connection. Do not proceed without explicit confirmation when the action modifies or sends data.`,
    errorCategory: 'multiple_accounts_no_default'
  }
}

function extractToolkit(actionName: string): string {
  const prefixes: Record<string, string> = {
    GMAIL: 'Gmail',
    GOOGLECALENDAR: 'Google Calendar',
    OUTLOOK: 'Outlook',
    SLACK: 'Slack',
    TRELLO: 'Trello',
    CLICKUP: 'ClickUp',
    ASANA: 'Asana',
    NOTION: 'Notion',
    GOOGLEDRIVE: 'Google Drive',
    ONEDRIVE: 'OneDrive',
    DROPBOX: 'Dropbox'
  }
  const prefix = actionName.split('_')[0]
  return prefixes[prefix] || prefix
}
