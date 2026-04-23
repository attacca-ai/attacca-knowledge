import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

interface NoteEditorProps {
  initialBody: string
  initialFrontmatter: Record<string, unknown>
  onSave: (body: string, frontmatter: Record<string, unknown>) => Promise<void>
  onCancel: () => void
}

/** Raw body/frontmatter editor. Frontmatter is edited as key:value
 * lines to avoid pulling in a YAML editor; we ship a simple parser that
 * mirrors what the main-process frontmatter writer accepts. */
export function NoteEditor({
  initialBody,
  initialFrontmatter,
  onSave,
  onCancel
}: NoteEditorProps): React.JSX.Element {
  const [body, setBody] = useState(initialBody)
  const [fmText, setFmText] = useState(serializeFrontmatter(initialFrontmatter))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setBody(initialBody)
    setFmText(serializeFrontmatter(initialFrontmatter))
  }, [initialBody, initialFrontmatter])

  async function save(): Promise<void> {
    let fm: Record<string, unknown>
    try {
      fm = parseFrontmatter(fmText)
    } catch (e) {
      setErr(`Frontmatter parse error: ${(e as Error).message}`)
      return
    }
    setSaving(true)
    setErr(null)
    try {
      await onSave(body, fm)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <section>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Frontmatter (key: value per line; indent 2 spaces for nested blocks)
        </div>
        <textarea
          className="min-h-[120px] w-full resize-y rounded-md border border-att-divider bg-background p-2 font-mono text-[11px] text-foreground outline-none focus:border-att-blue/60"
          value={fmText}
          onChange={(e) => setFmText(e.target.value)}
          spellCheck={false}
        />
      </section>
      <section>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Body
        </div>
        <textarea
          className="min-h-[320px] w-full resize-y rounded-md border border-att-divider bg-background p-3 text-[13px] leading-relaxed text-foreground outline-none focus:border-att-blue/60"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </section>

      {err && <div className="text-[12px] text-att-red">{err}</div>}

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

function serializeFrontmatter(fm: Record<string, unknown>): string {
  const lines: string[] = []
  for (const [k, v] of Object.entries(fm)) {
    if (v === null || v === undefined) {
      lines.push(`${k}: null`)
      continue
    }
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.join(', ')}]`)
      continue
    }
    if (typeof v === 'object') {
      lines.push(`${k}:`)
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
        if (Array.isArray(sv)) {
          lines.push(`  ${sk}: [${sv.join(', ')}]`)
        } else {
          lines.push(`  ${sk}: ${String(sv)}`)
        }
      }
      continue
    }
    lines.push(`${k}: ${String(v)}`)
  }
  return lines.join('\n')
}

function parseFrontmatter(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const lines = text.split(/\r?\n/)
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const m = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/)
    if (!m) {
      i++
      continue
    }
    const [, key, rest] = m
    if (rest.trim()) {
      out[key] = parseScalarOrArray(rest.trim())
      i++
      continue
    }
    // Nested block.
    const nested: Record<string, unknown> = {}
    i++
    while (i < lines.length && /^\s+/.test(lines[i])) {
      const subM = lines[i].match(/^\s+([A-Za-z0-9_.-]+):\s*(.*)$/)
      if (subM) nested[subM[1]] = parseScalarOrArray(subM[2].trim())
      i++
    }
    out[key] = nested
  }
  return out
}

function parseScalarOrArray(value: string): unknown {
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim()
    if (!inner) return []
    return inner.split(',').map((v) => parseScalar(v.trim()))
  }
  return parseScalar(value)
}

function parseScalar(v: string): unknown {
  if (v === '' || v === 'null' || v === '~') return null
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  return v.replace(/^["']|["']$/g, '')
}
