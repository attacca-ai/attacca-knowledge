import { useAppStore } from '@/stores/app-store'
import { Badge } from '@/components/ui/badge'

export function DashboardPlaceholder(): React.JSX.Element {
  const version = useAppStore((s) => s.version)

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Title bar drag region */}
      <div
        className="flex h-9 shrink-0 items-center justify-between border-b border-border px-4"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-sm font-medium text-foreground">Attacca</span>
        <div
          className="flex items-center gap-2"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div className="h-2 w-2 rounded-full bg-att-green" />
          <Badge variant="outline" className="text-xs">
            Ready
          </Badge>
          {version && <span className="text-xs text-muted-foreground">v{version}</span>}
        </div>
      </div>

      {/* Dashboard content */}
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <h2 className="text-2xl font-semibold text-foreground">Action Dashboard</h2>
          <p className="max-w-md text-muted-foreground">
            Your assistant is ready. The full dashboard with morning briefings, activity feed, task
            queue, and permission controls is coming in Phase 3.
          </p>
        </div>
      </div>
    </div>
  )
}
