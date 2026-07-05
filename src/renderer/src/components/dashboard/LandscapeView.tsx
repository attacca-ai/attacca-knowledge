import { useState, useEffect, useCallback, useRef } from 'react'
import {
  useTodayStore,
  type AgentThread,
  type LandscapeTheme,
  type MorningLandscape
} from '@/stores/today-store'
import { useTaskStore } from '@/stores/task-store'
import { useCaptureStore } from '@/stores/capture-store'
import { useSettingsStore } from '@/stores/settings-store'
import { ArrowLeft, ArrowUp, Loader2, RefreshCw, X, ListTodo, ArchiveX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { LifeOsCards } from './LifeOsCards'

const LANDSCAPE_TIMEOUT_MS = 120_000
const LANDSCAPE_REFRESH_MS = 6 * 60 * 60 * 1000 // 6 hours

/** Maps connection tool IDs to the Composio actions the agent should call */
const TOOL_ACTIONS: Record<string, string> = {
  // Email
  gmail: 'GMAIL_FETCH_EMAILS with query "is:unread newer_than:3d" and max_results 20',
  outlook:
    'fetch unread Outlook emails using OUTLOOK_FETCH_EMAILS with {"folder":"inbox","top":20,"is_read":false}',
  // Calendar
  'google-calendar':
    'call GOOGLECALENDAR_EVENTS_LIST via the attacca-tools skill to fetch upcoming calendar events',
  'outlook-calendar':
    'call OUTLOOK_LIST_EVENTS via the attacca-tools skill to fetch upcoming meetings and events',
  // Messaging
  slack: 'SLACK_LIST_ALL_CHANNELS_IN_THE_SLACK_WORKSPACE then read recent activity',
  // Project management
  trello:
    'call TRELLO_GET_MEMBERS_BOARDS_BY_ID_MEMBER with {"idMember":"me"} then TRELLO_GET_BOARDS_CARDS_BY_ID_BOARD for each board',
  clickup: 'CLICKUP_GET_FILTERED_TEAM_TASKS with statuses open and in-progress',
  asana: 'ASANA_GET_TASKS_LIST with assignee "me" and completed_since "now"',
  notion: 'NOTION_SEARCH for recent pages and databases',
  // Storage
  'google-drive': 'check recent Google Drive files using available Drive actions'
}

function buildLandscapePrompt(
  connectedTools: string[],
  recentCaptureLines: string[],
  openThreadLines: string[],
  archivedThemeLines: string[]
): string {
  const toolLines = connectedTools.filter((t) => TOOL_ACTIONS[t]).map((t) => `- ${TOOL_ACTIONS[t]}`)

  // Inject context from the store so the LLM has local knowledge even before tool calls
  const contextParts: string[] = []
  if (recentCaptureLines.length > 0) {
    contextParts.push(`Recent captures from the user:\n${recentCaptureLines.join('\n')}`)
  }
  if (openThreadLines.length > 0) {
    contextParts.push(
      `Open threads (unresolved questions the agent is holding):\n${openThreadLines.join('\n')}`
    )
  }
  if (archivedThemeLines.length > 0) {
    contextParts.push(
      `DISMISSED THEMES (the user archived these — do NOT resurface them or similar topics):\n${archivedThemeLines.join('\n')}`
    )
  }
  const contextSection =
    contextParts.length > 0
      ? `\n\nCONTEXT from recent activity:\n${contextParts.join('\n\n')}\n`
      : ''

  const connectedList =
    connectedTools.length > 0
      ? `The user has these tools connected: ${connectedTools.join(', ')}.`
      : 'The user has no tools connected yet.'

  // Step 1: gather live data — only act on tools the user actually has connected
  const step1 =
    toolLines.length > 0
      ? `\n${connectedList}\n\nSTEP 1 — GATHER LIVE DATA (you MUST do this before generating your response):\nCALL ONLY the tools listed below — do NOT call any other tools, even if you have documentation for them. If a tool is not in this list the user has NOT connected it:\n${toolLines.join('\n')}\n`
      : `\n${connectedList}\n\n(No supported tools are connected — base the landscape on the context above and today's date. Do NOT attempt to call any tools.)\n`

  const step2Label = toolLines.length > 0 ? '\nSTEP 2 — ' : '\n'

  return `You are generating a daily work landscape for a knowledge worker.${contextSection}${step1}${step2Label}After gathering data, return ONLY valid JSON (no markdown fences, no other text):
{
  "message": "Exactly 3 sentences about what stands out today based on the data you gathered. Speak like a knowledgeable colleague giving a terrain reading, not a bullet list. Use [entity]key topic[/entity] to highlight important named items.",
  "question": "One short open question based on the theme with the highest mentionCount from recent captures, or null if there are no captures or nothing needs orienting. Omit if not genuinely relevant.",
  "themes": [
    { "title": "Two words max", "description": "Why this matters right now", "weight": "high|mid|low|neutral", "tags": ["tag1"], "mentionCount": 1 }
  ],
  "threads": [
    { "title": "3-5 word topic", "holdingNote": "First-person max 2 sentences about what needs clarification before acting." }
  ],
  "suggestedActions": [
    { "label": "Action label", "actionType": "capture", "payload": {} }
  ]
}
Weights: high=urgent deadline, mid=needs attention, low=ongoing, neutral=informational. Max 4 themes, max 2 threads (only if genuine ambiguity exists in the data), max 2 suggestedActions.`
}

/** Truncates text to at most N sentences */
function truncateToSentences(text: string, max: number): string {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean)
  return sentences.length > max ? sentences.slice(0, max).join(' ') : text
}

