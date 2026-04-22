/**
 * Tool executor for the Attacca agent runtime.
 *
 * Phase 0 (Life OS pivot): Composio removed. The executor only handles internal
 * tools (memory_search, memory_save). Unknown tools return an error — the agent
 * no longer has a Composio path to fall back to.
 */

import { isInternalTool } from './tools'

export interface ToolExecutionResult {
  success: boolean
  result?: unknown
  error?: string
}

export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  _sessionKey?: string
): Promise<ToolExecutionResult> {
  if (isInternalTool(toolName)) {
    return executeInternalTool(toolName, toolInput)
  }
  return {
    success: false,
    error: `Unknown tool: ${toolName}. External integrations are not available in this build.`
  }
}

async function executeInternalTool(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<ToolExecutionResult> {
  try {
    if (toolName === 'memory_search') {
      const query = String(toolInput.query || '')
      if (!query) return { success: false, error: 'Search query is required.' }

      const { generateEmbedding } =
        require('../memory/embeddings') as typeof import('../memory/embeddings')
      const { searchMemories, searchMemoriesByKeyword } =
        require('../memory/search') as typeof import('../memory/search')

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

      const { insertMemory, updateEmbedding } =
        require('../memory/db') as typeof import('../memory/db')
      const { generateEmbedding, float32ToBuffer } =
        require('../memory/embeddings') as typeof import('../memory/embeddings')

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
      generateEmbedding(summary + '\n' + content)
        .then((emb) => {
          if (emb) updateEmbedding(id, float32ToBuffer(emb))
        })
        .catch(() => {
          /* embedding backfill will pick it up */
        })

      return { success: true, result: { saved: true, id } }
    }

    return { success: false, error: `Unknown internal tool: ${toolName}` }
  } catch (err) {
    console.error(`[tool-executor] Internal tool ${toolName} error:`, err)
    return { success: false, error: 'Memory operation failed.' }
  }
}
