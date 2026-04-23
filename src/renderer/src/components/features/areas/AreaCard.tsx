import { cn } from '@/lib/utils'
import type { Area } from '@/stores/area-store'

interface AreaCardProps {
  area: Area
  onOpen: (id: string) => void
}

function healthColor(score: number | undefined): string {
  if (score === undefined) return 'bg-muted text-muted-foreground'
  if (score >= 70) return 'bg-att-green/20 text-att-green'
  if (score >= 40) return 'bg-att-orange/20 text-att-orange'
  return 'bg-att-red/20 text-att-red'
}

export function AreaCard({ area, onOpen }: AreaCardProps): React.JSX.Element {
  const projectCount = area.projectIds.length
  const taskCount = area.taskIds.length
  return (
    <button
      onClick={() => onOpen(area.id)}
      className={cn(
        'flex w-full flex-col items-start gap-2 rounded-lg border border-att-divider bg-att-surface p-4 text-left transition-colors',
        'hover:border-att-blue/40 hover:bg-att-surface-hover'
      )}
    >
      <div className="flex w-full items-center gap-2">
        <span className="text-[20px] leading-none">{area.emoji ?? '📁'}</span>
        <div className="flex-1">
          <div className="text-[13.5px] font-medium text-foreground">{area.name}</div>
          <div className="text-[11px] text-muted-foreground/70">
            {area.reviewCadence === 'weekly' ? 'Weekly review' : 'Monthly review'}
            {area.archived && ' · archived'}
          </div>
        </div>
        {area.healthScore !== undefined && (
          <span
            className={cn(
              'rounded-full px-2 py-[2px] font-mono text-[10px]',
              healthColor(area.healthScore)
            )}
          >
            {area.healthScore}
          </span>
        )}
      </div>

      {area.description && (
        <div className="line-clamp-2 text-[12px] text-muted-foreground">{area.description}</div>
      )}

      <div className="flex w-full items-center gap-3 pt-1 text-[11px] text-muted-foreground/60">
        <span>
          {projectCount} {projectCount === 1 ? 'project' : 'projects'}
        </span>
        <span>·</span>
        <span>
          {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
        </span>
      </div>
    </button>
  )
}
