import type { Request, Response, NextFunction } from 'express'
import { verifyLicense, type LicenseInfo } from '../services/license.js'

// Extend Express Request to include license info
declare global {
  namespace Express {
    interface Request {
      license?: LicenseInfo
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' })
    return
  }

  const licenseKey = authHeader.slice(7).trim()
  if (!licenseKey) {
    res.status(401).json({ error: 'Empty license key' })
    return
  }

  try {
    const info = await verifyLicense(licenseKey)

    if (!info.valid) {
      res.status(403).json({ error: 'Invalid or expired license' })
      return
    }

    req.license = info
    next()
  } catch (err) {
    console.error('[auth] License verification error:', err)
    res.status(500).json({ error: 'License verification failed' })
  }
}
