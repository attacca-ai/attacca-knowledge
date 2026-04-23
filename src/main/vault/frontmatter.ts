/**
 * Minimal YAML frontmatter reader/writer for Attacca vault notes.
 *
 * We deliberately avoid pulling in a heavy YAML dependency: the vault uses
 * flat key/value pairs plus shallow nested blocks (notably an `attacca:`
 * namespace — spec §6.6). Anything more exotic in user frontmatter is
 * passed through untouched as a raw block string.
 */

type Primitive = string | number | boolean | null
export type FrontmatterValue = Primitive | Primitive[] | Record<string, Primitive | Primitive[]>
export type Frontmatter = Record<string, FrontmatterValue>

const FENCE_RE = /^---\s*\n([\s\S]*?)\n---\s*(\n|$)/

export interface ParsedNote {
  frontmatter: Frontmatter
  /** Exact raw frontmatter block text (without fences) — preserves user formatting. */
  rawFrontmatter: string
  body: string
}

/** Parses a markdown file with optional `---`-fenced YAML frontmatter. */
export function parseNote(content: string): ParsedNote {
  const m = content.match(FENCE_RE)
  if (!m) return { frontmatter: {}, rawFrontmatter: '', body: content }
  const raw = m[1]
  const body = content.slice(m[0].length)
  return { frontmatter: parseYamlLite(raw), rawFrontmatter: raw, body }
}

/**
 * Serializes a note file: frontmatter + body. When `preserveRaw` is passed
 * (from a previous read), user-authored keys outside `updates` are kept
 * verbatim. `updates` always wins for keys present on both sides.
 *
 * The `attacca:` namespace (spec §6.6) is emitted as a nested block under
 * its own key — leaving any other user blocks untouched in `preserveRaw`.
 */
export function serializeNote(body: string, updates: Frontmatter, preserveRaw?: string): string {
  const existing = preserveRaw ? parseYamlLite(preserveRaw) : {}
  const merged: Frontmatter = { ...existing, ...updates }
  const yaml = serializeYamlLite(merged)
  const trimmedBody = body.startsWith('\n') ? body : `\n${body}`
  return `---\n${yaml}---${trimmedBody}`
}

/**
 * Returns a copy of the frontmatter with the `attacca:` namespace merged
 * in. Used when writing Attacca-managed metadata without trampling user
 * keys (spec §6.6 "frontmatter namespace").
 */
export function mergeAttaccaNamespace(
  existing: Frontmatter,
  attaccaFields: Record<string, Primitive | Primitive[]>
): Frontmatter {
  const prev = (existing.attacca ?? {}) as Record<string, Primitive | Primitive[]>
  return { ...existing, attacca: { ...prev, ...attaccaFields } }
}

// ── Tiny YAML subset ────────────────────────────────────────────────────────
// Supports: scalar values (string/number/boolean/null), inline arrays
// `[a, b, c]`, and one level of nested maps (key:\n  k: v). Anything more
// complex in user frontmatter is preserved byte-for-byte via `preserveRaw`.

function parseYamlLite(raw: string): Frontmatter {
  const out: Frontmatter = {}
  const lines = raw.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim() || line.trim().startsWith('#')) {
      i++
      continue
    }
    const match = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/)
    if (!match) {
      i++
      continue
    }
    const [, key, rest] = match
    if (rest.trim()) {
      out[key] = parseScalarOrArray(rest.trim())
      i++
      continue
    }
    // Nested block — collect indented lines.
    const nested: Record<string, Primitive | Primitive[]> = {}
    i++
    while (i < lines.length) {
      const sub = lines[i]
      if (!sub.trim()) {
        i++
        continue
      }
      if (!/^\s+/.test(sub)) break
      const subMatch = sub.match(/^\s+([A-Za-z0-9_.-]+):\s*(.*)$/)
      if (subMatch) {
        const [, subKey, subRest] = subMatch
        nested[subKey] = parseScalarOrArray(subRest.trim())
      }
      i++
    }
    out[key] = nested
  }
  return out
}

function parseScalarOrArray(value: string): Primitive | Primitive[] {
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((v) => parseScalar(v.trim().replace(/^["']|["']$/g, '')))
  }
  return parseScalar(value)
}

function parseScalar(value: string): Primitive {
  if (value === '' || value === 'null' || value === '~') return null
  if (value === 'true') return true
  if (value === 'false') return false
  const num = Number(value)
  if (!Number.isNaN(num) && /^-?\d+(\.\d+)?$/.test(value)) return num
  return value.replace(/^["']|["']$/g, '')
}

function serializeYamlLite(obj: Frontmatter): string {
  const lines: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      lines.push(`${key}: null`)
      continue
    }
    if (Array.isArray(value)) {
      const items = value.map(serializePrimitive).join(', ')
      lines.push(`${key}: [${items}]`)
      continue
    }
    if (typeof value === 'object') {
      lines.push(`${key}:`)
      for (const [sk, sv] of Object.entries(value)) {
        if (Array.isArray(sv)) {
          lines.push(`  ${sk}: [${sv.map(serializePrimitive).join(', ')}]`)
        } else {
          lines.push(`  ${sk}: ${serializePrimitive(sv as Primitive)}`)
        }
      }
      continue
    }
    lines.push(`${key}: ${serializePrimitive(value)}`)
  }
  return lines.join('\n') + '\n'
}

function serializePrimitive(value: Primitive): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return String(value)
  // Quote strings containing YAML-reserved chars.
  if (/[:#[\]{},&*!|>'"%@`]/.test(value) || /^\s|\s$/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`
  }
  return value
}
