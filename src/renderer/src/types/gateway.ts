// JSON-RPC protocol types for OpenClaw gateway communication

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: string
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string
  result?: unknown
  error?: JsonRpcError
}

export interface JsonRpcEvent {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export type JsonRpcFrame = JsonRpcRequest | JsonRpcResponse | JsonRpcEvent

// Gateway connection states
export type GatewayConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

// Gateway events emitted by the agent runtime
export type GatewayEventType =
  | 'agent.turn.start'
  | 'agent.turn.end'
  | 'agent.tool.call'
  | 'agent.tool.result'
  | 'agent.message'
  | 'agent.error'
  | 'exec.approval.requested'
  | 'exec.approval.resolved'
  | 'task.created'
  | 'task.updated'
  | 'task.completed'
  | 'task.failed'

export interface GatewayEvent {
  type: GatewayEventType
  timestamp: number
  data: Record<string, unknown>
}

// Health status from main process
export interface GatewayHealthStatus {
  ok: boolean
  latency: number | null
  error: string | null
  checkedAt: number
}

// Process state from main process
export interface GatewayProcessState {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error'
  pid: number | null
  restartCount: number
  lastError: string | null
  startedAt: number | null
}
