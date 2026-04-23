import { existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { ensureFolders, readNote, resolveVaultRoot, writeNote } from '../vault'

/**
 * Decision entity (spec §3.2). Backed on disk by
 * `05-Decisions/YYYY-MM-DD-{slug}.md`. Vault is source of truth; manager
 * parses the folder on demand and persists through the vault writer so
 * external Obsidian edits are never trampled.
 */
export interface DecisionRetrospective {
  actualOutcome: string
  didMatch: boolean | 'partly'
  lessons: string
  createdLessonId?: string
  revisitedAt: number
}

export interface Decision {
  id: string
  title: string
  context: string
  options: string[]
  chosen: string
  reasoning: string
  expectedOutcome: string
  revisitAt: number
  retrospective?: DecisionRetrospective
  areaId?: string
  projectId?: string
  tags: string[]
  createdAt: number
  status: 'active' | 'revisited' | 'reversed' | 'superseded'
  supersededBy?: string
  vaultPath: string
}

export interface DecisionCreateInput {
  title: string
  context: string
  options?: string[]
  chosen: string
  reasoning: string
  expectedOutcome: string
  revisitInDays: number
  areaId?: string
  projectId?: string
  tags?: string[]
}

export interface DecisionRetroInput {
  actualOutcome: string
  didMatch: boolean | 'partly'
  lessons: string
}

const DECISIONS_DIR = '05-Decisions'

function slugify(input: string): string {
  return (
    input
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, '')
      .trim()
      .replace(/ +/g, '-')
      .slice(0, 60) || 'decision'
  )
}

function ensureDecisionsDir(): string {
  const root = resolveVaultRoot()
  const abs = join(root, DECISIONS_DIR)
  if (!existsSync(abs)) ensureFolders(root)
  if (!existsSync(abs)) mkdirSync(abs, { recursive: true })
  return abs
}

function isoDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

/** Reads every `.md` in 05-Decisions/ and maps to Decision[]. */
export function listDecisions(): Decision[] {
  const dir = ensureDecisionsDir()
  let entries: string[] = []
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const out: Decision[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const abs = join(dir, entry)
    try {
      if (!statSync(abs).isFile()) continue
    } catch {
      continue
    }
    const relPath = `${DECISIONS_DIR}/${entry}`
    const d = readDecisionFile(relPath)
    if (d) out.push(d)
  }
  out.sort((a, b) => b.createdAt - a.createdAt)
  return out
}

function readDecisionFile(relPath: string): Decision | null {
  try {
    const note = readNote(relPath)
    const fm = (note.frontmatter.attacca ?? {}) as Record<string, unknown>
    const fileName = relPath.split('/').pop() ?? 'decision.md'
    const slug = fileName.replace(/\.md$/, '')
    const id = (fm.id as string) ?? `dec_${slug}`
    const hasRetro = fm.retroRevisitedAt !== undefined && fm.retroRevisitedAt !== null
    return {
      id,
      title: (fm.title as string) ?? (note.frontmatter.title as string) ?? slug,
      context: (fm.context as string) ?? '',
      options: ((fm.options as string[]) ?? []).slice(),
      chosen: (fm.chosen as string) ?? '',
      reasoning: (fm.reasoning as string) ?? '',
      expectedOutcome: (fm.expectedOutcome as string) ?? '',
      revisitAt: Number(fm.revisitAt ?? 0),
      retrospective: hasRetro
        ? {
            actualOutcome: String(fm.retroActualOutcome ?? ''),
            didMatch:
              fm.retroDidMatch === 'partly'
                ? 'partly'
                : fm.retroDidMatch === true ||
                  fm.retroDidMatch === 'true' ||
                  fm.retroDidMatch === 'yes',
            lessons: String(fm.retroLessons ?? ''),
            createdLessonId: (fm.retroLessonId as string) || undefined,
            revisitedAt: Number(fm.retroRevisitedAt ?? 0)
          }
        : undefined,
      areaId: (fm.areaId as string) ?? undefined,
      projectId: (fm.projectId as string) ?? undefined,
      tags: ((fm.tags as string[]) ?? []).slice(),
      createdAt: Number(fm.createdAt ?? 0),
      status: (fm.status as Decision['status']) ?? 'active',
      supersededBy: (fm.supersededBy as string) ?? undefined,
      vaultPath: relPath
    }
  } catch {
    return null
  }
}

