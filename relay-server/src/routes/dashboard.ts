import { Router } from 'express'
import {
  getPermissionApprovalRates,
  getTrustProfileDistribution,
  getTaskCompletionStats
} from '../services/telemetry-store.js'

const router = Router()

// Simple auth for internal dashboard
function dashboardAuth(req: any, res: any, next: any): void {
  const secret = req.headers['x-dashboard-secret'] || req.query.secret
  if (secret !== process.env.DASHBOARD_SECRET) {
    res.status(403).json({ error: 'Unauthorized' })
    return
  }
  next()
}

router.use(dashboardAuth)

router.get('/stats', async (_req, res) => {
  try {
    const [permissionRates, trustDistribution, taskStats] = await Promise.all([
      getPermissionApprovalRates(30),
      getTrustProfileDistribution(30),
      getTaskCompletionStats(30)
    ])

    res.json({
      period: '30d',
      permissions: permissionRates,
      trustProfiles: trustDistribution,
      tasks: taskStats
    })
  } catch (err) {
    console.error('[dashboard] Stats error:', err)
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})

export default router
