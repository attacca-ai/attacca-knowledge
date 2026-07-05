/**
 * Core agent runtime for Attacca.
 * Direct Anthropic Messages API calls. Local-only tools (memory_search,
 * memory_save, vault read/write). No external integrations, no permission
 * gate — all tools operate on local user data.
 */

import Anthropic from '@anthropic-ai/sdk'
import { BrowserWindow } from 'electron'
import { readLLMConfig } from '../config/llm-config'
import { buildFullSystemPrompt, buildSlimSystemPrompt } from './system-prompt'
import { buildToolDefinitions } from './tools'
import { executeTool } from './tool-executor'
import {
  getOrCreateSession,
  addMessageToSession,
  replaceSessionMessages,
  clearSession,
  listSessions,
  type SessionInfo
} from './sessions'
import { processStream, type StreamResult } from './streaming'
import { compactIfNeeded } from './compaction'
import { trackRequest } from '../usage/tracker'

const MAX_TOOL_CALLS_PER_TURN = 10
/** Hard backstop on API round-trips per turn, independent of tool-call counting */
const MAX_LOOP_ITERATIONS = 15

/** In-flight request tracking for abort support */
const inflightAbortControllers = new Map<string, AbortController>()

/** Recently-seen idempotency keys per session (dedup for renderer retries/replays) */
const recentIdempotencyKeys = new Map<string, string[]>()
const MAX_IDEMPOTENCY_KEYS = 50

function isDuplicateRequest(sessionKey: string, idempotencyKey: string): boolean {
  if (!idempotencyKey) return false
  const keys = recentIdempotencyKeys.get(sessionKey) ?? []
  if (keys.includes(idempotencyKey)) return true
  keys.push(idempotencyKey)
  if (keys.length > MAX_IDEMPOTENCY_KEYS) keys.shift()
  recentIdempotencyKeys.set(sessionKey, keys)
  return false
}

/** Global request queue — serialized, feature sessions prioritized */
interface QueuedRequest {
  sessionKey: string
  message: string
  idempotencyKey: string
  priority: number
  resolve: (value: void) => void
  reject: (reason: unknown) => void
}

const requestQueue: QueuedRequest[] = []
let isProcessing = false

function getApiKey(): string {
  const config = readLLMConfig()
  if (!config?.apiKey) {
    throw new Error('No API key configured. Add one in Settings.')
  }
  return config.apiKey
}

function getModel(): string {
  return readLLMConfig()?.model || 'claude-sonnet-4-6'
}

function getWindow(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows()
  return wins.length > 0 ? wins[0] : null
}

function emit(channel: string, payload: Record<string, unknown>): void {
  const win = getWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, payload)
  }
}

/**
 * Send a chat message to the agent. Queued and serialized globally.
 */
export async function sendMessage(
  sessionKey: string,
  message: string,
  idempotencyKey: string
): Promise<void> {
  const isFeature = sessionKey !== 'main'
  if (isDuplicateRequest(sessionKey, idempotencyKey)) {
    return Promise.resolve()
  }
  return new Promise<void>((resolve, reject) => {
    requestQueue.push({
      sessionKey,
      message,
      idempotencyKey,
      priority: isFeature ? 0 : 1,
      resolve,
      reject
    })
    requestQueue.sort((a, b) => a.priority - b.priority)
    processQueue()
  })
}

async function processQueue(): Promise<void> {
  if (isProcessing || requestQueue.length === 0) return
  isProcessing = true

  const req = requestQueue.shift()!
  try {
    await executeRequest(req.sessionKey, req.message)
    req.resolve()
  } catch (err) {
    // Errors thrown before the stream loop (e.g. missing API key) never reach
    // executeRequest's own error emit — surface them here so the renderer
    // doesn't spin forever.
    emit('event:agent:error', {
      sessionKey: req.sessionKey,
      error: err instanceof Error ? err.message : 'Something went wrong. Please try again.',
      partial: null
    })
    req.reject(err)
  } finally {
    isProcessing = false
    if (requestQueue.length > 0) {
      processQueue()
    }
  }
}

