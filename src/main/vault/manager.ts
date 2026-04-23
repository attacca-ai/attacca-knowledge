import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  statSync,
  renameSync
} from 'fs'
import { join, dirname, relative, sep } from 'path'
import { app } from 'electron'
import {
  MANAGED_FOLDERS,
  type VaultMode,
  defaultManagedVaultRoot,
  isExternalVault,
  isWritableVaultPath,
  readVaultMode,
  resolveVaultRoot
} from './paths'
import { parseNote, serializeNote, type Frontmatter, type ParsedNote } from './frontmatter'

export interface VaultNode {
  name: string
  /** Path relative to vault root, using forward slashes. */
  path: string
  absPath: string
  kind: 'folder' | 'file'
  size?: number
  mtime?: number
  children?: VaultNode[]
}

export interface ScanReport {
  root: string
  mode: VaultMode['kind']
  present: string[]
  missing: string[]
  hasClaudeMd: boolean
}

/**
 * Creates the managed-folder scaffold under the current vault root.
 * Safe to call repeatedly — only creates missing directories.
 */
export function ensureFolders(root: string = resolveVaultRoot()): void {
  mkdirSync(root, { recursive: true })
  for (const f of MANAGED_FOLDERS) {
    mkdirSync(join(root, f), { recursive: true })
  }
  mkdirSync(join(root, '00-Inbox', 'artifacts'), { recursive: true })
  mkdirSync(join(root, '07-Reviews', 'weekly'), { recursive: true })
  mkdirSync(join(root, '07-Reviews', 'monthly'), { recursive: true })
}

/**
 * Scans a candidate external vault folder and reports which Attacca-
 * managed folders exist vs are missing. Used during the "Switch to
 * existing vault" flow (spec §6.6).
 */
export function scanFolders(root: string): ScanReport {
  const mode = readVaultMode()
  const present: string[] = []
  const missing: string[] = []
  for (const f of MANAGED_FOLDERS) {
    const p = join(root, f)
    if (existsSync(p)) present.push(f)
    else missing.push(f)
  }
  return {
    root,
    mode: mode?.kind ?? 'managed',
    present,
    missing,
    hasClaudeMd: existsSync(join(root, 'CLAUDE.md'))
  }
}

/**
 * Builds a VaultNode tree rooted at the vault folder.
 * Skips hidden folders (dot-prefixed) and node_modules to stay snappy
 * in external Obsidian vaults that may contain templates or plugins.
 */
export function listTree(root: string = resolveVaultRoot(), maxDepth = 4): VaultNode[] {
  if (!existsSync(root)) return []
  return readDir(root, root, 0, maxDepth).children ?? []
}

function readDir(absPath: string, vaultRoot: string, depth: number, maxDepth: number): VaultNode {
  const name = absPath === vaultRoot ? '/' : (absPath.split(sep).pop() ?? '')
  const rel = relative(vaultRoot, absPath).split(sep).join('/')
  const node: VaultNode = {
    name,
    path: rel || '/',
    absPath,
    kind: 'folder',
    children: []
  }
  if (depth >= maxDepth) return node
  let entries: string[]
  try {
    entries = readdirSync(absPath)
  } catch {
    return node
  }
  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'node_modules') continue
    const entryAbs = join(absPath, entry)
    let st
    try {
      st = statSync(entryAbs)
    } catch {
      continue
    }
    if (st.isDirectory()) {
      node.children!.push(readDir(entryAbs, vaultRoot, depth + 1, maxDepth))
    } else if (st.isFile() && (entry.endsWith('.md') || entry.endsWith('.mdx'))) {
      node.children!.push({
        name: entry,
        path: relative(vaultRoot, entryAbs).split(sep).join('/'),
        absPath: entryAbs,
        kind: 'file',
        size: st.size,
        mtime: st.mtimeMs
      })
    }
  }
  // Folders first, alphabetical inside each group.
  node.children!.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return node
}

