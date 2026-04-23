import { useEffect, useState } from 'react'
import { ArrowLeft, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useReviewStore, type Review } from '@/stores/review-store'

interface ReviewReaderProps {
  review: Review
  onBack: () => void
}

export function ReviewReader({ review, onBack }: ReviewReaderProps): React.JSX.Element {
  const acknowledge = useReviewStore((s) => s.acknowledge)
  const addNotes = useReviewStore((s) => s.addNotes)
  const [notes, setNotes] = useState(review.userNotes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)

  useEffect(() => {
    setNotes(review.userNotes ?? '')
  }, [review.id, review.userNotes])

  async function saveNotes(): Promise<void> {
    setSavingNotes(true)
    await addNotes(review.id, notes)
    setSavingNotes(false)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-att-divider px-6 py-4">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />
          Back
        </Button>
        <div className="flex-1">
          <h1 className="text-[18px] font-light text-foreground">
            {review.period === 'week' ? 'Weekly review' : 'Monthly review'} ·{' '}
            {new Date(review.generatedAt).toISOString().slice(0, 10)}
          </h1>
          <p className="text-[11.5px] text-muted-foreground/70">
            {new Date(review.rangeStart).toISOString().slice(0, 10)} →{' '}
            {new Date(review.rangeEnd).toISOString().slice(0, 10)} · {review.highlights.capturesProcessed}{' '}
            captures · {review.highlights.decisionsMade.length} decisions made ·{' '}
            {review.highlights.decisionsRevisited.length} revisited
          </p>
        </div>
        {!review.acknowledged ? (
          <Button size="sm" variant="ghost" onClick={() => void acknowledge(review.id)}>
            <Check className="mr-1 h-3.5 w-3.5" />
            Mark read
          </Button>
        ) : (
          <span className="font-mono text-[10px] text-att-green">Read</span>
        )}
      </header>

      <div className="flex-1 overflow-auto p-6">
        <article className="prose prose-sm max-w-none whitespace-pre-wrap text-[13px] text-foreground">
          {review.content}
        </article>

        <section className="mt-8">
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
            Your notes
          </div>
          <textarea
            className="min-h-[100px] w-full resize-y rounded-md border border-att-divider bg-background p-2 text-[12px] text-foreground outline-none focus:border-att-blue/60"
            placeholder="Follow-ups, reactions, anything the review missed…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <div className="mt-2 flex justify-end">
            <Button size="sm" onClick={saveNotes} disabled={savingNotes}>
              {savingNotes ? 'Saving…' : 'Save notes'}
            </Button>
          </div>
        </section>
      </div>
    </div>
  )
}
