import { useState } from 'react'
import { ChevronLeft, Archive, Pencil, Save } from 'lucide-react'
import { useAreaStore } from '@/stores/area-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Area } from '@/stores/area-store'

interface AreaDetailProps {
  area: Area
  onBack: () => void
}

export function AreaDetail({ area, onBack }: AreaDetailProps): React.JSX.Element {
  const update = useAreaStore((s) => s.update)
  const archive = useAreaStore((s) => s.archive)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(area.name)
  const [description, setDescription] = useState(area.description)
  const [emoji, setEmoji] = useState(area.emoji ?? '')
  const [cadence, setCadence] = useState<'weekly' | 'monthly'>(area.reviewCadence)
  const [saving, setSaving] = useState(false)

  async function handleSave(): Promise<void> {
    setSaving(true)
    await update(area.id, { name, description, emoji, reviewCadence: cadence })
    setSaving(false)
    setEditing(false)
  }

  async function handleArchive(): Promise<void> {
    if (!confirm(`Archive area "${area.name}"? File stays in vault.`)) return
    await archive(area.id)
    onBack()
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <button
        onClick={onBack}
        className="flex items-center gap-1 self-start text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        All areas
      </button>

      <div className="flex items-start gap-3">
        <span className="text-[32px] leading-none">{area.emoji ?? '📁'}</span>
        <div className="flex-1">
          {editing ? (
            <div className="flex flex-col gap-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
              <Input
                value={emoji}
                onChange={(e) => setEmoji(e.target.value)}
                placeholder="Emoji (optional)"
                maxLength={4}
              />
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description"
                rows={3}
                className="rounded-md border border-att-divider bg-att-surface-hover p-2 text-[12px] text-foreground outline-none focus:border-att-blue"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setCadence('weekly')}
                  className={`rounded px-2 py-1 text-[11px] ${cadence === 'weekly' ? 'bg-att-blue/20 text-att-blue' : 'bg-muted text-muted-foreground'}`}
                >
                  Weekly
                </button>
                <button
                  onClick={() => setCadence('monthly')}
                  className={`rounded px-2 py-1 text-[11px] ${cadence === 'monthly' ? 'bg-att-blue/20 text-att-blue' : 'bg-muted text-muted-foreground'}`}
                >
                  Monthly
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="text-[20px] font-light text-foreground">{area.name}</div>
              <div className="text-[12px] text-muted-foreground">
                {area.description || 'No description yet.'}
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/60">
                {area.reviewCadence} review · vault: {area.vaultPath}
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2">
          {editing ? (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <Save className="mr-1 h-3 w-3" />
              Save
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil className="mr-1 h-3 w-3" />
                Edit
              </Button>
              <Button size="sm" variant="outline" onClick={handleArchive}>
                <Archive className="mr-1 h-3 w-3" />
                Archive
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 pt-4">
        <div className="rounded-md border border-att-divider bg-att-surface p-3">
          <div className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground/60">
            Projects
          </div>
          <div className="text-[20px] font-light">{area.projectIds.length}</div>
          <div className="text-[11px] text-muted-foreground/60">Linked to this area</div>
        </div>
        <div className="rounded-md border border-att-divider bg-att-surface p-3">
          <div className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground/60">
            Health
          </div>
          <div className="text-[20px] font-light">{area.healthScore ?? '—'}</div>
          <div className="text-[11px] text-muted-foreground/60">
            {area.healthScore === undefined ? 'Computing…' : 'Updated daily'}
          </div>
        </div>
      </div>

      <div className="pt-2 text-[11px] text-muted-foreground/60">
        Captures, decisions, and reviews for this area will appear here once Phase 1 inbox triage
        wiring lands.
      </div>
    </div>
  )
}