function writeDecision(d: Decision, bodyOverride?: string): Decision {
  const body =
    bodyOverride ??
    buildBody(d)
  const note = (() => {
    try {
      return readNote(d.vaultPath)
    } catch {
      return null
    }
  })()
  writeNote(
    d.vaultPath,
    body,
    {
      title: d.title,
      date: isoDay(d.createdAt || Date.now()),
      attacca: {
        type: 'decision',
        id: d.id,
        title: d.title,
        context: d.context,
        options: d.options,
        chosen: d.chosen,
        reasoning: d.reasoning,
        expectedOutcome: d.expectedOutcome,
        revisitAt: d.revisitAt,
        areaId: d.areaId ?? '',
        projectId: d.projectId ?? '',
        tags: d.tags,
        createdAt: d.createdAt,
        status: d.status,
        supersededBy: d.supersededBy ?? '',
        ...(d.retrospective
          ? {
              retroActualOutcome: d.retrospective.actualOutcome,
              retroDidMatch:
                d.retrospective.didMatch === 'partly'
                  ? 'partly'
                  : d.retrospective.didMatch
                    ? 'true'
                    : 'false',
              retroLessons: d.retrospective.lessons,
              retroLessonId: d.retrospective.createdLessonId ?? '',
              retroRevisitedAt: d.retrospective.revisitedAt
            }
          : {})
      }
    },
    { preserveRaw: note?.rawFrontmatter }
  )
  const read = readDecisionFile(d.vaultPath)
  if (!read) throw new Error(`Failed to read back decision: ${d.vaultPath}`)
  return read
}

function buildBody(d: Decision): string {
  const optsMd = d.options.length
    ? d.options.map((o) => `- ${o}`).join('\n')
    : '_No alternatives captured._'
  const retroMd = d.retrospective
    ? `\n\n## Retrospective\n\n- Revisited: ${new Date(d.retrospective.revisitedAt).toISOString().slice(0, 10)}\n- Matched expectation: ${d.retrospective.didMatch === 'partly' ? 'partly' : d.retrospective.didMatch ? 'yes' : 'no'}\n- Actual outcome: ${d.retrospective.actualOutcome}\n- Lessons: ${d.retrospective.lessons}\n`
    : ''
  return `# ${d.title}\n\n## Context\n\n${d.context}\n\n## Options considered\n\n${optsMd}\n\n## Chosen\n\n${d.chosen}\n\n## Reasoning\n\n${d.reasoning}\n\n## Expected outcome\n\n${d.expectedOutcome}\n\n## Revisit\n\n- Due: ${new Date(d.revisitAt).toISOString().slice(0, 10)}${retroMd}`
}

export function createDecision(input: DecisionCreateInput): Decision {
  ensureDecisionsDir()
  const now = Date.now()
  const day = isoDay(now)
  const baseSlug = slugify(input.title)
  let slug = `${day}-${baseSlug}`
  let n = 2
  while (existsSync(join(resolveVaultRoot(), DECISIONS_DIR, `${slug}.md`))) {
    slug = `${day}-${baseSlug}-${n++}`
  }
  const revisitAt = now + Math.max(1, input.revisitInDays) * 86400000
  const d: Decision = {
    id: `dec_${slug}`,
    title: input.title,
    context: input.context,
    options: input.options ?? [],
    chosen: input.chosen,
    reasoning: input.reasoning,
    expectedOutcome: input.expectedOutcome,
    revisitAt,
    areaId: input.areaId,
    projectId: input.projectId,
    tags: input.tags ?? [],
    createdAt: now,
    status: 'active',
    vaultPath: `${DECISIONS_DIR}/${slug}.md`
  }
  return writeDecision(d)
}

export function updateDecision(
  id: string,
  patch: Partial<{
    title: string
    context: string
    options: string[]
    chosen: string
    reasoning: string
    expectedOutcome: string
    revisitAt: number
    areaId: string
    projectId: string
    tags: string[]
  }>
): Decision {
  const d = listDecisions().find((x) => x.id === id)
  if (!d) throw new Error(`Decision not found: ${id}`)
  const merged: Decision = { ...d, ...patch }
  return writeDecision(merged)
}

/** Forces the decision back into the revisit queue now. */
export function revisitDecisionNow(id: string): Decision {
  const d = listDecisions().find((x) => x.id === id)
  if (!d) throw new Error(`Decision not found: ${id}`)
  return writeDecision({ ...d, revisitAt: Date.now() })
}

/** Attaches a retrospective and marks status=revisited. */
export function completeDecision(id: string, retro: DecisionRetroInput): Decision {
  const d = listDecisions().find((x) => x.id === id)
  if (!d) throw new Error(`Decision not found: ${id}`)
  const next: Decision = {
    ...d,
    status: 'revisited',
    retrospective: {
      actualOutcome: retro.actualOutcome,
      didMatch: retro.didMatch,
      lessons: retro.lessons,
      revisitedAt: Date.now()
    }
  }
  return writeDecision(next)
}

/** Marks `oldId` as superseded by `newId`. Both must exist. */
export function supersedeDecision(oldId: string, newId: string): Decision {
  const all = listDecisions()
  const old = all.find((x) => x.id === oldId)
  const next = all.find((x) => x.id === newId)
  if (!old) throw new Error(`Decision not found: ${oldId}`)
  if (!next) throw new Error(`Decision not found: ${newId}`)
  return writeDecision({ ...old, status: 'superseded', supersededBy: newId })
}

/**
 * Returns decisions whose revisitAt has passed and that have no
 * retrospective yet. Surfaces in Today view and DecisionsView queue.
 */
export function scanDueDecisions(now: number = Date.now()): Decision[] {
  return listDecisions().filter(
    (d) => d.status === 'active' && !d.retrospective && d.revisitAt > 0 && d.revisitAt <= now
  )
}
