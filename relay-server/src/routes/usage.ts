import { Router } from 'express'
import { getCumulativeCost } from '../services/usage.js'

const router = Router()

router.get('/', async (req, res) => {
  const license = req.license
  if (!license) {
    res.status(401).json({ error: 'No license context' })
    return
  }

  try {
    const usage = await getCumulativeCost(license.keyHash)
    res.json(usage)
  } catch (err) {
    console.error('[usage] Get usage error:', err)
    res.status(500).json({ error: 'Failed to get usage data' })
  }
})

export default router
