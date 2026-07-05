/**
 * Local-date helpers. `Date.toISOString()` renders the UTC day, which is
 * wrong for anything user-facing or filed by calendar day (daily logs,
 * inbox folders, synthesis run dates) — an evening capture west of UTC
 * would land in "tomorrow". Always derive date strings from local parts.
 */

/** YYYY-MM-DD in the machine's local timezone. */
export function localDateStr(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
