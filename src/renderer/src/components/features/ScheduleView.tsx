import { useState, useEffect, useRef } from 'react'
import { gatewayClient } from '@/lib/gateway-client'
import { useGatewayStore } from '@/stores/gateway-store'
import { useAgentStore } from '@/stores/agent-store'
import type { ScheduleChatMessage } from '@/stores/agent-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Calendar, Clock, Loader2, Send } from 'lucide-react'
import type { JsonRpcEvent } from '@/types/gateway'

interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  attendees?: string[]
}

interface MonthGroup {
  label: string
  events: CalendarEvent[]
}

function groupByMonth(events: CalendarEvent[]): MonthGroup[] {
  const map = new Map<string, MonthGroup>()
  for (const event of events) {
    const d = new Date(event.start)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    if (!map.has(key)) {
      map.set(key, {
        label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
        events: []
      })
    }
    map.get(key)!.events.push(event)
  }
  return Array.from(map.values())
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  )
}

export function ScheduleView(): React.JSX.Element {
  const connectionState = useGatewayStore((s) => s.connectionState)
  const addActivity = useAgentStore((s) => s.addActivity)
  const scheduleChatHistory = useAgentStore((s) => s.scheduleChatHistory)
  const setScheduleChatHistory = useAgentStore((s) => s.setScheduleChatHistory)

  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null)
  const [input, setInput] = useState('')
  const [processing, setProcessing] = useState(false)
  const waitingRef = useRef(false)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [scheduleChatHistory, processing])

  // Load upcoming events (next 3 months) via Composio when connected
  useEffect(() => {
    if (connectionState !== 'connected') return

    const fetchEvents = async (): Promise<void> => {
      setLoadingEvents(true)
      try {
        const now = new Date()
        const timeMin = now.toISOString()
        const timeMax = new Date(now.getFullYear(), now.getMonth() + 3, 1).toISOString()

        const response = await window.api.relay.callTool('GOOGLECALENDAR_EVENTS_LIST', {
          calendarId: 'primary',
          timeMin,
          timeMax,
          maxResults: 100,
          singleEvents: true,
          orderBy: 'startTime'
        })

        if (!response.success) {
          setCalendarConnected(false)
          return
        }

        setCalendarConnected(true)

        const result = response.result as {
          data?: {
            items?: Array<{
              id: string
              summary?: string
              start?: { dateTime?: string; date?: string }
              end?: { dateTime?: string; date?: string }
              attendees?: Array<{ email: string }>
            }>
          }
        }

        const items = result.data?.items ?? []
        setEvents(
          items.map((item) => ({
            id: item.id,
            title: item.summary ?? '(No title)',
            start: item.start?.dateTime ?? item.start?.date ?? '',
            end: item.end?.dateTime ?? item.end?.date ?? '',
            attendees: item.attendees?.map((a) => a.email)
          }))
        )
      } catch {
        // Silently fail
      } finally {
        setLoadingEvents(false)
      }
    }

    fetchEvents()
  }, [connectionState])

  // Subscribe to gateway events to capture chat responses
  useEffect(() => {
    if (connectionState !== 'connected') return

    const handler = (event: JsonRpcEvent): void => {
      if (event.event !== 'chat') return
      const payload = (event.payload ?? {}) as Record<string, unknown>
      const state = payload.state as string

      if (state === 'final' && waitingRef.current) {
        const message = payload.message as
          | { content?: Array<{ type: string; text?: string }> }
          | undefined
        const text = message?.content?.[0]?.text ?? ''
        if (text) {
          const current = useAgentStore.getState().scheduleChatHistory
          setScheduleChatHistory([
            ...current,
            { id: crypto.randomUUID(), role: 'assistant', text }
          ])
          waitingRef.current = false
          setProcessing(false)
        }
      } else if (state === 'error' && waitingRef.current) {
        waitingRef.current = false
        setProcessing(false)
      }
    }

    gatewayClient.on('*', handler)
    return () => gatewayClient.off('*', handler)
  }, [connectionState, setScheduleChatHistory])

  const handleSend = async (): Promise<void> => {
    if (!input.trim() || processing) return

    const prompt = input.trim()
    setInput('')

    const userMsg: ScheduleChatMessage = { id: crypto.randomUUID(), role: 'user', text: prompt }
    const current = useAgentStore.getState().scheduleChatHistory
    setScheduleChatHistory([...current, userMsg])
    addActivity({ type: 'info', description: `Calendar: ${prompt}` })

    if (connectionState !== 'connected') {
      setScheduleChatHistory([
        ...current,
        userMsg,
        { id: crypto.randomUUID(), role: 'assistant', text: 'Not connected to agent. Please wait for the gateway to connect.' }
      ])
      return
    }

    setProcessing(true)
    waitingRef.current = true

    setTimeout(() => {
      if (waitingRef.current) {
        waitingRef.current = false
        setProcessing(false)
      }
    }, 60000)

    try {
      await gatewayClient.rpc('chat.send', {
        sessionKey: 'agent:main:main',
        message: prompt,
        idempotencyKey: crypto.randomUUID()
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      waitingRef.current = false
      setProcessing(false)
      const latest = useAgentStore.getState().scheduleChatHistory
      setScheduleChatHistory([
        ...latest,
        { id: crypto.randomUUID(), role: 'assistant', text: `Error: ${msg}` }
      ])
    }
  }

  const today = new Date()
  const formattedDate = today.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })

  const monthGroups = groupByMonth(events)

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-6">
      {/* Header */}
      <div className="mb-4 flex shrink-0 items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Schedule</h2>
          <p className="text-sm text-muted-foreground">{formattedDate}</p>
        </div>
        <Calendar className="h-5 w-5 text-muted-foreground" />
      </div>

      {/* Upcoming meetings agenda */}
      <div className="mb-4 shrink-0">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Upcoming
        </p>

        {loadingEvents ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-xs">Loading calendar…</span>
          </div>
        ) : events.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2">
            <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              {connectionState !== 'connected'
                ? 'Connect to gateway to load calendar.'
                : calendarConnected === false
                  ? 'Connect Google Calendar in Settings → Connections.'
                  : 'No upcoming events in the next 3 months.'}
            </p>
          </div>
        ) : (
          <div className="max-h-56 overflow-auto">
            {monthGroups.map((group) => (
              <div key={group.label} className="mb-3">
                {/* Month header */}
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
                <div className="flex flex-col gap-px">
                  {group.events.map((event) => {
                    const start = new Date(event.start)
                    const end = new Date(event.end)
                    const todayEvent = isToday(event.start)
                    return (
                      <div
                        key={event.id}
                        className={`flex items-start gap-3 rounded-md px-2 py-1.5 ${todayEvent ? 'bg-primary/5 ring-1 ring-primary/20' : 'hover:bg-muted/50'}`}
                      >
                        {/* Date column */}
                        <div className="w-9 shrink-0 text-center">
                          <p className="text-[10px] font-medium uppercase leading-none text-muted-foreground">
                            {start.toLocaleDateString('en-US', { weekday: 'short' })}
                          </p>
                          <p className={`text-base font-semibold leading-tight ${todayEvent ? 'text-primary' : 'text-foreground'}`}>
                            {start.getDate()}
                          </p>
                        </div>
                        {/* Event details */}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {event.title}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {' – '}
                            {end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {event.attendees && event.attendees.length > 0 && (
                              <span> · {event.attendees.length} attendee{event.attendees.length > 1 ? 's' : ''}</span>
                            )}
                          </p>
                        </div>
                        {todayEvent && (
                          <span className="shrink-0 rounded bg-primary px-1 py-0.5 text-[9px] font-semibold uppercase text-primary-foreground">
                            Today
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Chat panel */}
      <div className="flex flex-1 flex-col overflow-hidden border-t border-border pt-4">
        <p className="mb-2 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Assistant
        </p>
        <div className="flex flex-1 flex-col gap-3 overflow-auto">
          {scheduleChatHistory.length === 0 && !processing && (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-center text-xs text-muted-foreground">
                Ask about your schedule, meetings, or request rescheduling.
              </p>
            </div>
          )}

          {scheduleChatHistory.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}

          {processing && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1.5 rounded-lg bg-muted px-3 py-2">
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Thinking…</span>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="mt-3 shrink-0">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder='e.g., "Do I have meetings tomorrow?" or "Move my 2 PM to 4 PM"'
            className="text-sm"
            disabled={processing}
          />
          <Button onClick={handleSend} disabled={processing || !input.trim()}>
            {processing ? <Loader2 className="animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  )
}
