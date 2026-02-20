import { useGatewayStore } from '@/stores/gateway-store'
import { useAppStore } from '@/stores/app-store'
import { Badge } from '@/components/ui/badge'

export function TitleBar(): React.JSX.Element {
  const connectionState = useGatewayStore((s) => s.connectionState)
  const processState = useGatewayStore((s) => s.processState)
  const version = useAppStore((s) => s.version)

  const statusColor = {
    connected: 'bg-green-500',
    connecting: 'bg-yellow-500',
    disconnected: 'bg-gray-500',
    error: 'bg-red-500'
  }[connectionState]

  return (
    <div
      className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-background px-4"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <span className="text-sm font-medium text-foreground">Attacca</span>
      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className={`h-2 w-2 rounded-full ${statusColor}`} title={`Gateway: ${processState?.state ?? 'unknown'}`} />
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
          {connectionState === 'connected' ? 'Online' : connectionState}
        </Badge>
        {version && (
          <span className="text-[10px] text-muted-foreground">v{version}</span>
        )}
      </div>
    </div>
  )
}
