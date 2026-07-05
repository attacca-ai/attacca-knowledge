/**
 * Anthropic SSE stream handler.
 * Parses streaming responses and emits IPC events to the renderer.
 */

import type { BrowserWindow } from 'electron'
import type Anthropic from '@anthropic-ai/sdk'
import type { Stream } from '@anthropic-ai/sdk/streaming'

export interface StreamResult {
  /** Full accumulated text response */
  text: string
  /** Tool use blocks returned by the model (Phase 2) */
  toolUseBlocks: Array<{
    id: string
    name: string
    input: Record<string, unknown>
  }>
  /** Usage stats from the API */
  usage: { input_tokens: number; output_tokens: number }
  /** Whether the stream was aborted */
  aborted: boolean
  /** Stop reason reported by the API (e.g. 'end_turn', 'tool_use', 'max_tokens') */
  stopReason: string | null
}

/**
 * Process an Anthropic streaming response, emitting IPC events for each delta.
 * Returns the accumulated result when the stream completes.
 */
export async function processStream(
  stream: Stream<Anthropic.RawMessageStreamEvent>,
  sessionKey: string,
  win: BrowserWindow | null,
  abortSignal?: AbortSignal
): Promise<StreamResult> {
  let text = ''
  const toolUseBlocks: StreamResult['toolUseBlocks'] = []
  let usage: StreamResult['usage'] = { input_tokens: 0, output_tokens: 0 }
  let stopReason: string | null = null
  let currentToolUse: { id: string; name: string; inputJson: string } | null = null

  const emit = (channel: string, payload: Record<string, unknown>): void => {
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }

  try {
    for await (const event of stream) {
      if (abortSignal?.aborted) {
        stream.controller.abort()
        return { text, toolUseBlocks, usage, aborted: true, stopReason }
      }

      switch (event.type) {
        case 'message_start':
          if (event.message.usage) {
            usage.input_tokens = event.message.usage.input_tokens
          }
          break

        case 'content_block_start':
          if (event.content_block.type === 'tool_use') {
            currentToolUse = {
              id: event.content_block.id,
              name: event.content_block.name,
              inputJson: ''
            }
            emit('event:agent:tool-call', {
              sessionKey,
              toolName: event.content_block.name,
              toolInput: {}
            })
          }
          break

        case 'content_block_delta':
          if (event.delta.type === 'text_delta') {
            text += event.delta.text
            emit('event:agent:stream', {
              sessionKey,
              delta: event.delta.text,
              type: 'text'
            })
          } else if (event.delta.type === 'input_json_delta' && currentToolUse) {
            currentToolUse.inputJson += event.delta.partial_json
          }
          break

        case 'content_block_stop':
          if (currentToolUse) {
            let input: Record<string, unknown> = {}
            try {
              input = JSON.parse(currentToolUse.inputJson || '{}')
            } catch {
              // malformed JSON from model — pass empty
            }
            toolUseBlocks.push({
              id: currentToolUse.id,
              name: currentToolUse.name,
              input
            })
            currentToolUse = null
          }
          break

        case 'message_delta':
          if (event.usage) {
            usage.output_tokens = event.usage.output_tokens
          }
          if (event.delta?.stop_reason) {
            stopReason = event.delta.stop_reason
          }
          break

        case 'message_stop':
          // Stream complete
          break

        default: {
          // Handle error events or unknown event types
          const anyEvent = event as unknown as { type: string; error?: { message?: string } }
          if (anyEvent.type === 'error') {
            throw new Error(anyEvent.error?.message || 'Stream error from Anthropic API')
          }
          break
        }
      }
    }
  } catch (err) {
    if (abortSignal?.aborted) {
      return { text, toolUseBlocks, usage, aborted: true, stopReason }
    }
    throw err
  }

  return { text, toolUseBlocks, usage, aborted: false, stopReason }
}
