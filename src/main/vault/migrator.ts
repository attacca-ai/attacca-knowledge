import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import { ensureFolders } from './manager'
import { legacyKbRoot, defaultManagedVaultRoot, readVaultMode, resolveVaultRoot } from './paths'

/**
 * Migrates the v0.2 `attacca-kb/` layout into the v0.3 `attacca-vault/`
 * managed layout (spec §6.1 Migration). Idempotent — safe to run on
 * every boot. Skips if vault mode is external or managed root already
 * has a migration marker.
 */
export function migrateLegacyKbIfNeeded(): void {
  const mode = readVaultMode()
  if (mode?.kind === 'external') return
  const src = legacyKbRoot()
  if (!existsSync(src)) {
    // Fresh install — just scaffold the new root.
    ensureFolders(defaultManagedVaultRoot())
    return
  }
  const dst = resolveVaultRoot()
  if (src === dst) return // already pointed at legacy by `resolveVaultRoot` fallback
  ensureFolders(dst)

  // Marker prevents double-migration.
  const marker = join(dst, '.attacca-migrated')
  if (existsSync(marker)) return

  moveIfExists(join(src, 'inbox'), join(dst, '00-Inbox'))
  moveIfExists(join(src, 'decisions'), join(dst, '05-Decisions'))
  moveIfExists(join(src, 'daily'), join(dst, 'daily'))
  moveIfExists(join(src, 'memory'), join(dst, 'memory'))
  moveIfExists(join(src, 'artifacts'), join(dst, '00-Inbox', 'artifacts'))
  moveIfExists(join(src, 'knowledge'), join(dst, '03-Resources'))

  try {
    require('fs').writeFileSync(marker, new Date().toISOString(), 'utf-8')
  } catch {
    /* non-fatal */
  }
  console.log(`[vault] Migrated ${src} -> ${dst}`)
}

/** Recursively moves contents of `src` into `dst`, creating `dst` if needed. */
function moveIfExists(src: string, dst: string): void {
  if (!existsSync(src)) return
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    const from = join(src, entry)
    const to = join(dst, entry)
    try {
      const st = statSync(from)
      if (st.isDirectory()) {
        moveIfExists(from, to)
      } else if (!existsSync(to)) {
        renameSync(from, to)
      }
    } catch {
      /* skip unreadable entries */
    }
  }
}
