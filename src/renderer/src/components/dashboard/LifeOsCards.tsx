import { useMemo } from 'react'
import { Inbox, Flag, FileText, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useCaptureStore } from '@/stores/capture-store'
import { useDecisionStore } from '@/stores/decision-store'
import { useReviewStore } from '@/stores/review-store'
import type { SidebarView } from '@/components/layout/Sidebar'

/**
 * Today-view summary cards per spec §6.7:
 * - Triage queue (captures awaiting routing)
 * - Decisions due (revisit queue)
 * - Latest review (weekly/monthly)
 *
 * Clicks dispatch `attacca:navigate` so AppShell switches views.
 */
export function LifeOsCards(): React.JSX.Element {
  const captures = useCaptureStore((s) => s.rawCaptures)
  const revisitQueue = useDecisionStore((s) => s.revisitQueue)
  const reviews = useReviewStore((s) => s.reviews)

  const pendingCaptures = useMemo(
    () => captures.filter((c) => c.agentNote === null && !c.archived).length,
    [captures]
  )
  const dueDecisions = revisitQueue.length
  const latestReview = reviews[0] ?? null

  function nav(view: SidebarView): void {
    window.dispatchEvent(new CustomEvent('attacca:navigate', { detail: { view } }))
  }

  const firstParagraph = useMemo(() => {
    if (!latestReview) return ''
    const raw = latestReview.content
    return (
      raw
        .split(/\n\n+/)
        .find((p) => p.trim().length > 0 && !/^#/.test(p.trim()))
        ?.trim() ?? ''
    )
  }, [latestReview])

  return (
    <div className="mb-6">
      <p className="mb-3 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
        Life OS · today
      </p>
      <div className="grid grid-cols-1 gap-[10px] md:grid-cols-3">
        <Card
          icon={<Inbox className="h-4 w-4 text-att-blue" />}
          label="Triage queue"
          primary={pendingCaptures > 0 ? `${pendingCaptures} waiting` : 'Inbox clear'}
          desc={
            pendingCaptures > 0
              ? 'Captures pending routing to an area, project, or decision.'
              : 'All captures processed.'
          }
          onClick={() => nav('inbox')}
          tone={pendingCaptures > 0 ? 'active' : 'quiet'}
        />
        <Card
          icon={<Flag className="h-4 w-4 text-att-orange" />}
          label="Decisions due"
          primary={dueDecisions > 0 ? `${dueDecisions} to revisit` : 'Nothing due'}
          desc={
            dueDecisions > 0
              ? 'Revisit dates reached — add a retrospective.'
              : 'Next scan runs at 8am local.'
          }
          onClick={() => nav('decisions')}
          tone={dueDecisions > 0 ? 'alert' : 'quiet'}
        />
        <Card
          icon={<FileText className="h-4 w-4 text-att-blue" />}
          label="Latest review"
          primary={
            latestReview
              ? `${latestReview.period === 'week' ? 'Weekly' : 'Monthly'} · ${new Date(
                  latestReview.generatedAt
                )
                  .toISOString()
                  .slice(0, 10)}`
              : 'No reviews yet'
          }
          desc={
            latestReview
              ? firstParagraph || 'Open for full review.'
              : 'Weekly runs Friday 4pm; monthly on last day.'
          }
          onClick={() => nav('reviews')}
          tone={latestReview && !latestReview.acknowledged ? 'new' : 'quiet'}
        />
      </div>
    </div>
  )
}

function Card({
  icon,
  label,
  primary,
  desc,
  onClick,
  tone
}: {
  icon: React.ReactNode
  label: string
  primary: string
  desc: string
  onClick: () => void
  tone: 'quiet' | 'active' | 'alert' | 'new'
}): React.JSX.Element {
  const toneBorder = {
    quiet: 'border-att-divider',
    active: 'border-att-blue/40',
    alert: 'border-att-orange/50',
    new: 'border-att-blue/40'
  }[tone]
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex flex-col gap-1 rounded-lg border bg-att-surface px-4 py-[14px] text-left transition-colors hover:bg-att-surface-hover',
        toneBorder
      )}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground/70">
          {label}
        </span>
        <ChevronRight className="ml-auto h-3 w-3 text-muted-foreground/40 transition-transform group-hover:translate-x-[2px] group-hover:text-foreground" />
      </div>
      <div className="text-[13.5px] font-medium text-foreground">{primary}</div>
      <div className="line-clamp-2 text-[11.5px] leading-[1.45] text-muted-foreground">
        {desc}
      </div>
    </button>
  )
}
