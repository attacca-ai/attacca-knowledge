import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useDecisionStore, type Decision, type DecisionRetroInput } from '@/stores/decision-store'

interface RetrospectiveFormProps {
  decision: Decision
  onCancel: () => void
  onSaved?: () => void
}

/** Retrospective capture (spec §6.3 revisit flow). */
export function RetrospectiveForm({
  decision,
  onCancel,
  onSaved
}: RetrospectiveFormProps): React.JSX.Element {
  const complete = useDecisionStore((s) => s.complete)

  const [actual, setActual] = useState('')
  const [didMatch, setDidMatch] = useState<boolean | 'partly'>('partly')
  const [lessons, setLessons] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save(): Promise<void> {
    if (!actual.trim()) {
      setErr('What actually happened is required.')
      return
    }
    const retro: DecisionRetroInput = {
      actualOutcome: actual.trim(),
      didMatch,
      lessons: lessons.trim()
    }
    setSaving(true)
    setErr(null)
    const res = await complete(decision.id, retro)
    setSaving(false)
    if (res) onSaved?.()
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-att-divider bg-att-surface p-4">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-medium text-foreground">Retrospective</div>
        <div className="text-[11px] text-muted-foreground/70">{decision.title}</div>
      </div>

      <div className="rounded-md bg-background/60 p-3 text-[11.5px] text-muted-foreground">
        <div className="mb-1">
          <span className="text-foreground">Expected:</span>{' '}
          {decision.expectedOutcome || '(not captured)'}
        </div>
        <div>
          <span className="text-foreground">Chosen:</span> {decision.chosen}
        </div>
      </div>

      <div>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
          What actually happened
        </div>
        <textarea
          className="min-h-[70px] w-full resize-y rounded-md border border-att-divider bg-background p-2 text-[12px] text-foreground outline-none focus:border-att-blue/60"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Matched expectation?
        </span>
        {[
          { v: true, label: 'yes' },
          { v: 'partly' as const, label: 'partly' },
          { v: false, label: 'no' }
        ].map(({ v, label }) => (
          <button
            key={label}
            type="button"
            onClick={() => setDidMatch(v)}
            className={`rounded-full border px-3 py-[3px] font-mono text-[11px] ${
              didMatch === v
                ? 'border-att-blue bg-att-blue/15 text-att-blue'
                : 'border-att-divider text-muted-foreground hover:border-att-blue/40'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Lessons (free-form)
        </div>
        <textarea
          className="min-h-[60px] w-full resize-y rounded-md border border-att-divider bg-background p-2 text-[12px] text-foreground outline-none focus:border-att-blue/60"
          placeholder="What would you tell yourself next time?"
          value={lessons}
          onChange={(e) => setLessons(e.target.value)}
        />
      </div>

      {err && <div className="text-[12px] text-att-red">{err}</div>}

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={saving || !actual.trim()}>
          {saving ? 'Saving…' : 'Save retrospective'}
        </Button>
      </div>
    </div>
  )
}
