/**
 * Multi-account connection tracking for Composio integrations.
 * Stores labels (Work/Personal/Shared) for each connected account.
 */

import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export type AccountLabel = 'Work' | 'Personal' | 'Shared'

export interface ConnectionLabel {
  connectionId: string
  toolkit: string
  label: AccountLabel
  customName: string | null
  /** When this row was first created — used by migration banner + telemetry */
  createdAt: number
}

interface ConnectionsStore {
  connections: ConnectionLabel[]
}

function getStorePath(): string {
  return join(app.getPath('userData'), 'composio-connections.json')
}

const VALID_LABELS: AccountLabel[] = ['Work', 'Personal', 'Shared']

export function isValidLabel(label: string): label is AccountLabel {
  return VALID_LABELS.includes(label as AccountLabel)
}

export function loadConnections(): ConnectionLabel[] {
  try {
    const path = getStorePath()
    if (!existsSync(path)) return []
    const data = JSON.parse(readFileSync(path, 'utf-8')) as ConnectionsStore
    return data.connections || []
  } catch {
    return []
  }
}

export function saveConnections(connections: ConnectionLabel[]): void {
  const path = getStorePath()
  writeFileSync(path, JSON.stringify({ connections }, null, 2), 'utf-8')
}

export function addConnection(label: ConnectionLabel): void {
  if (!isValidLabel(label.label)) {
    throw new Error(`Invalid connection label: ${label.label}`)
  }
  const connections = loadConnections()
  // Remove existing entry for same connectionId
  const filtered = connections.filter((c) => c.connectionId !== label.connectionId)
  filtered.push(label)
  saveConnections(filtered)
}

/**
 * Set the label (and optionally customName) on an existing connection row.
 * Returns false if the connectionId is unknown.
 */
export function setConnectionLabel(
  connectionId: string,
  label: AccountLabel,
  customName?: string | null
): boolean {
  if (!isValidLabel(label)) {
    throw new Error(`Invalid connection label: ${label}`)
  }
  const connections = loadConnections()
  const idx = connections.findIndex((c) => c.connectionId === connectionId)
  if (idx === -1) return false
  connections[idx] = {
    ...connections[idx],
    label,
    customName: customName === undefined ? connections[idx].customName : customName
  }
  saveConnections(connections)
  return true
}

export function removeConnection(connectionId: string): void {
  const connections = loadConnections().filter((c) => c.connectionId !== connectionId)
  saveConnections(connections)
}

export function getConnectionsForToolkit(toolkit: string): ConnectionLabel[] {
  return loadConnections().filter((c) => c.toolkit.toLowerCase() === toolkit.toLowerCase())
}

export function getConnectionLabel(connectionId: string): ConnectionLabel | undefined {
  return loadConnections().find((c) => c.connectionId === connectionId)
}
