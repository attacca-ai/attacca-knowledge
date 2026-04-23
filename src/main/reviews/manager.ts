import { existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { ensureFolders, readNote, resolveVaultRoot, writeNote } from '../vault'
import { generateReview, type ReviewActivity, type ReviewPeriod } from './generator'

/**
 * Review entity (spec §3.2). Backed on disk by
 * `07-Reviews/{weekly|monthly}/{YYYY-Www|YYYY-MM}.md`. Vault is source
 * of truth — the in-memory list is just a cache the renderer queries.
 */
export interface Review {
  id: string
  period: ReviewPeriod
  generatedAt: number
  rangeStart: number
  rangeEnd: number
  content: string
  highlights: ReviewActivity
  userNotes?: string
  acknowledged: boolean
  vaultPath: string
}

const REVIEWS_ROOT = '07-Reviews'

function dirFor(period: ReviewPeriod): string {
  return `${REVIEWS_ROOT}/${period === 'week' ? 'weekly' : 'monthly'}`
}

function ensureReviewDir(period: ReviewPeriod): string {
  const root = resolveVaultRoot()
  const rel = dirFor(period)
  const abs = join(root, rel)
  if (!existsSync(abs)) ensureFolders(root)
  if (!existsSync(abs)) mkdirSync(abs, { recursive: true })
  return abs
}

/** ISO week string YYYY-Www. Mirrors `date-fns` format but
 * without the dependency. */
function isoWeekKey(ts: number): string {
  const d = new Date(ts)
  // Copy date so the original isn't mutated.
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = x.getUTCDay() || 7
  x.setUTCDate(x.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((x.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${x.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

function monthKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function keyFor(period: ReviewPeriod, ts: number): string {
  return period === 'week' ? isoWeekKey(ts) : monthKey(ts)
}

export function listReviews(period?: ReviewPeriod): Review[] {
  const out: Review[] = []
  const periods: ReviewPeriod[] = period ? [period] : ['week', 'month']
  for (const p of periods) {
    const abs = ensureReviewDir(p)
    let entries: string[] = []
    try {
      entries = readdirSync(abs)
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue
      try {
        if (!statSync(join(abs, entry)).isFile()) continue
      } catch {
        continue
      }
      const rel = `${dirFor(p)}/${entry}`
      const r = readReviewFile(rel, p)
      if (r) out.push(r)
    }
  }
  out.sort((a, b) => b.generatedAt - a.generatedAt)
  return out
}

function readReviewFile(relPath: string, period: ReviewPeriod): Review | null {
  try {
    const note = readNote(relPath)
    const fm = (note.frontmatter.attacca ?? {}) as Record<string, unknown>
    const fileName = relPath.split('/').pop() ?? ''
    const key = fileName.replace(/\.md$/, '')
    return {
      id: (fm.id as string) ?? `rev_${period}_${key}`,
      period,
      generatedAt: Number(fm.generatedAt ?? 0),
      rangeStart: Number(fm.rangeStart ?? 0),
      rangeEnd: Number(fm.rangeEnd ?? 0),
      content: note.body.trim(),
      highlights: {
        rangeStart: Number(fm.rangeStart ?? 0),
        rangeEnd: Number(fm.rangeEnd ?? 0),
        capturesProcessed: Number(fm.capturesProcessed ?? 0),
        decisionsMade: ((fm.decisionsMade as string[]) ?? []).slice(),
        decisionsRevisited: ((fm.decisionsRevisited as string[]) ?? []).slice(),
        areasActive: ((fm.areasActive as string[]) ?? []).slice(),
        areasNeglected: ((fm.areasNeglected as string[]) ?? []).slice(),
        tasksCompleted: Number(fm.tasksCompleted ?? 0),
        tasksMoved: Number(fm.tasksMoved ?? 0),
        projectsArchived: ((fm.projectsArchived as string[]) ?? []).slice(),
        lessonsExtracted: ((fm.lessonsExtracted as string[]) ?? []).slice(),
        patternsDetected: ((fm.patternsDetected as string[]) ?? []).slice()
      },
      userNotes: (fm.userNotes as string) || undefined,
      acknowledged: Boolean(fm.acknowledged),
      vaultPath: relPath
    }
  } catch {
    return null
  }
}

function writeReview(r: Review): Review {
  const note = (() => {
    try {
      return readNote(r.vaultPath)
    } catch {
      return null
    }
  })()
  writeNote(
    r.vaultPath,
    `${r.content}\n`,
    {
      title: `${r.period === 'week' ? 'Weekly' : 'Monthly'} review`,
      date: new Date(r.generatedAt).toISOString().slice(0, 10),
      attacca: {
        type: 'review',
        id: r.id,
        period: r.period,
        generatedAt: r.generatedAt,
        rangeStart: r.rangeStart,
        rangeEnd: r.rangeEnd,
        capturesProcessed: r.highlights.capturesProcessed,
        decisionsMade: r.highlights.decisionsMade,
        decisionsRevisited: r.highlights.decisionsRevisited,
        areasActive: r.highlights.areasActive,
        areasNeglected: r.highlights.areasNeglected,
        tasksCompleted: r.highlights.tasksCompleted,
        tasksMoved: r.highlights.tasksMoved,
        projectsArchived: r.highlights.projectsArchived,
        lessonsExtracted: r.highlights.lessonsExtracted,
        patternsDetected: r.highlights.patternsDetected,
        acknowledged: r.acknowledged,
        userNotes: r.userNotes ?? ''
      }
    },
    { preserveRaw: note?.rawFrontmatter }
  )
  const read = readReviewFile(r.vaultPath, r.period)
  if (!read) throw new Error(`Failed to read back review: ${r.vaultPath}`)
  return read
}

/** Ranges: week = trailing 7 days; month = trailing 30 days. Both end
 * at the call time so manual runs reflect "up to now". */
export function defaultRange(period: ReviewPeriod, now: number = Date.now()): [number, number] {
  const end = now
  const span = period === 'week' ? 7 * 86400000 : 30 * 86400000
  return [end - span, end]
}

/** Generates + persists a review. If one already exists for this period
 * key it is overwritten — callers should use `keyFor` to check first. */
export async function generateAndSaveReview(period: ReviewPeriod): Promise<Review> {
  ensureReviewDir(period)
  const now = Date.now()
  const [rangeStart, rangeEnd] = defaultRange(period, now)
  const gen = await generateReview(period, rangeStart, rangeEnd)
  const key = keyFor(period, now)
  const rel = `${dirFor(period)}/${key}.md`
  const review: Review = {
    id: `rev_${period}_${key}`,
    period,
    generatedAt: now,
    rangeStart,
    rangeEnd,
    content: gen.content,
    highlights: gen.highlights,
    acknowledged: false,
    vaultPath: rel
  }
  return writeReview(review)
}

export function getReview(id: string): Review | null {
  return listReviews().find((r) => r.id === id) ?? null
}

export function acknowledgeReview(id: string): Review {
  const r = getReview(id)
  if (!r) throw new Error(`Review not found: ${id}`)
  return writeReview({ ...r, acknowledged: true })
}

export function addReviewNotes(id: string, notes: string): Review {
  const r = getReview(id)
  if (!r) throw new Error(`Review not found: ${id}`)
  return writeReview({ ...r, userNotes: notes })
}