const WEIGHT_STYLES: Record<LandscapeTheme['weight'], { strip: string; label: string }> = {
  high: { strip: 'bg-att-red', label: 'text-att-red' },
  mid: { strip: 'bg-att-orange', label: 'text-att-orange' },
  low: { strip: 'bg-att-green', label: 'text-att-green' },
  neutral: { strip: 'bg-att-blue', label: 'text-att-blue' }
}

const WEIGHT_LABELS: Record<LandscapeTheme['weight'], string> = {
  high: 'HIGH WEIGHT',
  mid: 'NEEDS ATTENTION',
  low: 'LOW WEIGHT',
  neutral: 'SIMMERING'
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

function formatThreadAge(createdAt: number): { label: string; colorClass: string } {
  const diffMs = Date.now() - createdAt
  const diffDays = Math.floor(diffMs / 86_400_000)
  const diffHours = Math.floor(diffMs / 3_600_000)
  const label =
    diffDays >= 1 ? `${diffDays}d open` : diffHours >= 1 ? `${diffHours}h open` : 'just opened'
  const colorClass =
    diffDays >= 7 ? 'text-att-red' : diffDays >= 3 ? 'text-att-orange' : 'text-muted-foreground/50'
  return { label, colorClass }
}

function formatTimestamp(timeZone?: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    ...(timeZone ? { timeZone } : {})
  }
  const base = new Intl.DateTimeFormat('en-US', opts).format(new Date()).toUpperCase()
  if (!timeZone) return base
  // Extract city name from IANA string: "America/Bogota" → "Bogota", "America/New_York" → "New York"
  const city = timeZone.split('/').pop()?.replace(/_/g, ' ') ?? timeZone
  return `${base} · ${city.toUpperCase()}`
}

