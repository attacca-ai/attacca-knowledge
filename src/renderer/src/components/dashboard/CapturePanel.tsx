import { useState, useEffect, useRef, useCallback } from 'react'
import { gatewayClient } from '@/lib/gateway-client'
import { useAgentStore, type CaptureEntry } from '@/stores/agent-store'
import { useGatewayStore } from '@/stores/gateway-store'
import { Loader2, OctagonX } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { OcEvent } from '@/types/gateway'

type CaptureType = 'thought' | 'action' | 'question'

const TYPE_LABELS: Record<CaptureType, string> = {
  thought: 'thought',
  action: 'action',
  question: 'question',
}

// Badge colors for capture list entries
const TYPE_BADGE_COLORS: Record<CaptureType, string> = {
  thought: 'bg-blue-500/10 text-blue-400',
  action:  'bg-green-500/10 text-green-500',
  question:'bg-yellow-500/10 text-yellow-500',
}

// Active pill colors for the type selector (per-type, not always blue)
const ACTIVE_PILL_COLORS: Record<CaptureType, string> = {
  thought: 'border-blue-500/60 bg-blue-500/10 text-blue-400',
  action:  'border-green-500/60 bg-green-500/10 text-green-500',
  question:'border-yellow-500/60 bg-yellow-500/10 text-yellow-500',
}

