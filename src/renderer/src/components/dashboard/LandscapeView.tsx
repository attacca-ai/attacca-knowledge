import { useState, useEffect, useCallback } from 'react'
import { gatewayClient } from '@/lib/gateway-client'
import { useAgentStore, type LandscapeTheme, type MorningLandscape } from '@/stores/agent-store'
import { useGatewayStore } from '@/stores/gateway-store'
import { useOnboardingStore } from '@/stores/onboarding-store'
import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { OcEvent } from '@/types/gateway'

const LANDSCAPE_TIMEOUT_MS = 120_000

/** Maps connection tool IDs to the Composio actions the agent should call */
const TOOL_ACTIONS: Record<string, string> = {
  'gmail':           'GMAIL_FETCH_EMAILS with query "is:unread newer_than:3d" and max_results 20',
  'google-calendar': 'GOOGLECALENDAR_EVENTS_LIST for calendarId "primary" with maxResults 10',
  'slack':           'SLACK_LIST_ALL_CHANNELS_IN_THE_SLACK_WORKSPACE then read recent activity',
  'trello':          'call ATTACCA_TRELLO_BOARDS_AND_CARDS (attacca-tools skill, no parameters needed) — returns all boards with their cards',
  'clickup':         'CLICKUP_GET_FILTERED_TEAM_TASKS with statuses open and in-progress',
  'asana':           'ASANA_GET_TASKS_LIST with assignee "me" and completed_since "now"',
  'notion':          'NOTION_SEARCH for recent pages and databases',
  'google-drive':    'check recent Google Drive files using available Drive actions',
}

function buildLandscapePrompt(connectedTools: string[]): string {
  const toolLines = connectedTools
    .filter((t) => TOOL_ACTIONS[t])
    .map((t) => `- ${TOOL_ACTIONS[t]}`)

  const toolsSection = toolLines.length > 0
    ? `Check the following connected tools:\n${toolLines.join('\n')}`
    : 'No external tools are connected. Base the landscape on general context and today\'s date.'

  return `Generate my daily work landscape. ${toolsSection}

Return ONLY valid JSON (no markdown fences, no other text):
{
  "message": "Exactly 3 sentences about what stands out today based on available data. Use [entity]key topic[/entity] to highlight important items.",
  "question": "One short focusing question to orient the day, or null.",
  "themes": [
    { "title": "Two words max", "description": "Why this matters right now", "weight": "high|mid|low|neutral", "tags": ["tag1"], "mentionCount": 1 }
  ],
  "suggestedActions": [
    { "label": "Action label", "actionType": "capture", "payload": {} }
  ]
}
Weights: high=urgent deadline, mid=needs attention, low=ongoing, neutral=informational. Max 4 themes, max 2 suggestedActions.`
}

const WEIGHT_STYLES: Record<
  LandscapeTheme['weight'],
  { border: string; label: string; labelBg: string }
> = {
  high:    { border: 'border-l-red-500',    label: 'text-red-500',    labelBg: 'bg-red-500/10'    },
  mid:     { border: 'border-l-yellow-500', label: 'text-yellow-500', labelBg: 'bg-yellow-500/10' },
  low:     { border: 'border-l-green-500',  label: 'text-green-500',  labelBg: 'bg-green-500/10'  },
  neutral: { border: 'border-l-blue-500',   label: 'text-blue-500',   labelBg: 'bg-blue-500/10'   },
}

const WEIGHT_LABELS: Record<LandscapeTheme['weight'], string> = {
  high:    'HIGH WEIGHT',
  mid:     'NEEDS ATTENTION',
  low:     'LOW WEIGHT',
  neutral: 'SIMMERING',
}

/** Parses [entity]...[/entity] tags into highlighted <em> spans */
function parseAgentMessage(text: string): React.ReactNode[] {
  const parts = text.split(/(\[entity\].*?\[\/entity\])/g)
  return parts.map((part, i) => {
    const match = part.match(/^\[entity\](.*?)\[\/entity\]$/)
    if (match) {
      return (
        <em key={i} className="not-italic font-normal text-amber-400">
          {match[1]}
        </em>
      )
    }
    return <span key={i}>{part}</span>
  })
}