function ThreadChatPanel({
  thread,
  onBack
}: {
  thread: AgentThread
  onBack: () => void
}): React.JSX.Element {
  const messages = useTodayStore((s) => s.threadMessages[thread.id] ?? [])
  const addThreadMessage = useTodayStore((s) => s.addThreadMessage)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const pendingSessionKeyRef = useRef<string | null>(null)
  const { updateThreadNote, closeThread } = useTodayStore()

  // Seed the initial holding note message for each thread that has no messages yet.
  // Per-thread guard — uses messages.length for the active thread so switching
  // threads re-seeds the new one (prior ref-based guard was component-scoped).
  useEffect(() => {
    if (messages.length === 0) {
      addThreadMessage(thread.id, {
        role: 'agent',
        text: thread.holdingNote || 'Procesando…',
        ts: thread.createdAt
      })
    }
  }, [thread.id, thread.holdingNote, thread.createdAt, messages.length, addThreadMessage])

  useEffect(() => {
    const unsub = window.api.agent.onFinal((data) => {
      if (!pendingSessionKeyRef.current || data.sessionKey !== pendingSessionKeyRef.current)
        return
      const rawText = data.message
      pendingSessionKeyRef.current = null
      setSending(false)
      let note = rawText
      let newHoldingNote: string | null | undefined = undefined
      let resolvedIds: string[] = []
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as {
            note?: string
            holdingNote?: string | null
            resolvedThreadIds?: string[]
          }
          if (parsed.note) note = parsed.note
          if ('holdingNote' in parsed) newHoldingNote = parsed.holdingNote
          if (Array.isArray(parsed.resolvedThreadIds)) resolvedIds = parsed.resolvedThreadIds
        } catch {
          /* use raw */
        }
      }
      addThreadMessage(thread.id, { role: 'agent', text: note, ts: Date.now() })
      if (typeof newHoldingNote === 'string') {
        updateThreadNote(thread.id, newHoldingNote)
      }
      if (resolvedIds.includes(thread.id)) {
        closeThread(thread.id)
        onBack()
      }
    })
    // Agent errors arrive as events — without this "pensando…" is stuck forever
    const unsubError = window.api.agent.onError((data) => {
      if (!pendingSessionKeyRef.current || data.sessionKey !== pendingSessionKeyRef.current) return
      pendingSessionKeyRef.current = null
      setSending(false)
      addThreadMessage(thread.id, {
        role: 'agent',
        text: data.error || 'Algo salió mal. Intenta de nuevo.',
        ts: Date.now()
      })
    })
    return () => {
      unsub()
      unsubError()
    }
  }, [thread.id, thread.holdingNote, updateThreadNote, closeThread, onBack, addThreadMessage])

  const handleSend = async (): Promise<void> => {
    if (!input.trim() || sending) return
    const userText = input.trim()
    setInput('')
    addThreadMessage(thread.id, { role: 'user', text: userText, ts: Date.now() })
    setSending(true)
    const sessionKey = `agent:main:thread-${thread.id}-${crypto.randomUUID()}`
    pendingSessionKeyRef.current = sessionKey
    const prompt =
      `Retomas un hilo abierto. Hilo: "${thread.title}". Estabas esperando: "${thread.holdingNote}".\n` +
      `El usuario responde: "${userText}"\n\n` +
      `Ayúdale a pensar y ejecuta si corresponde. Llama herramientas si necesitas datos.\n` +
      `Responde SOLO con JSON válido (sin markdown):\n` +
      `{"note":"Tu respuesta conversacional.","holdingNote":"Qué sigues esperando (null si resuelto).","resolvedThreadIds":[]}\n` +
      `- Incluye "${thread.id}" en resolvedThreadIds si este hilo queda completamente resuelto.`
    try {
      await window.api.agent.send(sessionKey, prompt, sessionKey)
    } catch {
      setSending(false)
      pendingSessionKeyRef.current = null
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-att-divider px-6 py-4">
        <button
          onClick={onBack}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="flex-1 text-[13px] font-medium text-foreground">{thread.title}</span>
        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/50">
          hilo abierto
        </span>
      </div>

      {/* Messages */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
        {messages.map((m, i) => (
          <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[80%] rounded-lg px-3 py-2 text-[12.5px] leading-[1.5]',
                m.role === 'user'
                  ? 'bg-att-blue/15 text-foreground'
                  : 'bg-att-surface-raised italic text-muted-foreground'
              )}
            >
              {m.text}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-att-surface-raised px-3 py-2">
              <span className="animate-pulse text-[11px] text-muted-foreground/50">pensando…</span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-att-divider px-6 py-4">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void handleSend()
              }
            }}
            placeholder="Responde al agente…"
            className="flex-1 rounded-md border border-att-divider bg-att-surface px-3 py-2 text-[12.5px] text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-att-blue/50"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || sending}
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-md bg-att-blue text-white transition-opacity disabled:opacity-40"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