const DOT_COLORS: Record<string, string> = {
  info:        'bg-muted-foreground/50',
  action:      'bg-green-500',
  tool_call:   'bg-blue-500 animate-pulse',
  tool_result: 'bg-green-500',
  error:       'bg-red-500',
  message:     'bg-foreground/60',
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatCaptureTime(ts: number): string {
  const date = new Date(ts)
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  const isToday = date.toDateString() === new Date().toDateString()
  if (isToday) return timeStr
  const weekday = date.toLocaleDateString([], { weekday: 'short' })
  return `${weekday} ${timeStr}`
}

export function CapturePanel({
  captureRef,
}: {
  captureRef?: React.RefObject<HTMLTextAreaElement | null>
}): React.JSX.Element {
  const {
    activityFeed,
    rawCaptures,
    addTask,
    addRawCapture,
    addThread,
    closeThread,
    updateThreadNote,
    updateCaptureNote,
    emergencyStop,
  } = useAgentStore()
  const connectionState = useGatewayStore((s) => s.connectionState)

  const [text, setText] = useState('')
  const [type, setType] = useState<CaptureType>('thought')
  const [sending, setSending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const localRef = useRef<HTMLTextAreaElement>(null)
  const textareaRef = captureRef ?? localRef
  // Track id of last capture waiting for agent note
  const pendingCaptureIdRef = useRef<string | null>(null)

  // ⌘K global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        textareaRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [textareaRef])

  // Focus capture with optional pre-filled context from landscape "Responder" button
  useEffect(() => {
    const handler = (e: Event): void => {
      const { context } = (e as CustomEvent<{ context: string }>).detail
      if (context) setText(context)
      textareaRef.current?.focus()
    }
    window.addEventListener('attacca:focus-capture', handler)
    return () => window.removeEventListener('attacca:focus-capture', handler)
  }, [textareaRef])

  // Auto-cancel stop confirmation after 3s
  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), 3_000)
    return () => clearTimeout(timer)
  }, [confirming])

  // Track session key of the in-flight capture so we ignore unrelated events
  const pendingSessionKeyRef = useRef<string | null>(null)
  // Track thread ID auto-created for 'question' captures
  const questionThreadIdRef = useRef<string | null>(null)

  // Listen for agent note coming back for pending capture
  useEffect(() => {
    if (connectionState !== 'connected') return

    const handler = (event: OcEvent): void => {
      if (event.event !== 'chat') return
      const payload = (event.payload ?? {}) as Record<string, unknown>
      if (payload.state !== 'final') return
      if (!pendingCaptureIdRef.current) return
      // Ignore events from other sessions (e.g. landscape generation)
      if (pendingSessionKeyRef.current && payload.sessionKey !== pendingSessionKeyRef.current) return

      const message = payload.message as
        | { content?: Array<{ type: string; text?: string }> }
        | undefined
      const rawText = message?.content?.[0]?.text ?? ''
      if (!rawText) return

      // Try to parse structured JSON response {note, holdingNote, thread, resolvedThreadIds}
      let note = rawText
      let threadData: { title: string; holdingNote: string } | null = null
      let resolvedIds: string[] = []
      let updatedHoldingNote: string | null | undefined = undefined
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as {
            note?: string
            holdingNote?: string | null
            thread?: { title: string; holdingNote: string } | null
            resolvedThreadIds?: string[]
          }
          if (parsed.note) note = parsed.note
          if ('holdingNote' in parsed) updatedHoldingNote = parsed.holdingNote
          if (parsed.thread?.title && parsed.thread?.holdingNote) {
            threadData = parsed.thread
          }
          if (Array.isArray(parsed.resolvedThreadIds)) {
            // Validate: only accept IDs that actually exist in the current thread list
            const currentThreadIds = new Set(useAgentStore.getState().threads.map((t) => t.id))
            resolvedIds = parsed.resolvedThreadIds.filter((id) => currentThreadIds.has(id))
          }
        } catch {
          // Not JSON — use raw text as note
        }
      }

      updateCaptureNote(pendingCaptureIdRef.current, note)
      // For question captures: update the auto-created thread's holdingNote
      if (questionThreadIdRef.current) {
        if (typeof updatedHoldingNote === 'string') {
          updateThreadNote(questionThreadIdRef.current, updatedHoldingNote)
        }
        questionThreadIdRef.current = null
      }
      if (threadData) {
        addThread({ title: threadData.title, holdingNote: threadData.holdingNote })
      }
      for (const id of resolvedIds) {
        closeThread(id)
      }
      pendingCaptureIdRef.current = null
      pendingSessionKeyRef.current = null
    }

    gatewayClient.on('*', handler)
    return () => gatewayClient.off('*', handler)
  }, [connectionState, updateCaptureNote, updateThreadNote, addThread, closeThread])

  const handleSend = useCallback(async (): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    setSending(true)
    setText('')

    // Add capture entry (agentNote starts null)
    addRawCapture({ text: trimmed, type, agentNote: null })
    const currentCaptures = useAgentStore.getState().rawCaptures
    const captureId = currentCaptures[0]?.id ?? null
    pendingCaptureIdRef.current = captureId

    // Action type also queues a local task
    if (type === 'action') {
      addTask(trimmed)
    }

    // Question type: auto-create a thread immediately (the question IS the thread)
    if (type === 'question') {
      const shortTitle = trimmed.length > 60 ? trimmed.slice(0, 57) + '…' : trimmed
      const threadId = addThread({ title: shortTitle, holdingNote: 'Procesando…' })
      questionThreadIdRef.current = threadId
    }

    // Send to agent with type-appropriate prompt
    if (connectionState === 'connected') {
      const sessionKey = `agent:main:capture-${crypto.randomUUID()}`
      pendingSessionKeyRef.current = sessionKey

      // Include open threads so the agent can close the ones this capture resolves
      const openThreads = useAgentStore.getState().threads
      const threadContext = openThreads.length > 0
        ? `\n\nHilos abiertos (preguntas que el agente sostiene):\n${openThreads.map((t) => `  - id: "${t.id}", esperando: "${t.holdingNote}"`).join('\n')}\n`
        : ''

      let structuredMessage: string
      if (type === 'thought') {
        // Thought: passive capture only — agent acknowledges, no tool calls, no actions
        structuredMessage =
          `Este es un pensamiento del usuario para capturar en contexto.\n` +
          `Contenido: "${trimmed}"${threadContext}\n\n` +
          `Responde SOLO con JSON válido (sin markdown):\n` +
          `{"note":"Una frase breve reconociendo el pensamiento.","thread":null,"resolvedThreadIds":[]}\n` +
          `Reglas:\n` +
          `- No ejecutes acciones ni llames herramientas.\n` +
          `- "thread": null a menos que el pensamiento revele ambigüedad GENUINA que requiera input del usuario.\n` +
          `- "resolvedThreadIds": vacío a menos que este texto responda directamente un holdingNote abierto.`
      } else if (type === 'question') {
        // Question: agent answers and helps think, tools allowed, updates auto-created thread
        const questionThreadId = questionThreadIdRef.current ?? ''
        structuredMessage =
          `El usuario tiene una pregunta o solicitud: "${trimmed}"${threadContext}\n\n` +
          `Antes de responder, llama las herramientas necesarias para ejecutar la solicitud u obtener los datos.\n` +
          `Usa acciones Composio (GMAIL_SEND_EMAIL, GMAIL_FETCH_EMAILS, GOOGLECALENDAR_CREATE_EVENT, GOOGLECALENDAR_EVENTS_LIST)\n` +
          `o attacca-tools (ATTACCA_TRELLO_BOARDS_AND_CARDS, ATTACCA_CALENDAR_EVENTS) según corresponda.\n\n` +
          `Responde SOLO con JSON válido (sin markdown):\n` +
          `{"note":"Qué hiciste o encontraste — resultados, no intenciones.","holdingNote":"Qué sigues esperando del usuario (null si resuelto).","resolvedThreadIds":[]}\n` +
          `Reglas:\n` +
          `- "holdingNote": escribe en primera persona qué necesitas aún del usuario. null si la pregunta quedó completamente resuelta.\n` +
          `- "resolvedThreadIds": incluye el ID "${questionThreadId}" si la pregunta fue completamente resuelta.`
      } else {
        // Action: agent executes using tools, creates PM task if relevant
        structuredMessage =
          `El usuario quiere que ejecutes esta acción.\n` +
          `Contenido: "${trimmed}"${threadContext}\n\n` +
          `Ejecuta la acción usando las herramientas disponibles:\n` +
          `- Si involucra tareas/proyectos: crea la tarea en la PM tool conectada (Trello, ClickUp, Asana).\n` +
          `- Si involucra email/calendario: usa las acciones Composio (GMAIL_SEND_EMAIL, GOOGLECALENDAR_CREATE_EVENT, etc.).\n` +
          `- Usa attacca-tools (ATTACCA_TRELLO_BOARDS_AND_CARDS, ATTACCA_CALENDAR_EVENTS) para consultar contexto si necesitas.\n\n` +
          `Responde SOLO con JSON válido (sin markdown):\n` +
          `{"note":"Qué ejecutaste y el resultado.","thread":null,"resolvedThreadIds":[]}\n` +
          `Reglas:\n` +
          `- "thread": null a menos que la acción revele ambigüedad que requiera input antes de ejecutar.\n` +
          `- "resolvedThreadIds": incluye IDs solo si el contenido resuelve explícitamente un thread abierto.`
      }
      try {
        await gatewayClient.rpc('chat.send', {
          sessionKey,
          message: structuredMessage,
          idempotencyKey: crypto.randomUUID()
        })
      } catch {
        if (captureId) {
          updateCaptureNote(captureId, 'Could not reach agent.')
          pendingCaptureIdRef.current = null
          pendingSessionKeyRef.current = null
        }
      }
    } else {
      if (captureId) {
        updateCaptureNote(captureId, 'Agent not connected — queued locally.')
        pendingCaptureIdRef.current = null
        pendingSessionKeyRef.current = null
      }
    }

    setSending(false)
    textareaRef.current?.focus()
  }, [text, type, sending, connectionState, addRawCapture, addTask, addThread, updateCaptureNote, textareaRef])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleEmergencyStop = async (): Promise<void> => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    emergencyStop()
    window.api.telemetry.emit('trust.kill_switch.activated', {})
    if (connectionState === 'connected') {
      try { await gatewayClient.rpc('agent.stop') } catch { /* best effort */ }
    }
  }

  const recentCaptures = rawCaptures.slice(0, 20)
  const recentActivity = activityFeed.slice(-3).reverse()

  return (
    <div className="flex h-full flex-col overflow-hidden border-l border-border bg-background">

      {/* ── Capture zone ── */}
      <div className="shrink-0 border-b border-border p-4">
        <div className="mb-2.5 flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
            Capture
          </span>
          <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/50">
            ⌘K
          </span>
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What's on your mind right now..."
          className={cn(
            'h-[80px] w-full resize-none rounded-md border border-border bg-[#151618] px-3 py-[10px]',
            'font-sans text-[12.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/50',
            'outline-none focus:border-border focus:ring-1 focus:ring-ring/30'
          )}
        />

        <div className="mt-2 flex items-center justify-between">
          {/* Type pills */}
          <div className="flex gap-1">
            {(['thought', 'action', 'question'] as CaptureType[]).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={cn(
                  'rounded-full border px-[7px] py-[3px] font-mono text-[9px] transition-colors',
                  type === t
                    ? ACTIVE_PILL_COLORS[t]
                    : 'border-border text-muted-foreground/60 hover:text-muted-foreground'
                )}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className={cn(
              'flex h-[26px] w-[26px] items-center justify-center rounded',
              'bg-blue-500 text-white transition-opacity',
              'disabled:opacity-30'
            )}
          >
            {sending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 8h12M10 4l4 4-4 4" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* ── Recent captures ── */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="mb-2.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
          Recent captures
        </p>

        {recentCaptures.length === 0 ? (
          <p className="text-xs text-muted-foreground/50">
            Your captures will appear here.
          </p>
        ) : (
          <div>
            {recentCaptures.map((entry: CaptureEntry) => (
              <div key={entry.id} className="cursor-pointer border-b border-border/40 py-[9px] last:border-b-0 hover:bg-muted/10">
                <div className="mb-[3px] flex items-center gap-1.5">
                  <span className="font-mono text-[9px] text-muted-foreground/50">
                    {formatCaptureTime(entry.timestamp)}
                  </span>
                  <span className={cn('rounded-[2px] px-[5px] py-[1px] font-mono text-[8px]', TYPE_BADGE_COLORS[entry.type])}>
                    {entry.type}
                  </span>
                </div>
                <p className="text-[12px] leading-[1.4] text-muted-foreground">{entry.text}</p>
                {entry.agentNote !== null ? (
                  <p className="mt-[5px] flex items-start gap-1 text-[10.5px] italic text-muted-foreground/60">
                    <span className="shrink-0 text-blue-400 not-italic">↳</span>
                    {entry.agentNote}
                  </p>
                ) : (
                  <p className="mt-[5px] flex items-center gap-1 text-[10.5px] text-muted-foreground/40">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    Processing…
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Activity strip ── */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-2.5">
        <p className="mb-1.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
          Agent activity
        </p>
        {recentActivity.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/40">Monitoring…</p>
        ) : (
          <div className="flex flex-col gap-1">
            {recentActivity.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2 text-[11px] text-muted-foreground">
                <div className={cn('mt-[5px] h-[5px] w-[5px] shrink-0 rounded-full', DOT_COLORS[entry.type] ?? 'bg-muted-foreground/50')} />
                <span className="w-10 shrink-0 font-mono text-[9px] text-muted-foreground/50">
                  {formatTime(entry.timestamp)}
                </span>
                <span className="line-clamp-1">{entry.description}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Emergency stop ── */}
      <div className="shrink-0 flex items-center justify-between border-t border-border px-4 py-2.5">
        <button
          onClick={handleEmergencyStop}
          className={cn(
            'flex items-center gap-1.5 rounded border px-3 py-1.5 font-mono text-[10px] tracking-wide transition-all',
            confirming
              ? 'animate-pulse border-red-500 bg-red-500 text-white'
              : 'border-red-500/30 text-red-500 hover:border-red-500/60 dark:text-red-400'
          )}
        >
          <OctagonX className="h-3 w-3" />
          {confirming ? 'CONFIRM STOP?' : 'Stop agent'}
        </button>
        <span className="font-mono text-[10px] text-muted-foreground/40">
          OpenClaw · local
        </span>
      </div>
    </div>
  )
}
