import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAreaStore } from '@/stores/area-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AreaCard } from './areas/AreaCard'
import { AreaDetail } from './areas/AreaDetail'

type Mode = 'grid' | 'create'

export function AreasView(): React.JSX.Element {
  const areas = useAreaStore((s) => s.areas)
  const loading = useAreaStore((s) => s.loading)
  const error = useAreaStore((s) => s.error)
  const hydrate = useAreaStore((s) => s.hydrate)
  const create = useAreaStore((s) => s.create)

  const [mode, setMode] = useState<Mode>('grid')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newEmoji, setNewEmoji] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  const active = useMemo(() => areas.filter((a) => !a.archived), [areas])
  const archived = useMemo(() => areas.filter((a) => a.archived), [areas])

  const selected = selectedId ? areas.find((a) => a.id === selectedId) : null
  if (selected) {
    return <AreaDetail area={selected} onBack={() => setSelectedId(null)} />
  }

  async function handleCreate(): Promise<void> {
    if (!newName.trim()) return
    setSaving(true)
    const created = await create({
      name: newName.trim(),
      description: newDesc.trim() || undefined,
      emoji: newEmoji.trim() || undefined
    })
    setSaving(false)
    if (created) {
      setNewName('')
      setNewDesc('')
      setNewEmoji('')
      setMode('grid')
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-att-divider px-6 py-4">
        <div>
          <h1 className="text-[18px] font-light text-foreground">Areas</h1>
          <p className="text-[11.5px] text-muted-foreground/70">
            Life domains you want to keep active. The agent uses these to route captures, run
            reviews, and detect patterns.
          </p>
        </div>
        <Button size="sm" onClick={() => setMode(mode === 'create' ? 'grid' : 'create')}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {mode === 'create' ? 'Cancel' : 'New area'}
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {mode === 'create' && (
          <div className="mb-6 flex flex-col gap-2 rounded-lg border border-att-divider bg-att-surface p-4">
            <div className="text-[13px] font-medium text-foreground">New area</div>
            <Input
              placeholder="Name (e.g. Running)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Input
              placeholder="Emoji (optional)"
              value={newEmoji}
              onChange={(e) => setNewEmoji(e.target.value)}
              maxLength={4}
            />
            <Input
              placeholder="Short description"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={handleCreate} disabled={!newName.trim() || saving}>
                {saving ? 'Saving…' : 'Create area'}
              </Button>
            </div>
          </div>
        )}

        {loading && <div className="text-[12px] text-muted-foreground">Loading areas…</div>}
        {error && <div className="text-[12px] text-att-red">{error}</div>}

        {!loading && active.length === 0 && mode !== 'create' && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-att-divider p-10 text-center">
            <div className="text-[14px] text-foreground">No areas yet.</div>
            <div className="max-w-[360px] text-[12px] text-muted-foreground">
              Areas are durable life domains (Health, Career, Finance…). They appear in reviews and
              frame how the agent routes your captures.
            </div>
            <Button size="sm" onClick={() => setMode('create')}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              Create your first area
            </Button>
          </div>
        )}

        {active.length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {active.map((area) => (
              <AreaCard key={area.id} area={area} onOpen={setSelectedId} />
            ))}
          </div>
        )}

        {archived.length > 0 && (
          <div className="mt-8">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/60">
              Archived
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {archived.map((area) => (
                <AreaCard key={area.id} area={area} onOpen={setSelectedId} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
