import { Router } from 'express'
import { storeBatchEvents, deleteByAnonymousId } from '../services/telemetry-store.js'
import { hashLicenseKey } from '../services/license.js'

const router = Router()

// Accept batched telemetry events
router.post('/events', async (req, res) => {
  console.log('[telemetry] Received batch request, body size:', JSON.stringify(req.body).length)
  const { events } = req.body as {
    events: Array<{
      eventType: string
      payload: Record<string, unknown>
      timestamp: string
      anonymousId: string
    }>
  }

  if (!events || !Array.isArray(events) || events.length === 0) {
    res.status(400).json({ error: 'events array is required' })
    return
  }

  // Limit batch size
  if (events.length > 1000) {
    res.status(400).json({ error: 'Maximum 1000 events per batch' })
    return
  }

  try {
    console.log('[telemetry] Storing', events.length, 'events, types:', events.map(e => e.eventType).join(', '))
    await storeBatchEvents(events)
    res.json({ success: true, count: events.length })
  } catch (err) {
    console.error('[telemetry] Store error:', err)
    res.status(500).json({ error: 'Failed to store events' })
  }
})

// Delete telemetry data by anonymous ID
router.post('/delete', async (req, res) => {
  const { anonymousId } = req.body as { anonymousId: string }

  if (!anonymousId) {
    res.status(400).json({ error: 'anonymousId is required' })
    return
  }

  try {
    const count = await deleteByAnonymousId(anonymousId)
    res.json({ success: true, deletedCount: count })
  } catch (err) {
    console.error('[telemetry] Delete error:', err)
    res.status(500).json({ error: 'Failed to delete data' })
  }
})

export default router
