import { cn } from '@/lib/utils'
import type { Decision } from '@/stores/decision-store'

interface DecisionCardProps {
  decision: Decision
  onOpen: (id: string) => void
  highlightDue?: boolean
}

function statusTone(status: Decision['status']): string {
  switch (status) {
    case 'active':
      return 'bg-att-blue/15 text-att-blue'
    case 'revisited':
      return 'bg-att-green/15 text-att-green'
    case 'superseded':
      return 'bg-muted text-muted-foreground'
    case 'reversed':
      return 'bg-att-red/15 text-att-red'
  }
}

function daysUntil(ts: number): string {
  if (!ts) return ''
  const diff = Math.round((ts - Date.now()) / 86400000)
  if (diff === 0) return 'due today'
  if (diff < 0) return `overdue ${Math.abs(diff)}d`
  return `in ${diff}d`
}

export function DecisionCard({
  decision,
  onOpen,
  highlightDue
}: DecisionCardProps): React.JSX.Element {
  const dueLabel = daysUntil(decision.revisitAt)
  const overdue = dueLabel.startsWith('overdue') || dueLabel === 'due today'
  return (
    <button
      onClick={() => onOpen(decision.id)}
      className={cn(
        'flex w-full flex-col items-start gap-2 rounded-lg border border-att-divider bg-att-surface p-4 text-left transition-colors',
        'hover:border-att-blue/40 hover:bg-att-surface-hover',
        highlightDue && overdue && 'border-att-orange/60'
      )}
    >
      <div className="flex w-full items-start gap-2">
        <div className="flex-1">
          <div className="text-[13.5px] font-medium text-foreground">{decision.title}</div>
          <div className="text-[11px] text-muted-foreground/70">
            {new Date(decision.createdAt).toISOString().slice(0, 10)}
            {decision.areaId && ` · ${decision.areaId.replace(/^area_/, '')}`}
          </div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-[2px] font-mono text-[10px]',
            statusTone(decision.status)
          )}
        >
          {decision.status}
        </span>
      </div>

      {decision.chosen && (
        <div className="line-clamp-2 text-[12px] text-muted-foreground">
          Chosen: <span className="text-foreground">{decision.chosen}</span>
        </div>
      )}

      <div className="flex w-full items-center justify-between pt-1 text-[11px] text-muted-foreground/70">
        <span>
          {decision.options.length > 0
            ? `${decision.options.length} ${decision.options.length === 1 ? 'option' : 'options'}`
            : 'no options logged'}
        </span>
        {decision.status === 'active' && dueLabel && (
          <span
            className={cn(
              'font-mono',
              overdue ? 'text-att-orange' : 'text-muted-foreground/70'
            )}
          >
            revisit {dueLabel}
          </span>
        )}
        {decision.retrospective && (
          <span className="text-att-green">
            ✓ {new Date(decision.retrospective.revisitedAt).toISOString().slice(0, 10)}
          </span>
        )}
      </div>
    </button>
  )
}