async function executeRequest(sessionKey: string, message: string): Promise<void> {
  const win = getWindow()
  const apiKey = getApiKey()
  const model = getModel()
  const isMain = sessionKey === 'main'

  const session = getOrCreateSession(sessionKey, isMain ? 'main' : 'feature')

  // External integrations (Composio) removed in Phase 0 Life OS pivot. Every
  // session gets the same static tool set (memory tools only) and a system
  // prompt chosen by session type.
  const systemPrompt = isMain
    ? buildFullSystemPrompt()
    : buildSlimSystemPrompt(session.featureInstructions)
  const tools = buildToolDefinitions()

  // Add user message to history
  addMessageToSession(sessionKey, { role: 'user', content: message })

  // Compact if needed
  const { messages: compactedMessages, compacted } = await compactIfNeeded(
    session.messages,
    apiKey
  )
  if (compacted) {
    replaceSessionMessages(sessionKey, compactedMessages)
  }

  // Rollback point for failed/aborted turns: everything before the user message
  // just added (which is the last entry after optional compaction). Prevents a
  // stranded user message from duplicating on retry.
  const historyLengthBeforeTurn = session.messages.length - 1

  // Create abort controller
  const abortController = new AbortController()
  inflightAbortControllers.set(sessionKey, abortController)

  let totalUsage = { input_tokens: 0, output_tokens: 0 }

  try {
    const client = new Anthropic({ apiKey })
    let toolCallCount = 0
    let iterations = 0
    let forceTextOnlyResponse = false

    // Tool loop: keep calling until we get a text-only response or hit the limit
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (abortController.signal.aborted) {
        replaceSessionMessages(sessionKey, session.messages.slice(0, historyLengthBeforeTurn))
        emit('event:agent:final', { sessionKey, message: '[Request cancelled]', usage: totalUsage })
        return
      }

      iterations++
      if (iterations > MAX_LOOP_ITERATIONS) {
        emit('event:agent:final', {
          sessionKey,
          message: '[Stopped: the agent reached the maximum number of steps for one turn.]',
          usage: totalUsage
        })
        return
      }

      const requestParams: Anthropic.MessageCreateParams = {
        model,
        max_tokens: 8192,
        system: systemPrompt,
        messages: session.messages,
        stream: true as const
      }
      if (tools.length > 0) {
        requestParams.tools = tools
        if (forceTextOnlyResponse) {
          // Tool budget exhausted — tools stay declared (history references them)
          // but the model may not call any more this turn.
          requestParams.tool_choice = { type: 'none' }
        }
      }

      const stream = client.messages.stream(requestParams, {
        signal: abortController.signal
      })
      const result: StreamResult = await processStream(
        stream as unknown as Parameters<typeof processStream>[0],
        sessionKey,
        win,
        abortController.signal
      )

      totalUsage.input_tokens += result.usage.input_tokens
      totalUsage.output_tokens += result.usage.output_tokens
      try {
        trackRequest(model, result.usage.input_tokens, result.usage.output_tokens, 0, 0, 'agent')
      } catch (usageErr) {
        console.warn('[agent] Usage tracking failed:', usageErr)
      }

      if (result.aborted) {
        // Keep the turn coherent: persist partial text as the assistant reply,
        // or roll the user message back if nothing was produced.
        if (result.text) {
          addMessageToSession(sessionKey, { role: 'assistant', content: result.text })
        } else {
          replaceSessionMessages(sessionKey, session.messages.slice(0, historyLengthBeforeTurn))
        }
        emit('event:agent:final', {
          sessionKey,
          message: result.text || '[Request cancelled]',
          usage: totalUsage
        })
        return
      }

      // Response truncated by max_tokens mid-tool-call — the tool input JSON is
      // incomplete, so executing it would run tools with garbage/empty args.
      // Surface the truncation instead of looping.
      if (result.stopReason === 'max_tokens' && result.toolUseBlocks.length > 0) {
        const truncatedText =
          (result.text ? result.text + '\n\n' : '') +
          '[Response truncated: output limit reached mid-action. Please try a narrower request.]'
        addMessageToSession(sessionKey, { role: 'assistant', content: truncatedText })
        emit('event:agent:final', { sessionKey, message: truncatedText, usage: totalUsage })
        return
      }

      // No tool calls — final text response
      if (result.toolUseBlocks.length === 0) {
        if (result.text) {
          addMessageToSession(sessionKey, { role: 'assistant', content: result.text })
        }
        emit('event:agent:final', { sessionKey, message: result.text, usage: totalUsage })
        return
      }

      // Has tool calls — build assistant message and execute tools
      const assistantContent: Anthropic.ContentBlockParam[] = []
      if (result.text) {
        assistantContent.push({ type: 'text', text: result.text })
      }
      for (const tool of result.toolUseBlocks) {
        assistantContent.push({
          type: 'tool_use',
          id: tool.id,
          name: tool.name,
          input: tool.input
        })
      }
      addMessageToSession(sessionKey, { role: 'assistant', content: assistantContent })

      // Execute each tool call
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const tool of result.toolUseBlocks) {
        toolCallCount++

        if (toolCallCount > MAX_TOOL_CALLS_PER_TURN) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: 'Tool call limit reached (10 per turn). Please summarize what you have so far.',
            is_error: true
          })
          emit('event:agent:tool-result', {
            sessionKey,
            toolName: tool.name,
            success: false,
            summary: 'Tool call limit reached'
          })
          continue
        }

        // Execute local tool (memory / vault). All tools are local — no
        // permission gate, no external API. sessionKey is passed for future
        // session-scoped tool state.
        const execResult = await executeTool(tool.name, tool.input, sessionKey)

        const resultContent = execResult.success
          ? JSON.stringify(execResult.result, null, 2).slice(0, 10000)
          : execResult.error || 'Tool execution failed.'

        toolResults.push({
          type: 'tool_result',
          tool_use_id: tool.id,
          content: resultContent,
          is_error: !execResult.success
        })

        emit('event:agent:tool-result', {
          sessionKey,
          toolName: tool.name,
          success: execResult.success,
          summary: execResult.success
            ? 'Completed'
            : (execResult.error || 'Failed')
        })
      }

      addMessageToSession(sessionKey, { role: 'user', content: toolResults })

      // If we hit the tool limit, the next API call forbids further tool use
      // (tool_choice: none) so the model must answer with text.
      if (toolCallCount >= MAX_TOOL_CALLS_PER_TURN) {
        forceTextOnlyResponse = true
      }
      // Loop back to send tool_results to the API
    }
  } catch (err) {
    // Roll the failed turn out of history so a retry doesn't duplicate the
    // user message or leave dangling tool_use/tool_result pairs.
    replaceSessionMessages(sessionKey, session.messages.slice(0, historyLengthBeforeTurn))

    if (abortController.signal.aborted) {
      // Abort surfaced as an SDK error (signal passed to the request) — this is
      // a user cancel, not a failure.
      emit('event:agent:final', { sessionKey, message: '[Request cancelled]', usage: totalUsage })
      return
    }

    const errMsg = err instanceof Error ? err.message : 'Unknown error'
    const isAuthError = errMsg.includes('401') || errMsg.includes('authentication')
    const isRateLimit = errMsg.includes('429') || errMsg.includes('rate')
    const isOverloaded = errMsg.includes('529') || errMsg.includes('overloaded')

    let userMessage: string
    if (isAuthError) {
      userMessage = 'API key is invalid or expired. Please check your settings.'
    } else if (isRateLimit || isOverloaded) {
      userMessage = 'The AI service is temporarily busy. Please try again in a moment.'
    } else {
      userMessage = 'Something went wrong. Please try again.'
      console.error('[agent] Request error:', err)
    }

    emit('event:agent:error', { sessionKey, error: userMessage, partial: null })
  } finally {
    inflightAbortControllers.delete(sessionKey)
  }
}

/**
 * Abort an in-flight request for a session. Pass '*' to stop everything
 * (kill switch): aborts all in-flight requests and drains queued ones.
 * Queued requests have no AbortController yet, so they must be cancelled here
 * or they'd silently execute later despite the user pressing Stop.
 */
export function stopSession(sessionKey: string): void {
  const inflightKeys =
    sessionKey === '*' ? [...inflightAbortControllers.keys()] : [sessionKey]
  for (const key of inflightKeys) {
    const controller = inflightAbortControllers.get(key)
    if (controller) {
      controller.abort()
      inflightAbortControllers.delete(key)
    }
  }

  for (let i = requestQueue.length - 1; i >= 0; i--) {
    const req = requestQueue[i]
    if (sessionKey === '*' || req.sessionKey === sessionKey) {
      requestQueue.splice(i, 1)
      emit('event:agent:final', {
        sessionKey: req.sessionKey,
        message: '[Request cancelled]',
        usage: { input_tokens: 0, output_tokens: 0 }
      })
      req.resolve()
    }
  }
}

export { clearSession, listSessions }
export type { SessionInfo }
