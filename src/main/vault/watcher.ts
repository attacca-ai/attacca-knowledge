import type { FSWatcher } from 'chokidar'
import { relative, sep } from 'path'
import { resolveVaultRoot, isExternalVault } from './paths'

export type VaultChangeKind = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface VaultChangeEvent {
  kind: VaultChangeKind
  path: string // relative, forward-slashed
  absPath: string
}

type Listener = (event: VaultChangeEvent) => void

let watcher: FSWatcher | null = null
let currentRoot: string | null = null
const listeners = new Set<Listener>()

/**
 * Starts (or restarts) the vault watcher. No-ops if the vault mode is
 * managed and the caller hasn't opted into watching — external vault
 * changes are the main case we care about (Obsidian edits, etc.).
 */
export async function startWatcher(opts?: { force?: boolean }): Promise<void> {
  const root = resolveVaultRoot()
  if (watcher && currentRoot === root) return
  if (!opts?.force && !isExternalVault()) {
    // Managed vault: renderer is the only writer so chokidar is overhead.
    return
  }
  await stopWatcher()
  // Dynamic import keeps chokidar out of preload/renderer bundles.
  const chokidar = await import('chokidar')
  watcher = chokidar.watch(root, {
    ignored: (p: string) => /(^|[\\/])\./.test(p) || p.includes(`${sep}node_modules${sep}`),
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 }
  })
  currentRoot = root
  const emit = (kind: VaultChangeKind) => (absPath: string) => {
    const rel = relative(root, absPath).split(sep).join('/')
    const event: VaultChangeEvent = { kind, path: rel, absPath }
    for (const l of listeners) l(event)
  }
  watcher.on('add', emit('add'))
  watcher.on('change', emit('change'))
  watcher.on('unlink', emit('unlink'))
  watcher.on('addDir', emit('addDir'))
  watcher.on('unlinkDir', emit('unlinkDir'))
  console.log(`[vault] Watching ${root}`)
}

export async function stopWatcher(): Promise<void> {
  if (!watcher) return
  await watcher.close()
  watcher = null
  currentRoot = null
}

export function onVaultChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
