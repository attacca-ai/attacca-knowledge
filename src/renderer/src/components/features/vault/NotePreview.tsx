interface NotePreviewProps {
  frontmatter: Record<string, unknown>
  body: string
}

/** Lightweight markdown preview — Phase 1 renders as pre-wrap text.
 * Rich rendering (headings, code fences, tables) can land later without
 * changing the view layout. */
export function NotePreview({ frontmatter, body }: NotePreviewProps): React.JSX.Element {
  const hasFm = Object.keys(frontmatter).length > 0
  return (
    <div className="flex flex-col gap-4">
      {hasFm && (
        <section>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Frontmatter
          </div>
          <pre className="overflow-auto rounded-md border border-att-divider bg-att-surface p-3 font-mono text-[11px] text-muted-foreground">
            {Object.entries(frontmatter)
              .map(([k, v]) =>
                typeof v === 'object' && v !== null
                  ? `${k}:\n${Object.entries(v as Record<string, unknown>)
                      .map(([sk, sv]) => `  ${sk}: ${formatScalar(sv)}`)
                      .join('\n')}`
                  : `${k}: ${formatScalar(v)}`
              )
              .join('\n')}
          </pre>
        </section>
      )}
      <section>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Body
        </div>
        <article className="whitespace-pre-wrap rounded-md border border-att-divider bg-att-surface p-4 text-[13px] leading-relaxed text-foreground">
          {body.trim() || '(empty note)'}
        </article>
      </section>
    </div>
  )
}

function formatScalar(v: unknown): string {
  if (Array.isArray(v)) return `[${v.join(', ')}]`
  if (typeof v === 'string') return v
  return String(v)
}
