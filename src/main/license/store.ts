import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

const LICENSE_FILE = join(app.getPath('userData'), 'license.enc')

export interface StoredLicense {
  key: string
  plan: 'monthly' | 'yearly' | 'lifetime'
  email?: string
  validatedAt: number
}

export function saveLicense(license: StoredLicense): void {
  const dir = dirname(LICENSE_FILE)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const json = JSON.stringify(license)

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(json)
    writeFileSync(LICENSE_FILE, encrypted)
  } else {
    // Fallback: store as-is (not ideal but functional)
    writeFileSync(LICENSE_FILE, json, 'utf-8')
  }
}

export function loadLicense(): StoredLicense | null {
  if (!existsSync(LICENSE_FILE)) return null

  try {
    const raw = readFileSync(LICENSE_FILE)

    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(raw)
      return JSON.parse(decrypted) as StoredLicense
    } else {
      return JSON.parse(raw.toString('utf-8')) as StoredLicense
    }
  } catch {
    return null
  }
}

export function clearLicense(): void {
  if (existsSync(LICENSE_FILE)) {
    const { unlinkSync } = require('fs')
    unlinkSync(LICENSE_FILE)
  }
}
