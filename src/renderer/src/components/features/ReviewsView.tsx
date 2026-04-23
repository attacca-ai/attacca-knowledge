import { useEffect, useMemo, useState } from 'react'
import { FileText, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useReviewStore, type Review } from '@/stores/review-store'
import { ReviewReader } from './reviews/ReviewReader'

export function ReviewsView(): React.JSX.Element {
  const reviews = useReviewStore((s) => s.reviews)
  const loading = useReviewStore((s) => s.loading)
  const generating = useReviewStore((s) => s.generating)
  const error = useReviewStore((s) => s.error)
  const hydrate = useReviewStore((s) => s.hydrate)
  const generate = useReviewStore((s) => s.generate)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'week' | 'month'>('all')

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  const filtered = useMemo(
    () => (filter === 'all' ? reviews : reviews.filter((r) => r.period === filter)),
    [reviews, filter]
  )
  const selected = selectedId ? reviews.find((r) => r.id === selectedId) : null

  if (selected) {
    return <ReviewReader review={selected} onBack={() => setSelectedId(null)} />
  }

  async function handleGenerate(period: 'week' | 'month'): Promise<void> {
    const r = await generate(period)
    if (r) setSelectedId(r.id)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-att-divider px-6 py-4">
        <div>
          <h1 className="text-[18px] font-light text-foreground">Reviews</h1>
          <p className="text-[11.5px] text-muted-foreground/70">
            Weekly (Friday 4pm) and monthly (last day 5pm) reviews, auto-generated. Each review
            links to captures, decisions, and tasks it summarizes.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void handleGenerate('week')}
            disabled={generating}
          >
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            {generating ? 'Generating…' : 'Run weekly now'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void handleGenerate('month')}
            disabled={generating}
          >
            <Sparkles className="mr-1 h-3.5 w-3.5" />
            Run monthly now
          </Button>
        </div>
      </header>

      <div className="flex items-center gap-2 border-b border-att-divider px-6 py-2 text-[12px]">
        {(['all', 'week', 'month'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 ${
              filter === f
                ? 'bg-att-blue/15 text-att-blue'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {f === 'all' ? 'All' : f === 'week' ? 'Weekly' : 'Monthly'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading && <div className="text-[12px] text-muted-foreground">Loading reviews…</div>}
        {error && <div className="text-[12px] text-att-red">{error}</div>}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-att-divider p-10 text-center">
            <div className="text-[14px] text-foreground">No reviews yet.</div>
            <div className="max-w-[360px] text-[12px] text-muted-foreground">
              Weekly reviews run Friday 4pm local; monthly reviews run on the last day of the
              month. You can also trigger one manually above.
            </div>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="flex flex-col gap-2">
            {filtered.map((r) => (
              <ReviewRow key={r.id} review={r} onOpen={setSelectedId} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ReviewRow({
  review,
  onOpen
}: {
  review: Review
  onOpen: (id: string) => void
}): React.JSX.Element {
  const firstParagraph =
    review.content
      .split(/\n\n+/)
      .find((p) => p.trim().length > 0 && !/^#/.test(p.trim()))
      ?.trim() ?? ''
  return (
    <button
      onClick={() => onOpen(review.id)}
      className={cn(
        'flex items-start gap-3 rounded-lg border border-att-divider bg-att-surface p-4 text-left transition-colors',
        'hover:border-att-blue/40 hover:bg-att-surface-hover',
        !review.acknowledged && 'border-att-blue/40'
      )}
    >
      <div className="mt-[2px] shrink-0 rounded-md bg-att-blue/10 p-2 text-att-blue">
        <FileText className="h-4 w-4" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <div className="text-[13.5px] font-medium text-foreground">
            {review.period === 'week' ? 'Weekly review' : 'Monthly review'} ·{' '}
            {new Date(review.generatedAt).toISOString().slice(0, 10)}
          </div>
          {!review.acknowledged && (
            <span className="rounded-full bg-att-blue/15 px-2 py-[2px] font-mono text-[10px] text-att-blue">
              new
            </span>
          )}
        </div>
        <div className="mt-1 line-clamp-2 text-[12px] text-muted-foreground">
          {firstParagraph}
        </div>
        <div className="mt-2 flex gap-4 font-mono text-[10.5px] text-muted-foreground/70">
          <span>{review.highlights.capturesProcessed} captures</span>
          <span>{review.highlights.decisionsMade.length} decisions</span>
          <span>{review.highlights.decisionsRevisited.length} revisited</span>
          <span>{review.highlights.areasActive.length} active areas</span>
        </div>
      </div>
    </button>
  )
}
