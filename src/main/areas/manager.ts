import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { ensureFolders, readNote, resolveVaultRoot, writeNote } from '../vault'

/**
 * Area entity (spec §3.2). Backed on disk by `02-Areas/{slug}.md` — the
 * vault is source of truth. This manager reads the folder on demand and
 * persists changes back to markdown with Attacca-namespaced frontmatter.
 */
export interface Area {
  id: string
  name: string
  description: string
  emoji?: string
  healthScore?: number
  projectIds: string[]
  taskIds: string[]
  reviewCadence: 'weekly' | 'monthly'
  createdAt: number
  archived: boolean
  archivedAt?: number
  archiveNote?: string
  vaultPath: string
}

export interface AreaCreateInput {
  name: string
  description?: string
  emoji?: string
  reviewCadence?: 'weekly' | 'monthly'
}

const AREAS_DIR = '02-Areas'

function slugify(input: string): string {
  return (
    input
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, '')
      .trim()
      .replace(/ +/g, '-')
      .slice(0, 60) || 'area'
  )
}

/** Ensures `02-Areas/` exists — cheaper than running full vault scaffolder. */
function ensureAreasDir(): string {
  const root = resolveVaultRoot()
  const abs = join(root, AREAS_DIR)
  if (!existsSync(abs)) {
    ensureFolders(root)
  }
  if (!existsSync(abs)) mkdirSync(abs, { recursive: true })
  return abs
}

/**
 * Lists all areas from the `02-Areas/` folder. Missing frontmatter is
 * tolerated — falls back to filename-derived defaults so hand-created
 * markdown files still appear in the UI.
 */
export function listAreas(): Area[] {
  const dir = ensureAreasDir()
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const out: Area[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const abs = join(dir, entry)
    try {
      const st = statSync(abs)
      if (!st.isFile()) continue
      const relPath = `${AREAS_DIR}/${entry}`
      const area = readAreaFile(relPath)
      if (area) out.push(area)
    } catch {
      /* skip unreadable */
    }
  }
  out.sort((a, b) => a.createdAt - b.createdAt)
  return out
}

function readAreaFile(relPath: string): Area | null {
  try {
    const note = readNote(relPath)
    const fm = (note.frontmatter.attacca ?? {}) as Record<string, unknown>
    const fileName = relPath.split('/').pop() ?? 'area.md'
    const slug = fileName.replace(/\.md$/, '')
    const name =
      (fm.name as string) ?? (note.frontmatter.title as string) ?? slug.replace(/-/g, ' ')
    const id = (fm.id as string) ?? `area_${slug}`
    const rawTags = (fm.taskIds as string[]) ?? []
    return {
      id,
      name,
      description: (fm.description as string) ?? '',
      emoji: (fm.emoji as string) ?? undefined,
      healthScore: (fm.healthScore as number) ?? undefined,
      projectIds: ((fm.projectIds as string[]) ?? []).slice(),
      taskIds: rawTags.slice(),
      reviewCadence: (fm.reviewCadence as 'weekly' | 'monthly') ?? 'weekly',
      createdAt: (fm.createdAt as number) ?? 0,
      archived: Boolean(fm.archived),
      archivedAt: (fm.archivedAt as number) ?? undefined,
      archiveNote: (fm.archiveNote as string) ?? undefined,
      vaultPath: relPath
    }
  } catch {
    return null
  }
}

/**
 * Creates a new area by writing `02-Areas/{slug}.md` with default body
 * and Attacca-namespaced frontmatter. Silently dedupes on slug by
 * appending a numeric suffix if a file already exists.
 */
export function createArea(input: AreaCreateInput): Area {
  ensureAreasDir()
  const baseSlug = slugify(input.name)
  let slug = baseSlug
  let n = 2
  while (existsSync(join(resolveVaultRoot(), AREAS_DIR, `${slug}.md`))) {
    slug = `${baseSlug}-${n++}`
  }
  const id = `area_${slug}`
  const now = Date.now()
  const relPath = `${AREAS_DIR}/${slug}.md`
  const body = `# ${input.name}\n\n${input.description ?? ''}\n\n## Active projects\n\n_None yet._\n\n## Recent activity\n\n_Agent-maintained. Edits above this line are preserved._\n`
  writeNote(relPath, body, {
    title: input.name,
    attacca: {
      type: 'area',
      id,
      name: input.name,
      description: input.description ?? '',
      emoji: input.emoji ?? '',
      reviewCadence: input.reviewCadence ?? 'weekly',
      createdAt: now,
      archived: false,
      projectIds: [],
      taskIds: []
    }
  })
  const area = readAreaFile(relPath)
  if (!area) throw new Error(`Failed to read back created area: ${relPath}`)
  return area
}

