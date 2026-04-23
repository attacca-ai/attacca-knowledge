import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { llmCompletion } from '../llm/completion'
import { resolveVaultRoot } from '../vault'
import { listDecisions } from '../decisions/manager'
import { listAreas } from '../areas/manager'

export type ReviewPeriod = 'week' | 'month'

export interface ReviewActivity {
  rangeStart: number
  rangeEnd: number
  capturesProcessed: number
  decisionsMade: string[] // Decision.id[]
  decisionsRevisited: string[] // Decision.id[]
  areasActive: string[] // Area.id[] sorted by activity desc
  areasNeglected: string[] // Area.id[] with low activity
  tasksCompleted: number
  tasksMoved: number
  projectsArchived: string[]
  lessonsExtracted: string[] // Phase 2
  patternsDetected: string[] // Phase 2
}

export interface GeneratedReview {
  content: string
  highlights: ReviewActivity
}

/** Walks `00-Inbox/` and counts markdown files whose parent dated folder
 * falls inside the range. Cheap FS-only scan. */
function countCapturesInRange(rangeStart: number, rangeEnd: number): number {
  const inbox = join(resolveVaultRoot(), '00-Inbox')
  if (!existsSync(inbox)) return 0
  let total = 0
  for (const entry of readdirSync(inbox)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry)) continue
    const day = new Date(`${entry}T00:00:00Z`).getTime()
    if (Number.isNaN(day)) continue
    if (day < rangeStart - 86400000 || day > rangeEnd + 86400000) continue
    try {
      const files = readdirSync(join(inbox, entry)).filter((f) => f.endsWith('.md'))
      total += files.length
    } catch {
      /* skip */
    }
  }
  return total
}

/** Gathers activity signals for the given window. Deliberately
 * lightweight for Phase 1 — more signals (tasks, lessons, patterns)
 * land as those subsystems come online. */
export function collectActivity(rangeStart: number, rangeEnd: number): ReviewActivity {
  const decisions = listDecisions()
  const decisionsMade = decisions
    .filter((d) => d.createdAt >= rangeStart && d.createdAt <= rangeEnd)
    .map((d) => d.id)
  const decisionsRevisited = decisions
    .filter(
      (d) =>
        d.retrospective &&
        d.retrospective.revisitedAt >= rangeStart &&
        d.retrospective.revisitedAt <= rangeEnd
    )
    .map((d) => d.id)

  const captures = countCapturesInRange(rangeStart, rangeEnd)

  const areas = listAreas().filter((a) => !a.archived)
  // Use mtime as a proxy for recent activity.
  const scored = areas
    .map((a) => {
      const abs = join(resolveVaultRoot(), a.vaultPath)
      let mtime = 0
      try {
        mtime = statSync(abs).mtimeMs
      } catch {
        /* skip */
      }
      return { id: a.id, mtime }
    })
    .sort((x, y) => y.mtime - x.mtime)
  const activeCutoff = rangeStart
  const areasActive = scored.filter((s) => s.mtime >= activeCutoff).map((s) => s.id)
  const areasNeglected = scored.filter((s) => s.mtime < activeCutoff).map((s) => s.id)

  return {
    rangeStart,
    rangeEnd,
    capturesProcessed: captures,
    decisionsMade,
    decisionsRevisited,
    areasActive,
    areasNeglected,
    tasksCompleted: 0,
    tasksMoved: 0,
    projectsArchived: [],
    lessonsExtracted: [],
    patternsDetected: []
  }
}

function iso(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

function areaNameById(id: string): string {
  const a = listAreas().find((x) => x.id === id)
  return a ? `${a.emoji ? `${a.emoji} ` : ''}${a.name}` : id
}

function decisionTitleById(id: string): string {
  const d = listDecisions().find((x) => x.id === id)
  return d ? d.title : id
}

/** Builds the prompt per spec §6.4 review generation template. */
export function buildPrompt(period: ReviewPeriod, activity: ReviewActivity): string {
  const decisionsMadeList = activity.decisionsMade.map(decisionTitleById).join(', ') || 'none'
  const decisionsRevisitedList =
    activity.decisionsRevisited.map(decisionTitleById).join(', ') || 'none'
  const areasActiveList = activity.areasActive.map(areaNameById).join(', ') || 'none'
  const areasNeglectedList = activity.areasNeglected.map(areaNameById).join(', ') || 'none'

  return [
    `You are writing a ${period === 'week' ? 'weekly' : 'monthly'} review for the user. Read the activity below and produce a markdown review.`,
    '',
    `Activity (range: ${iso(activity.rangeStart)} to ${iso(activity.rangeEnd)}):`,
    `- Captures processed: ${activity.capturesProcessed}`,
    `- Tasks completed: ${activity.tasksCompleted}`,
    `- Tasks moved/replanned: ${activity.tasksMoved}`,
    `- Projects archived: ${activity.projectsArchived.join(', ') || 'none'}`,
    `- Decisions logged: ${decisionsMadeList}`,
    `- Decisions revisited: ${decisionsRevisitedList}`,
    `- Areas active (sorted): ${areasActiveList}`,
    `- Areas neglected: ${areasNeglectedList}`,
    `- Memory deltas: none captured in v0.3.0`,
    '',
    'Output sections (markdown headings, no frontmatter):',
    '1. Highlights — 2-3 sentences summarizing the period',
    '2. Decisions — what was decided + revisited',
    '3. Active Areas — what got attention',
    '4. Neglected Areas — what didn\'t (gentle observation, not judgment)',
    '5. Tasks — completion summary',
    '6. Open Threads — what\'s still unresolved',
    `7. Suggested Focus Next ${period === 'week' ? 'Week' : 'Month'} — 2-3 specific suggestions`,
    '',
    'Tone: matter-of-fact, observational, supportive. Not motivational. Not preachy.',
    `Length: ${period === 'week' ? '300-500' : '600-1000'} words.`
  ].join('\n')
}

/** Generates a review for the window. Uses Haiku for cost control. */
export async function generateReview(
  period: ReviewPeriod,
  rangeStart: number,
  rangeEnd: number
): Promise<GeneratedReview> {
  const activity = collectActivity(rangeStart, rangeEnd)
  const prompt = buildPrompt(period, activity)
  const res = await llmCompletion({
    messages: [{ role: 'user', content: prompt }],
    model: 'claude-haiku-4-5-20251001',
    max_tokens: period === 'week' ? 1400 : 2400
  })
  return { content: res.content.trim(), highlights: activity }
}
