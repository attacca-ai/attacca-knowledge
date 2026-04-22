/**
 * Native Anthropic tool definitions for the Attacca agent runtime.
 *
 * Phase 0 (Life OS pivot): external integrations (Composio) deleted. The only
 * tools the agent has access to are internal memory tools. Direct providers
 * (e.g. ClickUp) are reachable via dedicated IPC handlers from the UI, not
 * through the agent loop — so no tool definitions are required for them here.
 */

import type Anthropic from '@anthropic-ai/sdk'

/** Memory tools — always included */
const MEMORY_TOOLS: Anthropic.Tool[] = [
  {
    name: 'memory_search',
    description: "Search user's memory for past decisions, preferences, events, or context",
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query — use keywords about the topic' }
      },
      required: ['query']
    }
  },
  {
    name: 'memory_save',
    description: 'Save a user preference, decision, or important context for future reference',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: { type: 'string', description: 'What to remember' },
        type: {
          type: 'string',
          enum: ['preference', 'decision', 'capture'],
          description: 'Type of memory'
        },
        summary: { type: 'string', description: 'One-line summary' }
      },
      required: ['content', 'type', 'summary']
    }
  }
]

/**
 * Build the Anthropic tools array for the agent runtime. With Composio removed
 * the set is static — only memory tools are exposed. The parameter is kept for
 * signature compatibility with callers that still pass a connected-tools list.
 */
export function buildToolDefinitions(_connectedTools?: string[]): Anthropic.Tool[] {
  return [...MEMORY_TOOLS]
}

/**
 * Check if a tool name is an internal tool. After the Composio removal every
 * tool the agent can call is internal; this predicate stays so future external
 * tools can be layered back in without touching the executor's branching.
 */
export function isInternalTool(toolName: string): boolean {
  return toolName === 'memory_search' || toolName === 'memory_save'
}
