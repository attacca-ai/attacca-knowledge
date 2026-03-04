import type { Request, Response, NextFunction } from 'express'
import { isLimitReached } from '../services/usage.js'

export async function usageCeilingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const license = req.license
  if (!license) {
    res.status(401).json({ error: 'No license context' })
    return
  }

  try {
    const limitHit = await isLimitReached(license.keyHash)
    if (limitHit) {
      res.status(429).json({
        error: 'usage_limit_reached',
        message: 'Monthly usage ceiling reached. Enable BYOK in Settings to continue.',
        limitUsd: 30
      })
      return
    }
    next()
  } catch (err) {
    console.error('[usage] Ceiling check failed:', err)
    // Fail open — don't block on usage check errors
    next()
  }
}