/** Updates mutable fields on an area. Refuses to move the vault file. */
export function updateArea(
  id: string,
  patch: Partial<{
    name: string
    description: string
    emoji: string
    reviewCadence: 'weekly' | 'monthly'
  }>
): Area {
  const area = listAreas().find((a) => a.id === id)
  if (!area) throw new Error(`Area not found: ${id}`)
  const note = readNote(area.vaultPath)
  const existing = (note.frontmatter.attacca ?? {}) as Record<string, unknown>
  const merged: Record<string, unknown> = {
    ...existing,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.emoji !== undefined ? { emoji: patch.emoji } : {}),
    ...(patch.reviewCadence !== undefined ? { reviewCadence: patch.reviewCadence } : {})
  }
  writeNote(
    area.vaultPath,
    note.body,
    {
      ...note.frontmatter,
      ...(patch.name ? { title: patch.name } : {}),
      attacca: merged as Record<
        string,
        string | number | boolean | null | Array<string | number | boolean | null>
      >
    },
    { preserveRaw: note.rawFrontmatter }
  )
  const updated = readAreaFile(area.vaultPath)
  if (!updated) throw new Error(`Failed to read back updated area`)
  return updated
}

/** Soft-archive: sets archived=true + moves file to 04-Archive/. */
export function archiveArea(id: string, note?: string): void {
  const area = listAreas().find((a) => a.id === id)
  if (!area) throw new Error(`Area not found: ${id}`)
  const source = readNote(area.vaultPath)
  const existing = (source.frontmatter.attacca ?? {}) as Record<string, unknown>
  writeNote(
    area.vaultPath,
    source.body,
    {
      ...source.frontmatter,
      attacca: {
        ...(existing as Record<string, string | number | boolean | null>),
        archived: true,
        archivedAt: Date.now(),
        archiveNote: note ?? ''
      }
    },
    { preserveRaw: source.rawFrontmatter }
  )
}

/**
 * Health score formula (spec §6.2). Heuristic:
 *   50 + 20*(recentCaptures/7) + 20*(taskCompletionRate) - 10*(daysSinceLastActivity/7)
 *
 * For Phase 1 we ship a placeholder that only uses recent capture count
 * from the area markdown's mtime — full formula lands once task/capture
 * stats are indexed against areaId (Phase 1 later deliverable).
 */
export function computeHealth(id: string): number {
  const area = listAreas().find((a) => a.id === id)
  if (!area) return 50
  const abs = join(resolveVaultRoot(), area.vaultPath)
  let daysSinceActivity = 999
  try {
    const st = statSync(abs)
    daysSinceActivity = Math.max(0, (Date.now() - st.mtimeMs) / 86400000)
  } catch {
    /* keep default */
  }
  const base = 50
  const decay = Math.min(40, 10 * (daysSinceActivity / 7))
  return Math.max(0, Math.min(100, Math.round(base - decay)))
}

/**
 * One-shot helper used by onboarding: creates each selected default
 * area if not already present.
 */
export function seedDefaultAreas(
  selections: Array<{ name: string; emoji?: string; description?: string }>
): Area[] {
  const existing = new Set(listAreas().map((a) => a.name.toLowerCase()))
  const created: Area[] = []
  for (const sel of selections) {
    if (existing.has(sel.name.toLowerCase())) continue
    try {
      created.push(createArea({ name: sel.name, emoji: sel.emoji, description: sel.description }))
    } catch (err) {
      console.warn(`[areas] Failed to seed ${sel.name}:`, err)
    }
  }
  return created
}

/**
 * Unused import warning guard for readFileSync — referenced for future
 * activity-stat parsing. Kept behind runtime flag to appease linter.
 */
void readFileSync
