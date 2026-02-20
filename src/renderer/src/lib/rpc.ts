import type { JsonRpcRequest, JsonRpcResponse, JsonRpcEvent, JsonRpcFrame } from '@/types/gateway'

let idCounter = 0

function nextId(): string {
  return `req_${++idCounter}_${Date.now()}`
}

export function buildRequest(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return {
    jsonrpc: '2.0',
    id: nextId(),
    method,
    ...(params && { params })
  }
}

export function buildResponse(id: string, result: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result
  }
}

export function buildErrorResponse(
  id: string,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data !== undefined && { data }) }
  }
}

export function parseFrame(raw: string): JsonRpcFrame | null {
  try {
    const parsed = JSON.parse(raw)
    if (parsed.jsonrpc !== '2.0') return null
    return parsed as JsonRpcFrame
  } catch {
    return null
  }
}

export function isResponse(frame: JsonRpcFrame): frame is JsonRpcResponse {
  return 'id' in frame && ('result' in frame || 'error' in frame)
}

export function isEvent(frame: JsonRpcFrame): frame is JsonRpcEvent {
  return 'method' in frame && !('id' in frame)
}

export function isRequest(frame: JsonRpcFrame): frame is JsonRpcRequest {
  return 'id' in frame && 'method' in frame && !('result' in frame) && !('error' in frame)
}
