import { Router } from 'express'
import {
  initiateOAuth,
  getConnectionStatus,
  proxyToolAction,
  proxyToolActionV3,
  getConnectedApps,
  listAppActions,
  listApps,
  listOutlookEvents
} from '../services/composio.js'

const router = Router()

// Forward tool action
router.post('/proxy', async (req, res) => {
  const license = req.license
  if (!license) {
    res.status(401).json({ error: 'No license context' })
    return
  }

  const { actionName, params } = req.body as {
    actionName: string
    params: Record<string, unknown>
  }

  if (!actionName) {
    res.status(400).json({ error: 'actionName is required' })
    return
  }

  // Special aggregate: list Outlook calendar events (two-step strategy).
  // Step 1: OUTLOOK_LIST_CALENDARS (confirmed working) → extract primary calendar ID.
  // Step 2: Try event-listing actions with the calendar ID.
  if (actionName === 'ATTACCA_OUTLOOK_EVENTS') {
    const timeMin = (params.timeMin ?? params.startDateTime) as string | undefined
    const timeMax = (params.timeMax ?? params.endDateTime) as string | undefined
    const top = (params.top as number | undefined) ?? 50

    // Composio OUTLOOK_LIST_EVENTS param names (from docs): calendar_id, top, filter, select[], orderby[]
    const composioParams: Record<string, unknown> = {
      top,
      select: ['subject', 'start', 'end', 'attendees', 'id', 'isAllDay'],
      orderby: ['start/dateTime']
    }
    if (timeMin && timeMax) {
      composioParams.filter = `start/dateTime ge '${timeMin.replace('Z', '')}' and end/dateTime le '${timeMax.replace('Z', '')}'`
    }

    // Step 1: get calendar list (works reliably) to obtain primary calendar ID
    let primaryCalendarId: string | undefined
    try {
      const calResult = await proxyToolAction(license.keyHash, 'OUTLOOK_LIST_CALENDARS', { $top: 5 })
      const calData = (calResult as any)?.data ?? calResult
      const calItems: any[] = Array.isArray(calData?.value) ? calData.value : []
      const primary = calItems.find((c: any) => c.isDefaultCalendar) ?? calItems[0]
      primaryCalendarId = primary?.id
      console.log(`[composio] ATTACCA_OUTLOOK_EVENTS primary calendar: "${primary?.name}" id=${primaryCalendarId?.slice(0, 20)}...`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`[composio] ATTACCA_OUTLOOK_EVENTS OUTLOOK_LIST_CALENDARS failed: ${msg}`)
    }

    // Step 2: OUTLOOK_LIST_EVENTS via SDK using correct param names (calendar_id, not calendarId; top not $top)
    try {
      const eventParams = primaryCalendarId
        ? { ...composioParams, calendar_id: primaryCalendarId }
        : composioParams
      const result = await proxyToolAction(license.keyHash, 'OUTLOOK_LIST_EVENTS', eventParams)
      console.log(`[composio] ATTACCA_OUTLOOK_EVENTS resolved via OUTLOOK_LIST_EVENTS`)
      res.json({ success: true, result })
      return
    } catch (e) {
      console.log(`[composio] ATTACCA_OUTLOOK_EVENTS OUTLOOK_LIST_EVENTS failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`)
    }

    // Final fallback: use Composio entity.execute() — different SDK path than client.tools.execute()
    try {
      const result = await listOutlookEvents(license.keyHash, primaryCalendarId, composioParams)
      console.log(`[composio] ATTACCA_OUTLOOK_EVENTS resolved via entity.execute()`)
      res.json({ success: true, result })
      return
    } catch (e) {
      console.log(`[composio] ATTACCA_OUTLOOK_EVENTS entity.execute() failed: ${e instanceof Error ? e.message : e}`)
    }

    res.json({ success: false, error: 'No Outlook calendar action matched. Ensure Outlook is connected in Connections.' })
    return
  }

  try {
    const result = await proxyToolAction(license.keyHash, actionName, params || {})
    res.json({ success: true, result })
  } catch (err) {
    const composioStatus = (err as any)?.status as number | undefined
    // Preserve Composio 4xx errors so the client doesn't retry them
    if (composioStatus && composioStatus >= 400 && composioStatus < 500) {
      res.status(composioStatus).json({
        error: 'composio_client_error',
        message: err instanceof Error ? err.message : 'Composio client error'
      })
      return
    }
    console.error('[composio] Proxy error:', err)
    res.status(502).json({
      error: 'Composio action failed',
      message: err instanceof Error ? err.message : 'Unknown error'
    })
  }
})

// Start OAuth flow
router.post('/oauth/initiate', async (req, res) => {
  const license = req.license
  if (!license) {
    res.status(401).json({ error: 'No license context' })
    return
  }

  const { appName } = req.body as { appName: string }

  if (!appName) {
    res.status(400).json({ error: 'appName is required' })
    return
  }

  try {
    const result = await initiateOAuth(license.keyHash, appName)
    res.json({
      success: true,
      connectionId: result.connectionId,
      redirectUrl: result.redirectUrl
    })
  } catch (err) {
    console.error('[composio] OAuth initiation error:', err)
    res.status(502).json({
      error: 'OAuth initiation failed',
      message: err instanceof Error ? err.message : 'Unknown error'
    })
  }
})

// Poll OAuth completion status
router.get('/oauth/status', async (req, res) => {
  const connectionId = req.query.connectionId as string

  if (!connectionId) {
    res.status(400).json({ error: 'connectionId query parameter is required' })
    return
  }

  try {
    const status = await getConnectionStatus(connectionId)
    res.json({
      connectionId: status.id,
      status: status.status,
      appName: status.appName
    })
  } catch (err) {
    console.error('[composio] Status check error:', err)
    res.status(502).json({
      error: 'Status check failed',
      message: err instanceof Error ? err.message : 'Unknown error'
    })
  }
})

// Get connected apps for the current license
router.get('/connected', async (req, res) => {
  const license = req.license
  if (!license) {
    res.status(401).json({ error: 'No license context' })
    return
  }

  try {
    const apps = await getConnectedApps(license.keyHash)
    res.json({ apps })
  } catch (err) {
    console.error('[composio] Connected apps error:', err)
    res.json({ apps: [] })
  }
})

// List all available Composio apps/toolkits
router.get('/apps', async (req, res) => {
  try {
    const apps = await listApps()
    res.json({ apps })
  } catch (err) {
    console.error('[composio] List apps error:', err)
    res.status(502).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
})

// List available Composio actions for an app (used to discover correct action names)
router.get('/actions', async (req, res) => {
  const app = (req.query.app as string | undefined)?.toLowerCase()
  if (!app) {
    res.status(400).json({ error: 'app query parameter required (e.g. ?app=trello)' })
    return
  }
  try {
    const actions = await listAppActions(app)
    res.json({ app, count: actions.length, actions })
  } catch (err) {
    console.error('[composio] List actions error:', err)
    res.status(502).json({ error: err instanceof Error ? err.message : 'Unknown error' })
  }
})

export default router
