/**
 * Core agent runtime for Attacca.
 * Replaces the OpenClaw gateway with direct Anthropic Messages API calls.
 * Implements the tool_use → permission gate → Composio → tool_result loop.
 */

import Anthropic from '@anthropic-ai/sdk'
import { BrowserWindow } from 'electron'
import { readLLMConfig } from '../config/llm-config'
import { buildFullSystemPrompt, buildSlimSystemPrompt } from './system-prompt'
import { buildToolDefinitions, buildToolDefinitionsForMain } from './tools'
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

const MAX_TOOL_CALLS_PER_TURN = 10

/** In-flight request tracking for abort support */
const inflightAbortControllers = new Map<string, AbortController>()

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

  // Two-stage routing: main sessions use router meta-tools + loaded-toolkit set.
  // Feature and workflow-run sessions still receive all connected toolkits upfront.
  const useTwoStageRouting =
    isMain || (sessionKey.startsWith('workflow-') && !sessionKey.startsWith('workflow-run-'))

  let systemPrompt: string
  let tools: Anthropic.Tool[] = []

  /**
   * Rebuild systemPrompt + tools. For main sessions this runs every loop iteration
   * so that a `load_toolkit` call in the previous iteration takes effect on the next
   * Anthropic request (the tool schemas and instruction blocks expand mid-turn).
   */
  const rebuildPromptAndTools = async (): Promise<void> => {
    if (useTwoStageRouting) {
      const loadedArr = Array.from(session.loadedToolkits)
      systemPrompt = buildFullSystemPrompt(loadedArr)
      tools = buildToolDefinitionsForMain(session.loadedToolkits)
    } else if (sessionKey.startsWith('workflow-run-')) {
      // Workflow run sessions get tools but slim prompt
      let connectedTools: string[] = []
      try {
        const { getConnectedApps } = require('../composio/service') as typeof import('../composio/service')
        const { getComposioEntityId } = require('../identity/user-identity') as typeof import('../identity/user-identity')
        connectedTools = await getConnectedApps(getComposioEntityId())
      } catch { /* */ }
      systemPrompt = buildSlimSystemPrompt(session.featureInstructions)
      tools = buildToolDefinitions(connectedTools)
    } else {
      // Feature sessions: all connected toolkits upfront, single-turn UX preserved
      let connectedTools: string[] = []
      try {
        const { getConnectedApps } = require('../composio/service') as typeof import('../composio/service')
        const { getComposioEntityId } = require('../identity/user-identity') as typeof import('../identity/user-identity')
        connectedTools = await getConnectedApps(getComposioEntityId())
      } catch { /* */ }
      systemPrompt = buildSlimSystemPrompt(session.featureInstructions)
      tools = buildToolDefinitions(connectedTools)
    }
  }

  // Initial build — guarantees systemPrompt + tools are set before entering the loop
  systemPrompt = ''
  await rebuildPromptAndTools()

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

  // Create abort controller
  const abortController = new AbortController()
  inflightAbortControllers.set(sessionKey, abortController)

  let totalUsage = { input_tokens: 0, output_tokens: 0 }

  try {
    const client = new Anthropic({ apiKey })
    let toolCallCount = 0

    // Tool loop: keep calling until we get a text-only response or hit the limit
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (abortController.signal.aborted) {
        emit('event:agent:final', { sessionKey, message: '[Request cancelled]', usage: totalUsage })
        return
      }

      // Rebuild tools + system prompt each iteration so that a `load_toolkit` call
      // in the previous iteration takes effect on this request.
      if (useTwoStageRouting) {
        await rebuildPromptAndTools()
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
      }

      const stream = client.messages.stream(requestParams)
      const result: StreamResult = await processStream(
        stream as unknown as Parameters<typeof processStream>[0],
        sessionKey,
        win,
        abortController.signal
      )

      totalUsage.input_tokens += result.usage.input_tokens
      totalUsage.output_tokens += result.usage.output_tokens

      if (result.aborted) {
        emit('event:agent:final', {
          sessionKey,
          message: result.text || '[Request cancelled]',
          usage: totalUsage
        })
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

        // Execute via permission gate + Composio. Pass sessionKey so internal
        // router tools (list_available_toolkits / load_toolkit) can mutate
        // session.loadedToolkits.
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

      // If we hit the tool limit, force the model to respond without more tools
      if (toolCallCount >= MAX_TOOL_CALLS_PER_TURN) {
        // Continue the loop — the model will get the error results and should stop calling tools
      }
      // Otherwise, loop back to send tool_results to the API
    }
  } catch (err) {
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
 * Abort an in-flight request for a session.
 */
export function stopSession(sessionKey: string): void {
  const controller = inflightAbortControllers.get(sessionKey)
  if (controller) {
    controller.abort()
    inflightAbortControllers.delete(sessionKey)
  }
}

export { clearSession, listSessions }
export type { SessionInfo }
