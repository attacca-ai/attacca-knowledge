/**
 * Agent client for the renderer process.
 * IPC-based replacement for the WebSocket gateway-client.
 * Components use this to send messages and listen for streaming events.
 */

type StreamCallback = (data: { sessionKey: string; delta: string; type: string }) => void
type ToolCallCallback = (data: {
  sessionKey: string
  toolName: string
  toolInput: Record<string, unknown>
}) => void
type ToolResultCallback = (data: {
  sessionKey: string
  toolName: string
  success: boolean
  summary: string
}) => void
type FinalCallback = (data: {
  sessionKey: string
  message: string
  usage: { input_tokens: number; output_tokens: number }
}) => void
type ErrorCallback = (data: {
  sessionKey: string
  error: string
  partial?: string | null
}) => void

/**
 * Wildcard handler that receives all agent events (stream, tool-call, tool-result, final, error).
 * The `type` field distinguishes event kinds.
 */
type WildcardCallback = (event: {
  type: 'stream' | 'tool-call' | 'tool-result' | 'final' | 'error'
  sessionKey: string
  [key: string]: unknown
}) => void

const wildcardHandlers = new Set<WildcardCallback>()
let globalUnsubs: Array<() => void> = []

function emitWildcard(
  type: 'stream' | 'tool-call' | 'tool-result' | 'final' | 'error',
  data: Record<string, unknown>
): void {
  const event = { type, ...data } as Parameters<WildcardCallback>[0]
  for (const handler of wildcardHandlers) {
    try {
      handler(event)
    } catch (err) {
      console.error('[agent-client] Wildcard handler error:', err)
    }
  }
}

/**
 * Initialize global IPC event listeners that fan out to wildcard handlers.
 * Call once on app startup.
 */
export function initAgentClient(): void {
  if (globalUnsubs.length > 0) return // Already initialized

  globalUnsubs.push(
    window.api.agent.onStream((data) => emitWildcard('stream', data)),
    window.api.agent.onToolCall((data) => emitWildcard('tool-call', data)),
    window.api.agent.onToolResult((data) => emitWildcard('tool-result', data)),
    window.api.agent.onFinal((data) => emitWildcard('final', data)),
    window.api.agent.onError((data) => emitWildcard('error', data))
  )
}

/**
 * Send a message to the agent runtime.
 */
export async function agentSend(
  sessionKey: string,
  message: string,
  idempotencyKey?: string
): Promise<{ success: boolean; error?: string }> {
  const key = idempotencyKey || crypto.randomUUID()
  return window.api.agent.send(sessionKey, message, key)
}

/**
 * Stop an in-flight request.
 */
export async function agentStop(sessionKey: string): Promise<void> {
  await window.api.agent.stop(sessionKey)
}

/**
 * Subscribe to all agent events (wildcard). Returns unsubscribe function.
 * This replaces the `gatewayClient.on('*', handler)` pattern.
 */
export function onAgentEvent(callback: WildcardCallback): () => void {
  wildcardHandlers.add(callback)
  return () => {
    wildcardHandlers.delete(callback)
  }
}

/**
 * Subscribe to specific event types. Returns unsubscribe function.
 *
 * These helpers attach to the shared wildcard fan-out (populated by
 * `initAgentClient()`) rather than registering a new IPC listener per call.
 * This keeps lifecycle ownership in `globalUnsubs` and prevents duplicate
 * event delivery when a component uses both `onAgentEvent` and a specific
 * helper.
 */
export function onStream(callback: StreamCallback): () => void {
  const handler: WildcardCallback = (event) => {
    if (event.type === 'stream') callback(event as unknown as Parameters<StreamCallback>[0])
  }
  wildcardHandlers.add(handler)
  return () => {
    wildcardHandlers.delete(handler)
  }
}

export function onToolCall(callback: ToolCallCallback): () => void {
  const handler: WildcardCallback = (event) => {
    if (event.type === 'tool-call') callback(event as unknown as Parameters<ToolCallCallback>[0])
  }
  wildcardHandlers.add(handler)
  return () => {
    wildcardHandlers.delete(handler)
  }
}

export function onToolResult(callback: ToolResultCallback): () => void {
  const handler: WildcardCallback = (event) => {
    if (event.type === 'tool-result') callback(event as unknown as Parameters<ToolResultCallback>[0])
  }
  wildcardHandlers.add(handler)
  return () => {
    wildcardHandlers.delete(handler)
  }
}

export function onFinal(callback: FinalCallback): () => void {
  const handler: WildcardCallback = (event) => {
    if (event.type === 'final') callback(event as unknown as Parameters<FinalCallback>[0])
  }
  wildcardHandlers.add(handler)
  return () => {
    wildcardHandlers.delete(handler)
  }
}

export function onError(callback: ErrorCallback): () => void {
  const handler: WildcardCallback = (event) => {
    if (event.type === 'error') callback(event as unknown as Parameters<ErrorCallback>[0])
  }
  wildcardHandlers.add(handler)
  return () => {
    wildcardHandlers.delete(handler)
  }
}

/**
 * Cleanup all global listeners. Call on app teardown.
 */
export function destroyAgentClient(): void {
  for (const unsub of globalUnsubs) unsub()
  globalUnsubs = []
  wildcardHandlers.clear()
}
