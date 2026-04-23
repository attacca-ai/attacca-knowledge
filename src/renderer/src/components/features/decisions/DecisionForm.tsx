import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useDecisionStore, type DecisionCreateInput } from '@/stores/decision-store'
import { useAreaStore } from '@/stores/area-store'

interface DecisionFormProps {
  onCancel: () => void
  onSaved?: (id: string) => void
}

/** Capture-flow form per spec §6.3: title, context, options, chosen,
 * reasoning, expected outcome, revisit interval. */
export function DecisionForm({ onCancel, onSaved }: DecisionFormProps): React.JSX.Element {
  const areas = useAreaStore((s) => s.areas)
  const create = useDecisionStore((s) => s.create)

  const [title, setTitle] = useState('')
  const [context, setContext] = useState('')
  const [optionsRaw, setOptionsRaw] = useState('')
  const [chosen, setChosen] = useState('')
  const [reasoning, setReasoning] = useState('')
  const [expected, setExpected] = useState('')
  const [revisitInDays, setRevisitInDays] = useState<number>(60)
  const [customDays, setCustomDays] = useState<string>('')
  const [areaId, setAreaId] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const presetDays = [30, 60, 90]

  async function save(): Promise<void> {
    if (!title.trim() || !chosen.trim()) {
      setErr('Title and chosen option are required.')
      return
    }
    const days =
      revisitInDays === -1
        ? Math.max(1, parseInt(customDays || '60', 10) || 60)
        : revisitInDays
    const input: DecisionCreateInput = {
      title: title.trim(),
      context: context.trim(),
      options: optionsRaw
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
      chosen: chosen.trim(),
      reasoning: reasoning.trim(),
      expectedOutcome: expected.trim(),
      revisitInDays: days,
      areaId: areaId || undefined
    }
    setSaving(true)
    setErr(null)
    const created = await create(input)
    setSaving(false)
    if (created) onSaved?.(created.id)
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-att-divider bg-att-surface p-4">
      <div className="text-[13px] font-medium text-foreground">New decision</div>

      <Input
        placeholder="Title (e.g. Switch to Anthropic-only)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <div>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Context
        </div>
        <textarea
          className="min-h-[70px] w-full resize-y rounded-md border border-att-divider bg-background p-2 text-[12px] text-foreground outline-none focus:border-att-blue/60"
          placeholder="What's the situation? What made this a decision point?"
          value={context}
          onChange={(e) => setContext(e.target.value)}
        />
      </div>

      <div>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Options considered (one per line)
        </div>
        <textarea
          className="min-h-[60px] w-full resize-y rounded-md border border-att-divider bg-background p-2 text-[12px] text-foreground outline-none focus:border-att-blue/60"
          placeholder="Option A&#10;Option B&#10;Option C"
          value={optionsRaw}
          onChange={(e) => setOptionsRaw(e.target.value)}
        />
      </div>

      <Input
        placeholder="Chosen option"
        value={chosen}
        onChange={(e) => setChosen(e.target.value)}
      />

      <div>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Reasoning
        </div>
        <textarea
          className="min-h-[60px] w-full resize-y rounded-md border border-att-divider bg-background p-2 text-[12px] text-foreground outline-none focus:border-att-blue/60"
          placeholder="Why this option won"
          value={reasoning}
          onChange={(e) => setReasoning(e.target.value)}
        />
      </div>

      <div>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Expected outcome
        </div>
        <textarea
          className="min-h-[50px] w-full resize-y rounded-md border border-att-divider bg-background p-2 text-[12px] text-foreground outline-none focus:border-att-blue/60"
          placeholder="What you predict will happen"
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Revisit in
        </span>
        {presetDays.map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setRevisitInDays(d)}
            className={`rounded-full border px-3 py-[3px] font-mono text-[11px] ${
              revisitInDays === d
                ? 'border-att-blue bg-att-blue/15 text-att-blue'
                : 'border-att-divider text-muted-foreground hover:border-att-blue/40'
            }`}
          >
            {d}d
          </button>
        ))}
        <button
          type="button"
          onClick={() => setRevisitInDays(-1)}
          className={`rounded-full border px-3 py-[3px] font-mono text-[11px] ${
            revisitInDays === -1
              ? 'border-att-blue bg-att-blue/15 text-att-blue'
              : 'border-att-divider text-muted-foreground hover:border-att-blue/40'
          }`}
        >
          custom
        </button>
        {revisitInDays === -1 && (
          <Input
            className="h-7 w-24"
            type="number"
            min={1}
            placeholder="days"
            value={customDays}
            onChange={(e) => setCustomDays(e.target.value)}
          />
        )}
      </div>

      {areas.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Area (optional)
          </span>
          <select
            className="rounded-md border border-att-divider bg-background px-2 py-1 text-[12px]"
            value={areaId}
            onChange={(e) => setAreaId(e.target.value)}
          >
            <option value="">— none —</option>
            {areas
              .filter((a) => !a.archived)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.emoji ? `${a.emoji} ` : ''}
                  {a.name}
                </option>
              ))}
          </select>
        </div>
      )}

      {err && <div className="text-[12px] text-att-red">{err}</div>}

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={save} disabled={saving || !title.trim() || !chosen.trim()}>
          {saving ? 'Saving…' : 'Log decision'}
        </Button>
      </div>
    </div>
  )
}
