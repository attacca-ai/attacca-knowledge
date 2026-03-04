import { Router } from 'express'
import type { Request, Response } from 'express'
import { Composio } from '@composio/core'

const router = Router()

const SERVICE_TOKEN = process.env.RELAY_SERVICE_TOKEN || 'attacca-relay-service'

function getClient() {
  const key = process.env.COMPOSIO_API_KEY
  if (!key) throw new Error('COMPOSIO_API_KEY not configured')
  return new Composio({ apiKey: key }).getClient()
}

/**
 * Agent-facing tool execution endpoint.
 *
 * Called by the OpenClaw workspace skill (attacca-tools/SKILL.md) via curl.
 * Authenticated via service token — no license key required from the agent.
 * The entityId (derived from the user's license key) is embedded in the skill
 * by the Electron main process at startup.
 */
router.post('/tools', async (req: Request, res: Response) => {
  const providedKey = req.headers['x-api-key'] as string | undefined

  if (providedKey !== SERVICE_TOKEN) {
    res.status(401).json({ error: 'Invalid service key' })
    return
  }

  const { actionName, entityId, params } = req.body as {
    actionName?: string
    entityId?: string
    params?: Record<string, unknown>
  }

  if (!actionName || !entityId) {
    res.status(400).json({ error: 'actionName and entityId are required' })
    return
  }

  try {
    const client = getClient()
    console.log(
      JSON.stringify({
        event: 'agent_tool_call',
        actionName,
        entityId: entityId.slice(0, 8) + '...',
        timestamp: new Date().toISOString()
      })
    )

    // Special aggregate: get all Trello boards + their cards in one call.
    // Per Composio docs:
    //   Boards: TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER (idMember)
    //   Cards:  TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD (idBoard)
    if (actionName === 'ATTACCA_TRELLO_BOARDS_AND_CARDS') {
      // Step 1: list boards — try official action first, fall back to alias
      let boards: any[] = []
      for (const boardsAction of ['TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER', 'TRELLO_MEMBER_GET_BOARDS']) {
        try {
          const boardsResult = await client.tools.execute(boardsAction, {
            user_id: entityId,
            arguments: { idMember: 'me' }
          } as any)
          const raw = (boardsResult as any)?.data ?? (boardsResult as any)?.result ?? boardsResult
          if (Array.isArray(raw) && raw.length > 0) {
            boards = raw
            console.log(`[agent-tools] ATTACCA_TRELLO boards via ${boardsAction}: ${boards.length}`)
            break
          }
        } catch (err) {
          console.error(`[agent-tools] ATTACCA_TRELLO ${boardsAction} error:`, err)
        }
      }

      // Step 2: for each board, get cards via TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD
      const boardsWithCards = await Promise.all(
        boards.slice(0, 6).map(async (board: any) => {
          const boardId: string = board.id ?? board.idBoard ?? ''
          const boardName: string = board.name ?? boardId
          if (!boardId) return { id: boardId, name: boardName, cards: [] }

          try {
            const r = await client.tools.execute('TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD', {
              user_id: entityId,
              arguments: { idBoard: boardId }
            } as any)
            const data = (r as any)?.data ?? (r as any)?.result ?? r
            const cardList: any[] = Array.isArray(data) ? data : (data?.cards ?? [])
            console.log(`[agent-tools] ATTACCA_TRELLO board "${boardName}" cards: ${cardList.length}`)
            return {
              id: boardId,
              name: boardName,
              cards: cardList
                .filter((c: any) => !c.closed)
                .map((c: any) => ({
                  id: c.id,
                  name: c.name,
                  desc: c.desc ?? '',
                  due: c.due ?? null,
                  dueComplete: c.dueComplete ?? false,
                  labels: ((c.labels ?? []) as any[]).map((l: any) => l.name).filter(Boolean),
                }))
            }
          } catch (err) {
            console.error(`[agent-tools] ATTACCA_TRELLO cards for ${boardId} error:`, err)
            return { id: boardId, name: boardName, cards: [] }
          }
        })
      )

      res.json({ success: true, result: { boards: boardsWithCards } })
      return
    }

    const result = await client.tools.execute(actionName, {
      user_id: entityId,
      arguments: params ?? {}
    } as any)
    const resultPreview = JSON.stringify(result ?? {}).slice(0, 300)
    console.log(`[agent-tools] tool_result ${actionName} → ${resultPreview}`)
    res.json({ success: true, result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[agent-tools] Error executing', actionName, ':', msg)

    // Return 200 with success:false so the agent skill script receives the
    // error as readable JSON instead of an HTML error page (which confuses the
    // agent and causes it to report the tool as "disconnected").
    res.json({
      success: false,
      error: msg
    })
  }
})

export default router