/**
 * Reads a note given its path relative to the vault root. Returns parsed
 * frontmatter + body. Throws if path escapes the vault.
 */
export function readNote(relPath: string): ParsedNote & { path: string; absPath: string } {
  const abs = resolveInsideVault(relPath)
  const content = readFileSync(abs, 'utf-8')
  const parsed = parseNote(content)
  return { ...parsed, path: relPath, absPath: abs }
}

/**
 * Writes a note at the given relative path. Enforces the managed-folder
 * write gate in external mode (spec §2.3 resolved Q4).
 */
export function writeNote(
  relPath: string,
  body: string,
  frontmatter: Frontmatter,
  opts?: { preserveRaw?: string }
): { absPath: string } {
  const abs = resolveInsideVault(relPath)
  if (!isWritableVaultPath(abs)) {
    throw new Error(
      `Vault write denied: ${relPath}. Folder not in managed set and not toggled writable.`
    )
  }
  mkdirSync(dirname(abs), { recursive: true })
  const content = serializeNote(body, frontmatter, opts?.preserveRaw)
  writeFileSync(abs, content, 'utf-8')
  return { absPath: abs }
}

/**
 * Soft-delete: moves the file to `04-Archive/` (spec §9 hard boundary:
 * "Attacca never deletes user vault files. Archive only.").
 */
export function archiveNote(relPath: string): { archivedTo: string } {
  const abs = resolveInsideVault(relPath)
  if (!existsSync(abs)) throw new Error(`Note not found: ${relPath}`)
  const archiveDir = join(resolveVaultRoot(), '04-Archive')
  mkdirSync(archiveDir, { recursive: true })
  const name = abs.split(sep).pop() ?? 'archived.md'
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = join(archiveDir, `${ts}-${name}`)
  renameSync(abs, dest)
  return { archivedTo: relative(resolveVaultRoot(), dest).split(sep).join('/') }
}

/**
 * Applies a vault mode change: validates the path, creates missing
 * managed folders with consent embedded in the call, and persists to
 * settings.json.
 */
export function applyVaultMode(mode: VaultMode, opts?: { createMissing?: boolean }): ScanReport {
  const root = mode.kind === 'external' ? mode.path : defaultManagedVaultRoot()
  if (mode.kind === 'external' && (!root || !existsSync(root))) {
    throw new Error(`External vault path does not exist: ${root}`)
  }
  if (mode.kind === 'managed') mkdirSync(root, { recursive: true })
  const report = scanFolders(root)
  if (opts?.createMissing || mode.kind === 'managed') ensureFolders(root)
  persistMode(mode)
  return report
}

/**
 * Persists vault mode to settings.json. Writes alongside existing keys
 * — does not overwrite unrelated settings.
 */
function persistMode(mode: VaultMode): void {
  const settingsPath = join(app.getPath('userData'), 'settings.json')
  let settings: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    } catch {
      settings = {}
    }
  }
  settings.vaultMode = mode
  mkdirSync(dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
}

function resolveInsideVault(relPath: string): string {
  const root = resolveVaultRoot()
  const abs = join(root, relPath)
  const rel = relative(root, abs)
  if (rel.startsWith('..') || rel.startsWith(sep + '..')) {
    throw new Error(`Path escapes vault: ${relPath}`)
  }
  return abs
}

/**
 * Reads CLAUDE.md from the vault root if present. Capped at 4KB per
 * spec §6.6. Returns empty string if absent. Used by the runtime
 * system-prompt assembler.
 */
export function readVaultClaudeMd(): string {
  const p = join(resolveVaultRoot(), 'CLAUDE.md')
  if (!existsSync(p)) return ''
  try {
    const content = readFileSync(p, 'utf-8')
    return content.length > 4096 ? content.slice(0, 4096) : content
  } catch {
    return ''
  }
}

export { resolveVaultRoot, isExternalVault, MANAGED_FOLDERS }