function formatThreadAge(createdAt: number): string {
  const diffMs = Date.now() - createdAt
  const diffDays = Math.floor(diffMs / 86_400_000)
  const diffHours = Math.floor(diffMs / 3_600_000)
  if (diffDays >= 1) return `${diffDays}d open`
  if (diffHours >= 1) return `${diffHours}h open`
  return 'just opened'
}

function formatTimestamp(): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }
  return new Intl.DateTimeFormat('en-US', opts).format(new Date()).toUpperCase()
}

export function LandscapeView(): React.JSX.Element {
  const { morningLandscape, themes, threads, setMorningLandscape, setThemes } = useAgentStore()
  const connectionState = useGatewayStore((s) => s.connectionState)
  const connectedTools = useOnboardingStore((s) => s.connectedTools)
  const [loading, setLoading] = useState(false)
  const [timestamp, setTimestamp] = useState(() => formatTimestamp())

  // Update timestamp every minute
  useEffect(() => {
    const interval = setInterval(() => setTimestamp(formatTimestamp()), 60_000)
    return () => clearInterval(interval)
  }, [])

  const generateLandscape = useCallback(async (): Promise<void> => {
    if (connectionState !== 'connected' || loading) return
    setLoading(true)

    // Always fetch the latest connected apps directly from the relay so we
    // never use a stale Zustand snapshot (e.g. Trello connected after last mount).
    let liveTools = connectedTools
    try {
      const relayApps = await window.api.relay.getConnected()
      if (relayApps.length > 0) liveTools = relayApps
    } catch {
      // Relay unavailable — fall back to store
    }

    // Use a unique session per generation so the agent starts with clean context
    // and won't carry over stale "tool disconnected" memory from previous turns.
    const idempotencyKey = crypto.randomUUID()
    const sessionKey = `agent:main:landscape-${idempotencyKey}`

    try {
      await gatewayClient.rpc('chat.send', {
        sessionKey,
        message: buildLandscapePrompt(liveTools),
        idempotencyKey
      })

      let done = false
      const timeoutId = setTimeout(() => {
        if (!done) {
          done = true
          gatewayClient.off('*', handler)
          setLoading(false)
        }
      }, LANDSCAPE_TIMEOUT_MS)

      const handler = (event: OcEvent): void => {
        if (event.event !== 'chat') return
        const payload = (event.payload ?? {}) as Record<string, unknown>
        const state = payload.state as string

        // Only process events from this landscape session
        if (payload.sessionKey !== undefined && payload.sessionKey !== sessionKey) return

        if (state === 'final' && !done) {
          done = true
          clearTimeout(timeoutId)
          gatewayClient.off('*', handler)
          setLoading(false)

          const message = payload.message as
            | { content?: Array<{ type: string; text?: string }> }
            | undefined
          const rawText = message?.content?.[0]?.text ?? ''

          // Extract JSON — strip possible markdown code fences
          const jsonMatch = rawText.match(/\{[\s\S]*\}/)
          if (!jsonMatch) return

          try {
            const parsed = JSON.parse(jsonMatch[0]) as {
              message?: string
              question?: string | null
              themes?: LandscapeTheme[]
              suggestedActions?: MorningLandscape['suggestedActions']
            }

            const landscape: MorningLandscape = {
              message: parsed.message ?? '',
              question: parsed.question ?? null,
              suggestedActions: parsed.suggestedActions ?? [],
              generatedAt: Date.now()
            }

            setMorningLandscape(landscape)
            setThemes(
              (parsed.themes ?? []).map((t, i) => ({
                ...t,
                id: t.id ?? `theme_${i}`,
                tags: t.tags ?? [],
                mentionCount: t.mentionCount ?? 1,
              }))
            )
          } catch {
            // JSON parse failed — silently ignore, user can retry
          }
        } else if (state === 'error' && !done) {
          done = true
          clearTimeout(timeoutId)
          gatewayClient.off('*', handler)
          setLoading(false)
        }
      }

      gatewayClient.on('*', handler)
    } catch {
      setLoading(false)
    }
  }, [connectionState, loading, connectedTools, setMorningLandscape, setThemes])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0 border-b border-border px-6 py-[18px]">
        {/* Timestamp */}
        <div className="mb-2 font-mono text-[10px] tracking-widest text-muted-foreground/60">
          {timestamp}
        </div>

        {morningLandscape ? (
          <>
            {/* Morning message */}
            <p className="max-w-[520px] text-[15px] font-light leading-relaxed text-foreground">
              {parseAgentMessage(morningLandscape.message)}
            </p>

            {/* Agent question */}
            {morningLandscape.question && (
              <p className="mt-3 border-l-2 border-border pl-3 text-sm italic text-muted-foreground">
                <strong className="font-normal not-italic text-blue-400">
                  {morningLandscape.question}
                </strong>
              </p>
            )}

            {/* Action buttons */}
            <div className="mt-3 flex flex-wrap gap-2">
              {morningLandscape.suggestedActions.map((action, i) => (
                <Button
                  key={i}
                  size="sm"
                  variant={i === 0 ? 'default' : 'outline'}
                  className="text-xs"
                >
                  {action.label}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={generateLandscape}
                disabled={loading || connectionState !== 'connected'}
                title="Refresh landscape"
                className="ml-auto"
              >
                <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-4">
            <p className="text-sm text-muted-foreground">
              {loading
                ? 'Reading your calendar, inbox and tasks…'
                : 'Generate your daily landscape to see what matters today.'}
            </p>
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={generateLandscape}
                disabled={connectionState !== 'connected'}
              >
                Generate Landscape
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">

        {/* Themes */}
        <div className="mb-6">
          <p className="mb-3 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
            What I&apos;m noticing · themes
          </p>

          {themes.length > 0 ? (
            <div className="grid grid-cols-2 gap-2.5">
              {themes.slice(0, 4).map((theme) => {
                const styles = WEIGHT_STYLES[theme.weight]
                return (
                  <div
                    key={theme.id}
                    className={cn(
                      'relative cursor-pointer rounded-lg border border-border/60 bg-card p-3.5',
                      'border-l-[3px] transition-colors hover:bg-muted/30',
                      styles.border
                    )}
                  >
                    <p className={cn('mb-1 font-mono text-[9px] uppercase tracking-widest', styles.label)}>
                      {WEIGHT_LABELS[theme.weight]}
                    </p>
                    <p className="mb-1.5 text-[13px] font-medium text-foreground">{theme.title}</p>
                    <p className="text-[11.5px] leading-snug text-muted-foreground">{theme.description}</p>
                    <div className="mt-2.5 flex items-center gap-1.5">
                      {theme.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/70"
                        >
                          {tag}
                        </span>
                      ))}
                      {theme.mentionCount > 1 && (
                        <span className="ml-auto font-mono text-[9px] text-muted-foreground/50">
                          ×{theme.mentionCount} this week
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-center">
              <p className="text-sm text-muted-foreground">
                {morningLandscape
                  ? 'No themes detected yet.'
                  : 'Generate your landscape to surface today\'s key themes.'}
              </p>
            </div>
          )}
        </div>

        {/* Open Threads */}
        {threads.length > 0 && (
          <div>
            <p className="mb-3 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
              Open threads · what I&apos;m holding
            </p>
            <div className="flex flex-col gap-2">
              {threads.map((thread) => (
                <div
                  key={thread.id}
                  className="cursor-pointer rounded-lg border border-border/60 bg-card p-3 transition-colors hover:bg-muted/30"
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="flex-1 text-[12.5px] font-medium text-foreground">{thread.title}</span>
                    <span className="font-mono text-[9px] text-muted-foreground/50">
                      {formatThreadAge(thread.createdAt)}
                    </span>
                  </div>
                  {thread.holdingNote && (
                    <p className="rounded bg-muted/50 px-2 py-1.5 text-[11.5px] italic text-muted-foreground before:mr-1 before:font-mono before:text-[9px] before:not-italic before:uppercase before:tracking-wider before:text-muted-foreground/50 before:content-['waiting_→']">
                      {thread.holdingNote}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
