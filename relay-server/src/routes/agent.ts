import { Router } from 'express'
import type { Request, Response } from 'express'
import { Composio } from '@composio/core'
import { listAppActions, listOutlookEventsByEntityId, executeActionDirect } from '../services/composio.js'
import { storeBatchEvents } from '../services/telemetry-store.js'

function emitTool(
  type: 'agent.tool.succeeded' | 'agent.tool.failed',
  actionName: string,
  entityId: string,
  startMs: number,
  extra?: Record<string, unknown>
): void {
  storeBatchEvents([{
    eventType: type,
    payload: { actionName, durationMs: Date.now() - startMs, ...extra },
    timestamp: new Date().toISOString(),
    anonymousId: entityId.slice(0, 32)
  }]).catch(() => {})
}

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

  const startMs = Date.now()

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

    // Special aggregate: fetch Google Calendar events for "primary" calendar.
    // GOOGLECALENDAR_EVENTS_LIST requires calendarId — always inject "primary" here
    // so the agent never needs to know the parameter name.
    if (actionName === 'ATTACCA_CALENDAR_EVENTS') {
      const r = await client.tools.execute('GOOGLECALENDAR_EVENTS_LIST', {
        user_id: entityId,
        arguments: { calendarId: 'primary', maxResults: 10 }
      } as any)
      const data = (r as any)?.data ?? (r as any)?.result ?? r
      console.log(`[agent-tools] ATTACCA_CALENDAR_EVENTS → ${JSON.stringify(data ?? {}).slice(0, 200)}`)
      emitTool('agent.tool.succeeded', actionName, entityId, startMs)
      res.json({ success: true, result: data })
      return
    }

    // Special aggregate: get all Trello boards + their cards in one call.
    // Per Composio docs:
    //   Boards: TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER (idMember)
    //   Cards:  TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD (idBoard)
    if (actionName === 'ATTACCA_TRELLO_BOARDS_AND_CARDS') {
      // Extract an array from whatever shape Composio returns for board listings
      function extractArray(result: any): any[] {
        if (!result) return []
        const candidates = [result?.data, result?.result, result]
        for (const c of candidates) {
          if (Array.isArray(c) && c.length > 0) return c
          if (Array.isArray(c?.details) && c.details.length > 0) return c.details
          if (Array.isArray(c?.items) && c.items.length > 0) return c.items
          if (Array.isArray(c?.boards) && c.boards.length > 0) return c.boards
          if (Array.isArray(c?.response_data) && c.response_data.length > 0) return c.response_data
        }
        return []
      }

      // Step 1: list boards — try official action first, fall back to alias
      let boards: any[] = []
      for (const boardsAction of ['TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER', 'TRELLO_MEMBER_GET_BOARDS']) {
        try {
          const boardsResult = await client.tools.execute(boardsAction, {
            user_id: entityId,
            arguments: { idMember: 'me' }
          } as any)
          console.log(`[agent-tools] ATTACCA_TRELLO ${boardsAction} raw: ${JSON.stringify(boardsResult ?? {}).slice(0, 300)}`)
          boards = extractArray(boardsResult)
          if (boards.length > 0) {
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
            const cardList: any[] = extractArray(r)
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

      emitTool('agent.tool.succeeded', actionName, entityId, startMs)
      res.json({ success: true, result: { boards: boardsWithCards } })
      return
    }

    // Special aggregate: list Outlook calendar events (two-step strategy).
    // Step 1: OUTLOOK_LIST_CALENDARS (confirmed working) → extract primary calendar ID.
    // Step 2: Try event-listing actions with the calendar ID.
    if (actionName === 'ATTACCA_OUTLOOK_EVENTS') {
      const timeMin = params?.timeMin as string | undefined
      const timeMax = params?.timeMax as string | undefined
      const top = (params?.top as number | undefined) ?? 50

      // Composio OUTLOOK_LIST_EVENTS params (from docs): calendar_id, top, filter, select[], orderby[]
      const composioParams: Record<string, unknown> = {
        top,
        select: ['subject', 'start', 'end', 'attendees', 'id', 'isAllDay'],
        orderby: ['start/dateTime'],
      }
      if (timeMin && timeMax) {
        composioParams.filter = `start/dateTime ge '${timeMin.replace('Z', '')}' and end/dateTime le '${timeMax.replace('Z', '')}'`
      }

      // Step 1: get calendar list to obtain primary calendar ID
      let primaryCalendarId: string | undefined
      try {
        const calResult = await client.tools.execute('OUTLOOK_LIST_CALENDARS', {
          user_id: entityId,
          arguments: { $top: 5 }
        } as any)
        const calData = (calResult as any)?.data ?? calResult
        const calItems: any[] = Array.isArray(calData?.value) ? calData.value : []
        const primary = calItems.find((c: any) => c.isDefaultCalendar) ?? calItems[0]
        primaryCalendarId = primary?.id
        console.log(`[agent-tools] ATTACCA_OUTLOOK_EVENTS primary calendar: "${primary?.name}" id=${primaryCalendarId?.slice(0, 20)}...`)
      } catch (e) {
        console.log(`[agent-tools] ATTACCA_OUTLOOK_EVENTS OUTLOOK_LIST_CALENDARS failed: ${e instanceof Error ? e.message : e}`)
      }

      // Step 2: OUTLOOK_LIST_EVENTS with correct Composio param names (calendar_id, not $calendarId)
      try {
        const r = await client.tools.execute('OUTLOOK_LIST_EVENTS', {
          user_id: entityId,
          arguments: primaryCalendarId
            ? { ...composioParams, calendar_id: primaryCalendarId }
            : composioParams
        } as any)
        console.log(`[agent-tools] ATTACCA_OUTLOOK_EVENTS resolved via OUTLOOK_LIST_EVENTS`)
        emitTool('agent.tool.succeeded', actionName, entityId, startMs)
        res.json({ success: true, result: r })
        return
      } catch (e) {
        console.log(`[agent-tools] ATTACCA_OUTLOOK_EVENTS OUTLOOK_LIST_EVENTS failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`)
      }

      // Final fallback: entity.execute() — different SDK path that may resolve 404s
      try {
        console.log(`[agent-tools] ATTACCA_OUTLOOK_EVENTS trying entity.execute()...`)
        const result = await listOutlookEventsByEntityId(entityId, primaryCalendarId, composioParams)
        console.log(`[agent-tools] ATTACCA_OUTLOOK_EVENTS resolved via entity.execute()`)
        emitTool('agent.tool.succeeded', actionName, entityId, startMs)
        res.json({ success: true, result })
        return
      } catch (e) {
        console.log(`[agent-tools] ATTACCA_OUTLOOK_EVENTS direct Graph API failed: ${e instanceof Error ? e.message : e}`)
      }

      emitTool('agent.tool.failed', actionName, entityId, startMs, { errorMessage: 'No Outlook calendar action found in Composio SDK', errorSlug: 'Tool_ToolNotFound' })
      res.json({ success: false, error: 'No Outlook calendar action found. Ensure Outlook is connected in Connections.' })
      return
    }

    // Special aggregate: list Outlook email messages from a mail folder.
    // Uses OUTLOOK_LIST_MESSAGES which accepts folder, top, is_read, subject, etc.
    if (actionName === 'ATTACCA_OUTLOOK_MESSAGES') {
      const folder     = (params?.folder     as string  | undefined) ?? 'inbox'
      const top        = (params?.top        as number  | undefined) ?? 20
      const isRead     = params?.is_read     as boolean | undefined
      const subject    = params?.subject     as string  | undefined
      const fromAddr   = params?.from_address as string | undefined
      const convId     = params?.conversationId as string | undefined
      const receivedGe = params?.received_date_time_ge as string | undefined
      const receivedLe = params?.received_date_time_le as string | undefined
      const select     = (params?.select as string[] | undefined) ?? [
        'id', 'subject', 'from', 'receivedDateTime', 'isRead', 'bodyPreview', 'hasAttachments', 'conversationId'
      ]

      const msgArgs: Record<string, unknown> = { folder, top, select }
      if (isRead     !== undefined) msgArgs.is_read              = isRead
      if (subject    !== undefined) msgArgs.subject              = subject
      if (fromAddr   !== undefined) msgArgs.from_address         = fromAddr
      if (convId     !== undefined) msgArgs.conversationId       = convId
      if (receivedGe !== undefined) msgArgs.received_date_time_ge = receivedGe
      if (receivedLe !== undefined) msgArgs.received_date_time_le = receivedLe

      // SDK client.tools.execute() can't resolve OUTLOOK_LIST_MESSAGES (Tool_ToolNotFound).
      // Use the Composio v3 REST API directly instead — same fix as OUTLOOK_LIST_EVENTS.
      try {
        const r = await executeActionDirect(entityId, 'OUTLOOK_LIST_MESSAGES', msgArgs)
        console.log(`[agent-tools] ATTACCA_OUTLOOK_MESSAGES folder=${folder} → ${JSON.stringify(r ?? {}).slice(0, 200)}`)
        emitTool('agent.tool.succeeded', actionName, entityId, startMs)
        res.json({ success: true, result: r })
        return
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`[agent-tools] ATTACCA_OUTLOOK_MESSAGES failed: ${msg.slice(0, 200)}`)
        emitTool('agent.tool.failed', actionName, entityId, startMs, { errorMessage: msg.slice(0, 200) })
        res.json({ success: false, error: msg })
        return
      }
    }

    // Send an Outlook email via OUTLOOK_SEND_EMAIL.
    // Params: subject, body, to_recipients (array of {emailAddress:{address,name?}} or strings),
    //         cc_recipients?, bcc_recipients?, is_html?
    if (actionName === 'ATTACCA_OUTLOOK_SEND_EMAIL') {
      const subject = params?.subject as string | undefined
      const body = params?.body as string | undefined
      const toRaw = params?.to_recipients ?? params?.to
      // Normalize recipients to Composio format: [{emailAddress:{address,name?}}]
      const normalizeRecipients = (raw: unknown): Array<{ emailAddress: { address: string; name?: string } }> => {
        if (!raw) return []
        const arr = Array.isArray(raw) ? raw : [raw]
        return arr.map((r) => {
          if (typeof r === 'string') return { emailAddress: { address: r } }
          if (r && typeof r === 'object') {
            const ro = r as Record<string, unknown>
            if (ro.emailAddress) return ro as { emailAddress: { address: string } }
            if (ro.address) return { emailAddress: { address: ro.address as string, name: ro.name as string | undefined } }
          }
          return { emailAddress: { address: String(r) } }
        })
      }
      const sendArgs: Record<string, unknown> = {
        subject: subject ?? '(no subject)',
        body: body ?? '',
        to_recipients: normalizeRecipients(toRaw)
      }
      const cc = params?.cc_recipients ?? params?.cc
      const bcc = params?.bcc_recipients ?? params?.bcc
      if (cc) sendArgs.cc_recipients = normalizeRecipients(cc)
      if (bcc) sendArgs.bcc_recipients = normalizeRecipients(bcc)
      if (params?.is_html !== undefined) sendArgs.is_html = params.is_html

      try {
        const r = await executeActionDirect(entityId, 'OUTLOOK_SEND_EMAIL', sendArgs)
        console.log(`[agent-tools] ATTACCA_OUTLOOK_SEND_EMAIL to=${JSON.stringify(sendArgs.to_recipients)} subject="${subject}" → ${JSON.stringify(r ?? {}).slice(0, 200)}`)
        emitTool('agent.tool.succeeded', actionName, entityId, startMs)
        res.json({ success: true, result: r })
        return
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`[agent-tools] ATTACCA_OUTLOOK_SEND_EMAIL failed: ${msg.slice(0, 200)}`)
        emitTool('agent.tool.failed', actionName, entityId, startMs, { errorMessage: msg.slice(0, 200) })
        res.json({ success: false, error: msg })
        return
      }
    }

    // Reply to an Outlook email via OUTLOOK_REPLY_EMAIL.
    // Params: message_id (required), reply_body (required), reply_all? (boolean)
    if (actionName === 'ATTACCA_OUTLOOK_REPLY_EMAIL') {
      const replyArgs: Record<string, unknown> = {
        message_id: params?.message_id ?? params?.id,
        reply_body: params?.reply_body ?? params?.body,
        reply_all: params?.reply_all ?? false
      }
      try {
        const r = await executeActionDirect(entityId, 'OUTLOOK_REPLY_EMAIL', replyArgs)
        console.log(`[agent-tools] ATTACCA_OUTLOOK_REPLY_EMAIL message_id=${replyArgs.message_id} → ${JSON.stringify(r ?? {}).slice(0, 200)}`)
        emitTool('agent.tool.succeeded', actionName, entityId, startMs)
        res.json({ success: true, result: r })
        return
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`[agent-tools] ATTACCA_OUTLOOK_REPLY_EMAIL failed: ${msg.slice(0, 200)}`)
        emitTool('agent.tool.failed', actionName, entityId, startMs, { errorMessage: msg.slice(0, 200) })
        res.json({ success: false, error: msg })
        return
      }
    }

    // Special aggregate: list available Composio actions for an app slug.
    // Usage: ATTACCA_LIST_ACTIONS with {"app":"gmail"} or {"app":"outlook","filter":"message"}
    if (actionName === 'ATTACCA_LIST_ACTIONS') {
      const app = (params?.app as string | undefined)?.toLowerCase()
      if (!app) {
        res.json({ success: false, error: 'Provide {"app":"<slug>"} e.g. gmail, trello, googlecalendar' })
        return
      }
      const filter = (params?.filter as string | undefined)?.toLowerCase()
      let actions = await listAppActions(app)
      if (filter) {
        actions = actions.filter(a =>
          a.name.toLowerCase().includes(filter) || a.description.toLowerCase().includes(filter)
        )
      }
      res.json({ success: true, result: { app, filter: filter ?? null, count: actions.length, actions } })
      return
    }

    let result: unknown
    try {
      result = await client.tools.execute(actionName, {
        user_id: entityId,
        arguments: params ?? {},
        version: actionName.startsWith('OUTLOOK_') ? '20260309_00' : undefined
      } as any)
    } catch (sdkErr) {
      const sdkMsg = sdkErr instanceof Error ? sdkErr.message : String(sdkErr)
      const isNotFound = sdkMsg.includes('Tool_ToolNotFound') || sdkMsg.includes('not found')
      if (!isNotFound) throw sdkErr

      // SDK doesn't have this action in its local registry but the Composio backend may.
      // Retry via v3 REST API — this resolves Outlook, Teams, and other newer actions.
      console.log(`[agent-tools] SDK missing ${actionName} → retrying via v3 REST API`)
      result = await executeActionDirect(entityId, actionName, params ?? {})
    }

    const resultPreview = JSON.stringify(result ?? {}).slice(0, 300)
    console.log(`[agent-tools] tool_result ${actionName} → ${resultPreview}`)
    emitTool('agent.tool.succeeded', actionName, entityId, startMs)
    res.json({ success: true, result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[agent-tools] Error executing', actionName, ':', msg)
    const errSlug = (() => {
      try { return (JSON.parse(msg.match(/\{.*\}/)?.[0] ?? '{}') as any)?.error?.slug ?? 'unknown' } catch { return 'unknown' }
    })()
    emitTool('agent.tool.failed', actionName, entityId, startMs, {
      errorMessage: msg.slice(0, 200),
      errorSlug: errSlug
    })
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
