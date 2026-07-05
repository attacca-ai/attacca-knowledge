import { app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join, relative, isAbsolute, sep } from 'path'

/**
 * VaultMode — mirrors the renderer type (see src/preload/index.d.ts).
 * Managed: Attacca owns {userData}/attacca-vault/
 * External: user points at existing folder (e.g. Obsidian vault)
 */
export type VaultMode = { kind: 'managed'; path: string } | { kind: 'external'; path: string }

/**
 * The Attacca-managed folder set — always read-write in external mode.
 * Writes to any folder outside this set require a per-folder toggle in
 * `vault.externalFolderWrites` settings map (resolved Q4, spec §2.3).
 */
export const MANAGED_FOLDERS = [
  '00-Inbox',
  '01-Projects',
  '02-Areas',
  '03-Resources',
  '04-Archive',
  '05-Decisions',
  '06-Lessons',
  '07-Reviews',
  '08-Patterns',
  'daily',
  'memory'
] as const

export type ManagedFolder = (typeof MANAGED_FOLDERS)[number]

/**
 * Canonical sentinel the renderer stores for managed mode. The main
 * process expands this to `{userData}/attacca-vault/` at resolve time.
 */
const MANAGED_SENTINEL = 'managed'

/**
 * Legacy v0.2 root. Migrator moves content out of this into the new
 * `attacca-vault/` folder on first Phase 1 boot.
 */
export function legacyKbRoot(): string {
  return join(app.getPath('userData'), 'attacca-kb')
}

/**
 * Default managed root for v0.3.
 */
export function defaultManagedVaultRoot(): string {
  return join(app.getPath('userData'), 'attacca-vault')
}

/**
 * Reads `vaultMode` from settings.json. Returns null if unset (pre-onboarding).
 */
export function readVaultMode(): VaultMode | null {
  const settingsPath = join(app.getPath('userData'), 'settings.json')
  if (!existsSync(settingsPath)) return null
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
    const mode = settings.vaultMode as VaultMode | undefined
    if (!mode || typeof mode !== 'object') return null
    if (mode.kind !== 'managed' && mode.kind !== 'external') return null
    return mode
  } catch {
    return null
  }
}

/**
 * Resolves the vault root to an absolute path based on stored mode.
 * Falls back to legacy kb root if unset, so existing writes still work
 * during the migration window.
 */
export function resolveVaultRoot(): string {
  const mode = readVaultMode()
  if (!mode) {
    // Pre-onboarding or old installs — use legacy so captures still save.
    return legacyKbRoot()
  }
  if (mode.kind === 'external') return mode.path
  // Managed — expand sentinel to default path.
  if (mode.path === MANAGED_SENTINEL || !mode.path) return defaultManagedVaultRoot()
  return mode.path
}

/**
 * True when vault mode is external. External mode enables chokidar
 * watching and respects user's existing folder structure.
 */
export function isExternalVault(): boolean {
  return readVaultMode()?.kind === 'external'
}

/**
 * Returns absolute path for a managed folder under the current vault root.
 */
export function vaultPath(...segments: string[]): string {
  return join(resolveVaultRoot(), ...segments)
}

/**
 * Checks whether a path falls inside a writable (managed) folder.
 * For external vault mode we also consult `vault.externalFolderWrites`
 * settings map — spec §2.3 resolved Q4.
 */
export function isWritableVaultPath(absPath: string): boolean {
  const root = resolveVaultRoot()
  // path.relative handles Windows case-insensitivity and drive-letter casing;
  // a raw startsWith prefix check rejects `c:\vault` vs `C:\Vault` and wrongly
  // accepts sibling folders like `C:\vault-backup`.
  const rel = relative(root, absPath)
  if (!rel || rel === '.' || rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) {
    return false
  }
  const topSegment = rel.split(/[\\/]/)[0]
  if ((MANAGED_FOLDERS as readonly string[]).includes(topSegment)) return true

  // External vault: allow writes to user-toggled folders.
  if (!isExternalVault()) return false
  const settingsPath = join(app.getPath('userData'), 'settings.json')
  if (!existsSync(settingsPath)) return false
  try {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
    const writes = settings['vault.externalFolderWrites'] as Record<string, boolean> | undefined
    return Boolean(writes?.[topSegment])
  } catch {
    return false
  }
}
