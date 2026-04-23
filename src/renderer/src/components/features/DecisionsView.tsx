import { useEffect, useMemo, useState } from 'react'
import { Plus, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDecisionStore } from '@/stores/decision-store'
import { useAreaStore } from '@/stores/area-store'
import { DecisionCard } from './decisions/DecisionCard'
import { DecisionForm } from './decisions/DecisionForm'
import { RetrospectiveForm } from './decisions/RetrospectiveForm'

type Tab = 'ledger' | 'revisit'

export function DecisionsView(): React.JSX.Element {
  const decisions = useDecisionStore((s) => s.decisions)
  const revisitQueue = useDecisionStore((s) => s.revisitQueue)
  const loading = useDecisionStore((s) => s.loading)
  const error = useDecisionStore((s) => s.error)
  const hydrate = useDecisionStore((s) => s.hydrate)
  const revisitNow = useDecisionStore((s) => s.revisitNow)
  const hydrateAreas = useAreaStore((s) => s.hydrate)

  const [tab, setTab] = useState<Tab>('ledger')
  const [showForm, setShowForm] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [retroFor, setRetroFor] = useState<string | null>(null)

  useEffect(() => {
    void hydrate()
    void hydrateAreas()
  }, [hydrate, hydrateAreas])

  const selected = useMemo(
    () => decisions.find((d) => d.id === selectedId) ?? null,
    [decisions, selectedId]
  )

  // Detail view
  if (selected) {
    const retroTarget = retroFor === selected.id ? selected : null
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <header className="flex items-center gap-2 border-b border-att-divider px-6 py-4">
          <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" />
            Back
          </Button>
          <div className="flex-1">
            <h1 className="text-[18px] font-light text-foreground">{selected.title}</h1>
            <p className="text-[11.5px] text-muted-foreground/70">
              {new Date(selected.createdAt).toISOString().slice(0, 10)} · {selected.status}
            </p>
          </div>
          {selected.status === 'active' && !selected.retrospective && (
            <Button size="sm" onClick={() => setRetroFor(selected.id)}>
              Add retrospective
            </Button>
          )}
          {selected.status === 'active' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void revisitNow(selected.id)}
              title="Force this decision into the revisit queue now"
            >
              Revisit now
            </Button>
          )}
        </header>

        <div className="flex-1 overflow-auto p-6">
          <DetailSection label="Context" text={selected.context} />
          {selected.options.length > 0 && (
            <section className="mb-5">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
                Options considered
              </div>
              <ul className="list-disc pl-5 text-[12.5px] text-foreground">
                {selected.options.map((o, i) => (
                  <li key={i}>{o}</li>
                ))}
              </ul>
            </section>
          )}
          <DetailSection label="Chosen" text={selected.chosen} />
          <DetailSection label="Reasoning" text={selected.reasoning} />
          <DetailSection label="Expected outcome" text={selected.expectedOutcome} />

          <section className="mb-5">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Revisit
            </div>
            <div className="text-[12.5px] text-foreground">
              {selected.revisitAt
                ? new Date(selected.revisitAt).toISOString().slice(0, 10)
                : '(none set)'}
            </div>
          </section>

          {selected.retrospective && (
            <section className="mb-5 rounded-lg border border-att-green/30 bg-att-green/5 p-4">
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-att-green">
                Retrospective ·{' '}
                {new Date(selected.retrospective.revisitedAt).toISOString().slice(0, 10)}
              </div>
              <div className="mb-2 text-[12px]">
                <span className="text-muted-foreground">Matched expectation: </span>
                <span className="text-foreground">
                  {selected.retrospective.didMatch === 'partly'
                    ? 'partly'
                    : selected.retrospective.didMatch
                      ? 'yes'
                      : 'no'}
                </span>
              </div>
              <div className="mb-2 text-[12px]">
                <span className="text-muted-foreground">Actual outcome: </span>
                <span className="text-foreground">
                  {selected.retrospective.actualOutcome}
                </span>
              </div>
              {selected.retrospective.lessons && (
                <div className="text-[12px]">
                  <span className="text-muted-foreground">Lessons: </span>
                  <span className="text-foreground">{selected.retrospective.lessons}</span>
                </div>
              )}
            </section>
          )}

          {retroTarget && (
            <div className="mt-4">
              <RetrospectiveForm
                decision={retroTarget}
                onCancel={() => setRetroFor(null)}
                onSaved={() => setRetroFor(null)}
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  const activeDecisions = decisions.filter((d) => d.status === 'active')
  const archivedDecisions = decisions.filter((d) => d.status !== 'active')

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-att-divider px-6 py-4">
        <div>
          <h1 className="text-[18px] font-light text-foreground">Decisions</h1>
          <p className="text-[11.5px] text-muted-foreground/70">
            Ledger + revisit queue. Log context, options, chosen path, expected outcome; the agent
            surfaces it when the revisit date arrives.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {showForm ? 'Cancel' : 'New decision'}
        </Button>
      </header>

      <div className="flex items-center gap-4 border-b border-att-divider px-6 text-[12px]">
        <TabButton
          active={tab === 'ledger'}
          label={`Ledger (${activeDecisions.length})`}
          onClick={() => setTab('ledger')}
        />
        <TabButton
          active={tab === 'revisit'}
          label={`Revisit queue (${revisitQueue.length})`}
          onClick={() => setTab('revisit')}
        />
      </div>

      <div className="flex-1 overflow-auto p-6">
        {showForm && (
          <div className="mb-6">
            <DecisionForm
              onCancel={() => setShowForm(false)}
              onSaved={() => {
                setShowForm(false)
              }}
            />
          </div>
        )}

        {loading && <div className="text-[12px] text-muted-foreground">Loading decisions…</div>}
        {error && <div className="text-[12px] text-att-red">{error}</div>}

        {tab === 'ledger' && !loading && activeDecisions.length === 0 && !showForm && (
          <EmptyState
            title="No decisions yet."
            hint="Log the choices worth revisiting — context, options, why you picked what you picked, and what you expect."
            onCreate={() => setShowForm(true)}
          />
        )}

        {tab === 'ledger' && activeDecisions.length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {activeDecisions.map((d) => (
              <DecisionCard key={d.id} decision={d} onOpen={setSelectedId} highlightDue />
            ))}
          </div>
        )}

        {tab === 'ledger' && archivedDecisions.length > 0 && (
          <div className="mt-8">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/60">
              Revisited / superseded
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {archivedDecisions.map((d) => (
                <DecisionCard key={d.id} decision={d} onOpen={setSelectedId} />
              ))}
            </div>
          </div>
        )}

        {tab === 'revisit' && revisitQueue.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-att-divider p-10 text-center">
            <div className="text-[14px] text-foreground">Nothing to revisit.</div>
            <div className="max-w-[360px] text-[12px] text-muted-foreground">
              Active decisions surface here when their revisit date arrives. The scheduler scans
              daily at 8am local.
            </div>
          </div>
        )}

        {tab === 'revisit' && revisitQueue.length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {revisitQueue.map((d) => (
              <DecisionCard key={d.id} decision={d} onOpen={setSelectedId} highlightDue />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DetailSection({ label, text }: { label: string; text: string }): React.JSX.Element | null {
  if (!text) return null
  return (
    <section className="mb-5">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {label}
      </div>
      <div className="whitespace-pre-wrap text-[12.5px] text-foreground">{text}</div>
    </section>
  )
}

function TabButton({
  active,
  label,
  onClick
}: {
  active: boolean
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`border-b-2 py-3 transition-colors ${
        active
          ? 'border-att-blue text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  )
}

function EmptyState({
  title,
  hint,
  onCreate
}: {
  title: string
  hint: string
  onCreate: () => void
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-att-divider p-10 text-center">
      <div className="text-[14px] text-foreground">{title}</div>
      <div className="max-w-[360px] text-[12px] text-muted-foreground">{hint}</div>
      <Button size="sm" onClick={onCreate}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        Log a decision
      </Button>
    </div>
  )
}
