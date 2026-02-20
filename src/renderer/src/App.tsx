import { useEffect } from 'react'
import { useAppStore } from '@/stores/app-store'
import { useGateway } from '@/hooks/useGateway'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { useGatewayStore } from '@/stores/gateway-store'
import { Badge } from '@/components/ui/badge'

function LicensePage(): React.JSX.Element {
  const setPage = useAppStore((s) => s.setPage)

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 p-8">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Attacca</h1>
        <p className="text-muted-foreground">AI Productivity Assistant</p>
        <p className="text-sm text-muted-foreground">License activation coming in Phase 2</p>
        <button
          onClick={() => setPage('dashboard')}
          className="rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Continue to Dashboard
        </button>
      </div>
    </div>
  )
}

function DashboardPage(): React.JSX.Element {
  const connectionState = useGatewayStore((s) => s.connectionState)
  const processState = useGatewayStore((s) => s.processState)

  const statusColor = {
    connected: 'bg-green-500',
    connecting: 'bg-yellow-500',
    disconnected: 'bg-gray-500',
    error: 'bg-red-500'
  }[connectionState]

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Title bar drag region */}
      <div
        className="flex h-9 shrink-0 items-center justify-between border-b border-border px-4"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <span className="text-sm font-medium text-foreground">Attacca</span>
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <div className={`h-2 w-2 rounded-full ${statusColor}`} />
          <span className="text-xs text-muted-foreground">
            Gateway: {processState?.state ?? 'unknown'}
          </span>
          <Badge variant="outline" className="text-xs">
            WS: {connectionState}
          </Badge>
        </div>
      </div>

      {/* Dashboard content */}
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex flex-col items-center gap-4 text-center">
          <h2 className="text-2xl font-semibold text-foreground">Action Dashboard</h2>
          <p className="text-muted-foreground">
            Gateway process: {processState?.state ?? 'not started'}
          </p>
          <p className="text-muted-foreground">
            WebSocket: {connectionState}
          </p>
          {processState?.lastError && (
            <p className="text-sm text-destructive">{processState.lastError}</p>
          )}
        </div>
      </div>
    </div>
  )
}

function App(): React.JSX.Element {
  const page = useAppStore((s) => s.page)
  const setVersion = useAppStore((s) => s.setVersion)

  // Initialize gateway connection
  useGateway()
  useOnlineStatus()

  useEffect(() => {
    window.api.app.getVersion().then(setVersion)
  }, [setVersion])

  switch (page) {
    case 'license':
      return <LicensePage />
    case 'onboarding':
      return <div>Onboarding (Phase 2)</div>
    case 'dashboard':
      return <DashboardPage />
    default:
      return <LicensePage />
  }
}

export default App
