import { useState, useEffect } from 'react'
import { gatewayClient } from '@/lib/gateway-client'
import { useGatewayStore } from '@/stores/gateway-store'
import { useAgentStore } from '@/stores/agent-store'
import { useNotificationStore } from '@/stores/notification-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Zap, Clock, Shield, AlertTriangle } from 'lucide-react'

export function TakeOverMode(): React.JSX.Element {
  const connectionState = useGatewayStore((s) => s.connectionState)
  const addActivity = useAgentStore((s) => s.addActivity)
  const addNotification = useNotificationStore((s) => s.add)

  const [active, setActive] = useState(false)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [summaryInterval, setSummaryInterval] = useState(2) // hours
  const [autoDisableHours, setAutoDisableHours] = useState(8)

  // Auto-disable timer
  useEffect(() => {
    if (!active || !startedAt) return

    const timer = setTimeout(() => {
      handleDeactivate('timeout')
      addNotification({
        type: 'info',
        title: 'Take Over Mode Ended',
        message: `Take Over mode automatically disabled after ${autoDisableHours} hours.`
      })
    }, autoDisableHours * 60 * 60 * 1000)

    return () => clearTimeout(timer)
  }, [active, startedAt, autoDisableHours]) // eslint-disable-line react-hooks/exhaustive-deps

  // Summary timer
  useEffect(() => {
    if (!active) return

    const timer = setInterval(() => {
      addNotification({
        type: 'info',
        title: 'Take Over Summary',
        message: 'Consolidated summary of actions taken in the last period. Check the activity feed for details.'
      })
    }, summaryInterval * 60 * 60 * 1000)

    return () => clearInterval(timer)
  }, [active, summaryInterval]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleActivate = async (): Promise<void> => {
    setActive(true)
    setStartedAt(Date.now())

    addActivity({
      type: 'info',
      description: 'Take Over mode activated — agent is monitoring all connected tools'
    })

    addNotification({
      type: 'warning',
      title: 'Take Over Mode Active',
      message: 'Your assistant is now actively monitoring and processing incoming items. High-risk actions still require your approval.'
    })

    window.api.telemetry.emit('trust.takeover.activated', {})

    if (connectionState === 'connected') {
      try {
        await gatewayClient.rpc('agent.takeover.start', {
          summaryIntervalHours: summaryInterval,
          autoDisableHours
        })
      } catch {
        // Best effort
      }
    }
  }

  const handleDeactivate = async (trigger: 'manual' | 'timeout' = 'manual'): Promise<void> => {
    const durationMs = startedAt ? Date.now() - startedAt : 0
    setActive(false)
    setStartedAt(null)

    addActivity({
      type: 'info',
      description: 'Take Over mode deactivated — returning to normal operation'
    })

    window.api.telemetry.emit('trust.takeover.deactivated', { durationMs, trigger })

    if (connectionState === 'connected') {
      try {
        await gatewayClient.rpc('agent.takeover.stop')
      } catch {
        // Best effort
      }
    }
  }

  const elapsedMinutes = startedAt ? Math.floor((Date.now() - startedAt) / 60_000) : 0
  const elapsedHours = Math.floor(elapsedMinutes / 60)
  const elapsedMins = elapsedMinutes % 60

  return (
    <div className="flex flex-1 flex-col p-6">
      <h2 className="mb-2 text-xl font-semibold text-foreground">Take Over Mode</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        When active, your assistant monitors all connected tools for new items,
        triages them, and processes tasks automatically. High-risk actions still require
        your approval.
      </p>

      {/* Status card */}
      <Card className={active ? 'border-yellow-500/30 bg-yellow-500/5' : ''}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Zap className={`h-4 w-4 ${active ? 'text-yellow-500' : 'text-muted-foreground'}`} />
              Take Over Mode
            </CardTitle>
            <Badge variant={active ? 'default' : 'outline'}>
              {active ? 'Active' : 'Inactive'}
            </Badge>
          </div>
          {active && (
            <CardDescription>
              Running for {elapsedHours}h {elapsedMins}m.
              Auto-disables in {autoDisableHours - elapsedHours}h.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Configuration */}
          {!active && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Summary every</span>
                <Input
                  type="number"
                  value={summaryInterval}
                  onChange={(e) => setSummaryInterval(Number(e.target.value) || 2)}
                  className="w-16 text-center text-sm"
                  min={1}
                  max={24}
                />
                <span className="text-sm text-muted-foreground">hours</span>
              </div>

              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Auto-disable after</span>
                <Input
                  type="number"
                  value={autoDisableHours}
                  onChange={(e) => setAutoDisableHours(Number(e.target.value) || 8)}
                  className="w-16 text-center text-sm"
                  min={1}
                  max={24}
                />
                <span className="text-sm text-muted-foreground">hours</span>
              </div>
            </div>
          )}

          {/* Safety notice */}
          <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
            <Shield className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              High-risk actions (sending emails, deleting items, posting in channels) still require
              your explicit approval or a valid 30-day standing approval.
            </span>
          </div>

          {/* Action button */}
          <Button
            onClick={active ? () => handleDeactivate() : handleActivate}
            variant={active ? 'destructive' : 'default'}
            disabled={connectionState !== 'connected'}
          >
            {active ? (
              <>
                <AlertTriangle className="h-4 w-4" />
                Deactivate Take Over Mode
              </>
            ) : (
              <>
                <Zap className="h-4 w-4" />
                Activate Take Over Mode
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
