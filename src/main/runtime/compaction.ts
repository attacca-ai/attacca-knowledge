/**
 * Conversation compaction for the Attacca agent runtime.
 * When history exceeds the token budget, summarize old turns with Haiku.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources/messages'
import { estimateTokens } from './sessions'

const SOFT_THRESHOLD = 35_000 // char/4 estimate threshold
const COMPACT_RATIO = 0.6 // Compact oldest 60% of turns

const COMPACTION_PROMPT = `Summarize this conversation concisely. You MUST preserve:
- All decisions made (what was decided and why)
- All action items and pending tasks
- User preferences and constraints expressed
- Key findings from tool calls (results, not raw data)
- Any commitments or promises made

Omit: greetings, filler, raw tool output, repeated information.
Format: bullet points grouped by topic. Under 800 words.`

/**
 * Check if compaction is needed and perform it if so.
 * Returns the (possibly compacted) message history.
 */
export async function compactIfNeeded(
  messages: MessageParam[],
  apiKey: string
): Promise<{ messages: MessageParam[]; compacted: boolean }> {
  const tokenEstimate = estimateTokens(messages)
  if (tokenEstimate < SOFT_THRESHOLD || messages.length < 4) {
    return { messages, compacted: false }
  }

  // Snap split to a user-message boundary so `recentMessages` starts with a user turn.
  // After compaction we prepend [user summary, assistant ack]; if `recentMessages[0]`
  // were assistant we'd have two assistants in a row and break alternating roles.
  let splitIdx = Math.ceil(messages.length * COMPACT_RATIO)
  while (splitIdx < messages.length && messages[splitIdx].role !== 'user') {
    splitIdx++
  }
  // If no user boundary found forward, fall back to scanning backward.
  if (splitIdx >= messages.length) {
    splitIdx = Math.ceil(messages.length * COMPACT_RATIO)
    while (splitIdx > 0 && messages[splitIdx].role !== 'user') {
      splitIdx--
    }
  }
  if (splitIdx <= 0 || splitIdx >= messages.length) {
    return { messages, compacted: false }
  }
  const oldMessages = messages.slice(0, splitIdx)
  const recentMessages = messages.slice(splitIdx)

  // Build conversation text from old messages for summarization
  const conversationText = oldMessages
    .map((msg) => {
      const role = msg.role === 'user' ? 'User' : 'Assistant'
      const content =
        typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .map((b) => {
                  if ('text' in b) return b.text
                  if (b.type === 'tool_use') return `[Tool call: ${b.name}]`
                  if (b.type === 'tool_result') {
                    const text =
                      typeof b.content === 'string'
                        ? b.content
                        : Array.isArray(b.content)
                          ? b.content
                              .filter((c): c is { type: 'text'; text: string } => 'text' in c)
                              .map((c) => c.text)
                              .join(' ')
                          : '[tool result]'
                    return `[Tool result: ${text.slice(0, 500)}]`
                  }
                  return ''
                })
                .filter(Boolean)
                .join('\n')
            : ''
      return `${role}: ${content}`
    })
    .join('\n\n')

  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `${COMPACTION_PROMPT}\n\n---\n\n${conversationText}`
        }
      ]
    })

    const summary =
      response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n') || 'No summary generated.'

    const compactedMessages: MessageParam[] = [
      {
        role: 'user',
        content: `[Conversation summary from earlier in this session]\n\n${summary}`
      },
      {
        role: 'assistant',
        content: 'Understood. I have the context from our earlier conversation. How can I help?'
      },
      ...recentMessages
    ]

    console.log(
      `[compaction] Compacted ${oldMessages.length} messages (${tokenEstimate} est. tokens) → summary + ${recentMessages.length} recent`
    )

    return { messages: compactedMessages, compacted: true }
  } catch (err) {
    console.error('[compaction] Failed, continuing with full history:', err)
    return { messages, compacted: false }
  }
}
