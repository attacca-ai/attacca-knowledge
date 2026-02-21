import { Router } from 'express'
import {
  initiateOAuth,
  getConnectionStatus,
  proxyToolAction,
  getConnectedApps
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

  try {
    const result = await proxyToolAction(license.keyHash, actionName, params || {})
    res.json({ success: true, result })
  } catch (err) {
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

export default router