export function LandscapeView(): React.JSX.Element {
  const {
    morningLandscape,
    themes,
    threads,
    activeThreadId,
    setMorningLandscape,
    setThemes,
    setThreads,
    setActiveThreadId,
    closeThread,
    archiveTheme
  } = useTodayStore()
  const addLocalTask = useTaskStore((s) => s.addLocalTask)
  // External integrations removed in Phase 0 Life OS pivot — no connected
  // tools anywhere. Keep the local variable name so downstream code using
  // `liveTools`/`connectedTools` as an input to the landscape prompt still
  // compiles without further changes.
  const connectedTools: string[] = []
  const userTimezone = useSettingsStore((s) => s.userTimezone)
  const [loading, setLoading] = useState(false)
  const [timestamp, setTimestamp] = useState(() => formatTimestamp(userTimezone))
  const [taskCreatedId, setTaskCreatedId] = useState<string | null>(null)
  const [archivingThemeId, setArchivingThemeId] = useState<string | null>(null)
  const [archiveNoteInput, setArchiveNoteInput] = useState('')
  const activeThread = threads.find((t) => t.id === activeThreadId) ?? null
  // Ensures auto-trigger fires at most once per app session
  const hasAutoTriggeredRef = useRef(false)

  // Update timestamp every minute
  useEffect(() => {
    const interval = setInterval(() => setTimestamp(formatTimestamp(userTimezone)), 60_000)
    return () => clearInterval(interval)
  }, [])

  const focusCapture = (context: string): void => {
    window.dispatchEvent(new CustomEvent('attacca:focus-capture', { detail: { context } }))
  }

  const handleSuggestedAction = (action: { actionType: string; payload: unknown }): void => {
    if (action.actionType === 'capture') {
      const payload = (action.payload ?? {}) as Record<string, unknown>
      focusCapture((payload.text as string) || '')
      return
    }
    window.api.agent
      .send('main', JSON.stringify({ type: action.actionType, payload: action.payload }), crypto.randomUUID())
      .catch(() => undefined)
  }

  const generateLandscape = useCallback(async (): Promise<void> => {
    if (loading) return
    setLoading(true)

    // External integrations removed in Phase 0 Life OS pivot — the agent runs
    // with no connected tools. The builder below still accepts this list so
    // later phases can reintroduce direct-API tools without a UI rewrite.
    const liveTools = connectedTools

    // Build context from store state at call time (avoids stale closure issues)
    const captureState = useCaptureStore.getState()
    const todayState = useTodayStore.getState()
    const recentCaptureLines = captureState.rawCaptures
      .slice(0, 5)
      .map((c) => `  [${c.type}] "${c.text}"`)
    const openThreadLines = todayState.threads
      .slice(0, 3)
      .map((t) => `  "${t.title}": ${t.holdingNote}`)
    const archivedThemeLines = todayState.themes
      .filter((t) => t.archived)
      .slice(0, 10)
      .map((t) => `  - "${t.title}"${t.archiveNote ? ` (reason: ${t.archiveNote})` : ''}`)

    // Use a unique session per generation so the agent starts with clean context
    // and won't carry over stale "tool disconnected" memory from previous turns.
    const idempotencyKey = crypto.randomUUID()
    const sessionKey = `agent:main:landscape-${idempotencyKey}`

    try {
      let done = false
      const timeoutId = setTimeout(() => {
        if (!done) {
          done = true
          unsubFinal()
          unsubError()
          setLoading(false)
        }
      }, LANDSCAPE_TIMEOUT_MS)

      const unsubFinal = window.api.agent.onFinal((data) => {
        // Only process events from this landscape session
        if (data.sessionKey !== sessionKey) return

        if (!done) {
          done = true
          clearTimeout(timeoutId)
          unsubFinal()
          unsubError()
          setLoading(false)

          const rawText = data.message

          // Extract JSON — strip possible markdown code fences
          const jsonMatch = rawText.match(/\{[\s\S]*\}/)
          if (!jsonMatch) return

          try {
            const parsed = JSON.parse(jsonMatch[0]) as {
              message?: string
              question?: string | null
              themes?: LandscapeTheme[]
              threads?: Array<{ title: string; holdingNote: string }>
              suggestedActions?: MorningLandscape['suggestedActions']
            }

            // Hard limit: truncate message to max 3 sentences in renderer
            const msg = truncateToSentences(parsed.message ?? '', 3)

            const landscape: MorningLandscape = {
              message: msg,
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
                mentionCount: t.mentionCount ?? 1
              }))
            )
            // Replace threads from previous briefing runs — deduplicate by title
            // to avoid accumulating duplicates across refreshes. Existing threads
            // not present in the new response are dropped; user-closed ones are
            // already gone from the store.
            const freshThreads = (parsed.threads ?? [])
              .filter((t) => t.title && t.holdingNote)
              .map((t, i) => ({
                id: `thread_briefing_${i}_${Date.now()}`,
                title: t.title as string,
                holdingNote: t.holdingNote as string,
                createdAt: Date.now()
              }))
            // Merge: keep manually-added threads (id not starting with "thread_briefing_")
            // and replace all briefing-generated ones with the fresh set.
            const manualThreads = useTodayStore.getState().threads.filter(
              (t) => !t.id.startsWith('thread_briefing_')
            )
            setThreads([...manualThreads, ...freshThreads])
          } catch {
            // JSON parse failed — silently ignore, user can retry
          }
        }
      })

      const unsubError = window.api.agent.onError((data) => {
        if (data.sessionKey !== sessionKey) return
        if (!done) {
          done = true
          clearTimeout(timeoutId)
          unsubFinal()
          unsubError()
          setLoading(false)
        }
      })

      await window.api.agent.send(sessionKey, buildLandscapePrompt(liveTools, recentCaptureLines, openThreadLines, archivedThemeLines), idempotencyKey)
    } catch {
      setLoading(false)
    }
  }, [loading, connectedTools, setMorningLandscape, setThemes, setThreads])

  // Auto-trigger landscape when connected if missing or stale (>6h since last generation)
  useEffect(() => {
    if (hasAutoTriggeredRef.current) return

    const landscape = useTodayStore.getState().morningLandscape
    const isStale = !landscape || Date.now() - landscape.generatedAt > LANDSCAPE_REFRESH_MS
    if (isStale) {
      hasAutoTriggeredRef.current = true
      generateLandscape()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
                <strong className="font-normal not-italic text-att-blue">
                  {morningLandscape.question}
                </strong>
              </p>
            )}

            {/* Action buttons */}
            <div className="mt-3 flex flex-wrap gap-2">
              {/* "Responder" — always first */}
              <Button
                size="sm"
                variant="default"
                className="text-xs"
                onClick={() => focusCapture(morningLandscape.message)}
              >
                Responder
              </Button>
              {/* Up to 2 contextual actions from suggestedActions */}
              {morningLandscape.suggestedActions.slice(0, 2).map((action, i) => (
                <Button
                  key={i}
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => handleSuggestedAction(action)}
                >
                  {action.label}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={generateLandscape}
                disabled={loading}
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
                disabled={false}
              >
                Generate Landscape
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── Body ── */}
      {activeThread ? (
        <ThreadChatPanel thread={activeThread} onBack={() => setActiveThreadId(null)} />
      ) : null}
      <div className={cn('flex-1 overflow-y-auto px-6 py-5', activeThread ? 'hidden' : '')}>
        {/* Life OS summary cards (spec §6.7) */}
        <LifeOsCards />
        {/* Themes */}
        <div className="mb-6">
          <p className="mb-3 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
            What I&apos;m noticing · themes
          </p>

          {themes.filter((t) => !t.archived).length > 0 ? (
            <div className="grid grid-cols-2 gap-[10px]">
              {themes.filter((t) => !t.archived).slice(0, 4).map((theme) => {
                const styles = WEIGHT_STYLES[theme.weight]
                return (
                  <div
                    key={theme.id}
                    className="relative cursor-pointer overflow-hidden rounded-lg border border-att-divider bg-att-surface px-4 py-[14px] transition-colors hover:bg-att-surface-hover"
                  >
                    {/* Left accent strip */}
                    <div className={cn('absolute bottom-0 left-0 top-0 w-[3px]', styles.strip)} />

                    <p
                      className={cn(
                        'mb-[5px] font-mono text-[9px] uppercase tracking-[.1em]',
                        styles.label
                      )}
                    >
                      {WEIGHT_LABELS[theme.weight]}
                    </p>
                    <p className="mb-1 text-[13px] font-medium text-foreground">{theme.title}</p>
                    <p className="text-[11.5px] leading-[1.45] text-muted-foreground">
                      {theme.description}
                    </p>
                    <div className="mt-[10px] flex items-center gap-1.5">
                      {theme.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-[3px] bg-att-surface-raised px-[6px] py-[2px] font-mono text-[9px] text-muted-foreground/60"
                        >
                          {tag}
                        </span>
                      ))}
                      {theme.mentionCount > 1 && (
                        <span className="ml-auto font-mono text-[9px] text-muted-foreground/50">
                          ×{theme.mentionCount} esta semana
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-col gap-1.5">
                      {archivingThemeId === theme.id ? (
                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          <input
                            autoFocus
                            value={archiveNoteInput}
                            onChange={(e) => setArchiveNoteInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                archiveTheme(theme.id, archiveNoteInput.trim() || 'Dismissed')
                                setArchivingThemeId(null)
                                setArchiveNoteInput('')
                              }
                              if (e.key === 'Escape') {
                                setArchivingThemeId(null)
                                setArchiveNoteInput('')
                              }
                            }}
                            placeholder="Why dismiss? (Enter to confirm)"
                            className="flex-1 rounded border border-att-divider bg-att-surface px-2 py-1 text-[10px] text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-att-blue/50"
                          />
                          <button
                            onClick={() => {
                              archiveTheme(theme.id, archiveNoteInput.trim() || 'Dismissed')
                              setArchivingThemeId(null)
                              setArchiveNoteInput('')
                            }}
                            className="rounded bg-att-red/12 px-2 py-1 text-[10px] text-att-red"
                          >
                            Dismiss
                          </button>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setArchivingThemeId(theme.id)
                          setArchiveNoteInput('')
                        }}
                        className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-muted-foreground/50 transition-colors hover:bg-muted/20 hover:text-muted-foreground"
                        title="Archive theme — won't appear in future landscapes"
                      >
                        <ArchiveX className="h-3 w-3" />
                        Dismiss
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          addLocalTask({
                            description: `${theme.title}: ${theme.description}`,
                            sourceType: 'theme',
                            sourceId: theme.id
                          })
                          setTaskCreatedId(theme.id)
                          setTimeout(() => setTaskCreatedId(null), 2000)
                        }}
                        className={cn(
                          'flex items-center gap-1 rounded px-2 py-1 text-[10px] transition-colors',
                          taskCreatedId === theme.id
                            ? 'bg-att-green/12 text-att-green'
                            : 'text-att-blue hover:bg-att-blue/12'
                        )}
                      >
                        <ListTodo className="h-3 w-3" />
                        {taskCreatedId === theme.id ? 'Added to Tasks' : 'Work on this'}
                      </button>
                        </div>
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
                  : "Generate your landscape to surface today's key themes."}
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
            <div className="flex flex-col gap-[8px]">
              {threads.map((thread) => {
                const { label: ageLabel, colorClass: ageColor } = formatThreadAge(thread.createdAt)
                return (
                  <div
                    key={thread.id}
                    onClick={() => setActiveThreadId(thread.id)}
                    className="cursor-pointer rounded-lg border border-att-divider bg-att-surface px-[15px] py-[13px] transition-colors hover:bg-att-surface-hover"
                  >
                    <div className="mb-[6px] flex items-center gap-[10px]">
                      <span className="flex-1 text-[12.5px] font-medium text-foreground">
                        {thread.title}
                      </span>
                      <span className={cn('font-mono text-[9px]', ageColor)}>{ageLabel}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          closeThread(thread.id)
                        }}
                        className="rounded p-0.5 text-muted-foreground/40 transition-colors hover:text-muted-foreground"
                        title="Close thread"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    {thread.holdingNote && (
                      <p className="rounded-[4px] border-l-2 border-border bg-att-surface-raised px-[10px] py-[6px] text-[11.5px] italic text-muted-foreground before:mr-1 before:font-mono before:text-[9px] before:not-italic before:uppercase before:tracking-[.06em] before:text-muted-foreground/50 before:content-['esperando_→']">
                        {thread.holdingNote}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
