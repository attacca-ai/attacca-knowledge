import { useState } from 'react'
import { gatewayClient } from '@/lib/gateway-client'
import { useGatewayStore } from '@/stores/gateway-store'
import { useAgentStore } from '@/stores/agent-store'
import { usePermissionStore } from '@/stores/permission-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Calendar, Clock, Loader2, Send } from 'lucide-react'

interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  attendees?: string[]
}

export function ScheduleView(): React.JSX.Element {
  const connectionState = useGatewayStore((s) => s.connectionState)
  const addActivity = useAgentStore((s) => s.addActivity)
  const addPendingApproval = usePermissionStore((s) => s.addPendingApproval)
  const [events] = useState<CalendarEvent[]>([])
  const [rearrangeInput, setRearrangeInput] = useState('')
  const [processing, setProcessing] = useState(false)

  const handleRearrange = async (): Promise<void> => {
    if (!rearrangeInput.trim() || connectionState !== 'connected') return

    setProcessing(true)
    addActivity({ type: 'info', description: `Schedule request: ${rearrangeInput}` })

    try {
      await gatewayClient.rpc('agent.request', {
        prompt: `The user wants to rearrange their schedule: "${rearrangeInput}". Check the calendar, identify conflicts, and propose rescheduling options. All calendar modifications require HIGH-risk approval.`
      })

      // Add approval for calendar modification
      addPendingApproval({
        actionType: 'reschedule.meeting',
        toolId: 'calendar',
        tier: 'high',
        description: `Rearrange schedule: ${rearrangeInput}`
      })
    } catch {
      addActivity({ type: 'error', description: 'Failed to process schedule request' })
    } finally {
      setProcessing(false)
      setRearrangeInput('')
    }
  }

  const today = new Date()
  const formattedDate = today.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Schedule</h2>
          <p className="text-sm text-muted-foreground">{formattedDate}</p>
        </div>
        <Calendar className="h-5 w-5 text-muted-foreground" />
      </div>

      {/* Events list */}
      <div className="mb-6 flex flex-col gap-2">
        {events.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-8 text-center">
            <Clock className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {connectionState === 'connected'
                ? 'No events loaded. Connect a calendar to see your schedule.'
                : 'Connect to the gateway to load your calendar.'}
            </p>
          </div>
        ) : (
          events.map((event) => (
            <div key={event.id} className="flex items-center gap-3 rounded-md border border-border p-3">
              <div className="flex flex-col items-center rounded bg-muted px-2 py-1">
                <span className="text-xs font-medium text-foreground">
                  {new Date(event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(event.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">{event.title}</p>
                {event.attendees && event.attendees.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {event.attendees.length} attendee{event.attendees.length > 1 ? 's' : ''}
                  </p>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Rearrange input */}
      <div className="mt-auto">
        <p className="mb-2 text-sm font-medium text-foreground">Ask to rearrange</p>
        <div className="flex gap-2">
          <Input
            value={rearrangeInput}
            onChange={(e) => setRearrangeInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRearrange()}
            placeholder='e.g., "Move my 2 PM to 4 PM" or "I need to leave at 3 PM"'
            className="text-sm"
            disabled={processing}
          />
          <Button onClick={handleRearrange} disabled={processing || !rearrangeInput.trim()}>
            {processing ? <Loader2 className="animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
