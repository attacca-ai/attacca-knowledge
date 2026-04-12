/**
 * Per-toolkit default account storage (Spec B PR B3).
 * Lives in `settings.json` under `defaultAccounts: { [toolkit]: connectionId }`.
 *
 * When a toolkit has ≥2 connections and the agent calls an action without an
 * explicit `connectionId`, the resolver uses the default from this map. If no
 * default is set, the tool call returns `multiple_accounts_no_default` and
 * the agent asks the user which account to use.
 */

import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

interface SettingsShape {
  defaultAccounts?: Record<string, string>
  [key: string]: unknown
}

function getSettingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function readSettings(): SettingsShape {
  const path = getSettingsPath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as SettingsShape
  } catch {
    return {}
  }
}

function writeSettings(settings: SettingsShape): void {
  const path = getSettingsPath()
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8')
}

export function getDefaultAccount(toolkit: string): string | undefined {
  const settings = readSettings()
  return settings.defaultAccounts?.[toolkit]
}

export function getAllDefaults(): Record<string, string> {
  return readSettings().defaultAccounts ?? {}
}

export function setDefaultAccount(toolkit: string, connectionId: string): void {
  const settings = readSettings()
  settings.defaultAccounts = {
    ...(settings.defaultAccounts ?? {}),
    [toolkit]: connectionId
  }
  writeSettings(settings)
}

export function removeDefaultAccount(toolkit: string): void {
  const settings = readSettings()
  if (!settings.defaultAccounts) return
  const updated = { ...settings.defaultAccounts }
  delete updated[toolkit]
  settings.defaultAccounts = updated
  writeSettings(settings)
}

/**
 * Clean up stale default entries — remove any toolkit whose default `connectionId`
 * no longer appears in the provided live-accounts list. Called after disconnect
 * to enforce DVR-8 (no stale defaultAccounts entries after disconnect).
 */
export function pruneDefaults(liveConnectionIds: Set<string>): number {
  const settings = readSettings()
  if (!settings.defaultAccounts) return 0

  const updated: Record<string, string> = {}
  let removed = 0
  for (const [toolkit, connId] of Object.entries(settings.defaultAccounts)) {
    if (liveConnectionIds.has(connId)) {
      updated[toolkit] = connId
    } else {
      removed++
    }
  }
  if (removed > 0) {
    settings.defaultAccounts = updated
    writeSettings(settings)
  }
  return removed
}
