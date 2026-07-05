import { useState, useEffect, useRef, useCallback } from 'react'
import { useActivityStore } from '@/stores/activity-store'
import { useCaptureStore, type CaptureEntry } from '@/stores/capture-store'
import { useTaskStore } from '@/stores/task-store'
import { useTodayStore } from '@/stores/today-store'
import { useSettingsStore } from '@/stores/settings-store'
import { Loader2, OctagonX, Archive, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'

type CaptureType = 'thought' | 'action' | 'question'

// Badge colors for capture list entries
const TYPE_BADGE_COLORS: Record<CaptureType, string> = {
  thought: 'bg-att-blue/10 text-att-blue',
  action: 'bg-att-green/10 text-att-green',
  question: 'bg-att-orange/10 text-att-orange'
}

// Active pill colors for the type selector (per-type, not always blue)
const ACTIVE_PILL_COLORS: Record<CaptureType, string> = {
  thought: 'border-att-blue/60 bg-att-blue/10 text-att-blue',
  action: 'border-att-green/60 bg-att-green/10 text-att-green',
  question: 'border-att-orange/60 bg-att-orange/10 text-att-orange'
}

const DOT_COLORS: Record<string, string> = {
  info: 'bg-muted-foreground/50',
  action: 'bg-att-green',
  tool_call: 'bg-att-blue animate-pulse',
  tool_result: 'bg-att-green',
  error: 'bg-att-red',
  message: 'bg-foreground/60'
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
  captureRef
}: {
  captureRef?: React.RefObject<HTMLTextAreaElement | null>
}): React.JSX.Element {
  const { t } = useTranslation()
  const activityFeed = useActivityStore((s) => s.activityFeed)
  const rawCaptures = useCaptureStore((s) => s.rawCaptures)
  const addRawCapture = useCaptureStore((s) => s.addRawCapture)
  const updateCaptureNote = useCaptureStore((s) => s.updateCaptureNote)
  const setCaptureConfirmation = useCaptureStore((s) => s.setCaptureConfirmation)
  const deleteCapture = useCaptureStore((s) => s.deleteCapture)
  const archiveCapture = useCaptureStore((s) => s.archiveCapture)
  const addTask = useTaskStore((s) => s.addTask)
  const emergencyStop = useTaskStore((s) => s.emergencyStop)
  const addThread = useTodayStore((s) => s.addThread)
  const closeThread = useTodayStore((s) => s.closeThread)
  const updateThreadNote = useTodayStore((s) => s.updateThreadNote)
  const userTimezone = useSettingsStore((s) => s.userTimezone)

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
    const unsub = window.api.agent.onFinal((data) => {
      if (!pendingCaptureIdRef.current) return
      // Ignore events from other sessions (e.g. landscape generation)
      if (pendingSessionKeyRef.current && data.sessionKey !== pendingSessionKeyRef.current)
        return

      const rawText = data.message
      if (!rawText) return

      // Try to parse structured JSON response {note, holdingNote, thread, resolvedThreadIds, pendingConfirmation}
      let note = rawText
      let threadData: { title: string; holdingNote: string } | null = null
      let resolvedIds: string[] = []
      let updatedHoldingNote: string | null | undefined = undefined
      let pendingConfirmation: string | null = null
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as {
            note?: string
            holdingNote?: string | null
            thread?: { title: string; holdingNote: string } | null
            resolvedThreadIds?: string[]
            pendingConfirmation?: string | null
          }
          if (parsed.note) note = parsed.note
          if ('holdingNote' in parsed) updatedHoldingNote = parsed.holdingNote
          if (parsed.thread?.title && parsed.thread?.holdingNote) {
            threadData = parsed.thread
          }
          if (Array.isArray(parsed.resolvedThreadIds)) {
            // Validate: only accept IDs that actually exist in the current thread list
            const currentThreadIds = new Set(useTodayStore.getState().threads.map((t) => t.id))
            resolvedIds = parsed.resolvedThreadIds.filter((id) => currentThreadIds.has(id))
          }
          if (parsed.pendingConfirmation) pendingConfirmation = parsed.pendingConfirmation
        } catch {
          // Not JSON — use raw text as note
        }
      }

      updateCaptureNote(pendingCaptureIdRef.current, note)
      // Store or clear pendingConfirmation for this capture
      setCaptureConfirmation(pendingCaptureIdRef.current, pendingConfirmation)
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
    })

    // Agent errors are emitted as events, not thrown from agent.send — without
    // this, an API failure leaves the capture spinner running forever.
    const unsubError = window.api.agent.onError((data) => {
      if (!pendingCaptureIdRef.current) return
      if (pendingSessionKeyRef.current && data.sessionKey !== pendingSessionKeyRef.current) return

      updateCaptureNote(pendingCaptureIdRef.current, data.error || t('capturePanel.error_reach'))
      if (questionThreadIdRef.current) {
        updateThreadNote(questionThreadIdRef.current, data.error || t('capturePanel.error_reach'))
        questionThreadIdRef.current = null
      }
      pendingCaptureIdRef.current = null
      pendingSessionKeyRef.current = null
    })

    return () => {
      unsub()
      unsubError()
    }
  }, [updateCaptureNote, updateThreadNote, addThread, closeThread, setCaptureConfirmation, t])

  const handleSend = useCallback(async (): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    setSending(true)
    setText('')

    // Generate session key upfront so it can be stored in the capture entry
    const sessionKey = `agent:main:capture-${crypto.randomUUID()}`

    // Add capture entry (agentNote starts null, sessionKey stored for confirmation flow)
    addRawCapture({ text: trimmed, type, sourceType: 'landscape-chat', agentNote: null, sessionKey })
    const currentCaptures = useCaptureStore.getState().rawCaptures
    const captureId = currentCaptures[0]?.id ?? null
    pendingCaptureIdRef.current = captureId

    // Action type also queues a local task, bound to this capture's session so
    // only THIS agent turn's final/error event completes it
    if (type === 'action') {
      addTask(trimmed, sessionKey)
    }

    // Question type: auto-create a thread immediately (the question IS the thread)
    if (type === 'question') {
      const shortTitle = trimmed.length > 60 ? trimmed.slice(0, 57) + '…' : trimmed
      const threadId = addThread({ title: shortTitle, holdingNote: 'Procesando…' })
      questionThreadIdRef.current = threadId
    }

    // Send to agent with type-appropriate prompt
    pendingSessionKeyRef.current = sessionKey

    // Include open threads so the agent can close the ones this capture resolves
      const openThreads = useTodayStore.getState().threads
      const threadContext =
        openThreads.length > 0
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
          `El usuario tiene una pregunta o solicitud: "${trimmed}"\n` +
          `Zona horaria del usuario: ${userTimezone}${threadContext}\n\n` +
          `Antes de responder, usa tus herramientas locales si ayudan:\n` +
          `- memory_search: recupera contexto, preferencias o decisiones previas del usuario relevantes a la pregunta.\n` +
          `- memory_save: guarda información nueva importante que el usuario haya revelado.\n` +
          `- NO tienes herramientas externas (email, calendario, Trello, etc.). Si la pregunta requiere una acción externa, dilo claramente y sugiere el siguiente paso manual.\n\n` +
          `Responde SOLO con JSON válido (sin markdown):\n` +
          `{"note":"Qué hiciste o encontraste — resultados, no intenciones.","holdingNote":"Qué sigues esperando del usuario (null si resuelto).","resolvedThreadIds":[]}\n` +
          `Reglas:\n` +
          `- "holdingNote": escribe en primera persona qué necesitas aún del usuario. null si la pregunta quedó completamente resuelta.\n` +
          `- "resolvedThreadIds": incluye el ID "${questionThreadId}" si la pregunta fue completamente resuelta.`
      } else {
        // Action: agent proposes + confirms before executing high-risk actions
        structuredMessage =
          `El usuario quiere que ejecutes esta acción.\n` +
          `Contenido: "${trimmed}"\n` +
          `Zona horaria del usuario: ${userTimezone}${threadContext}\n\n` +
          `REGLAS DE EJECUCIÓN:\n` +
          `1. HERRAMIENTAS LOCALES — Solo tienes memory_search y memory_save (memoria local del usuario). NO tienes acceso a email, calendario, Slack, Trello ni otros servicios externos.\n` +
          `2. ACCIONES EXTERNAS — Si la acción requiere un servicio externo, NO simules ejecutarla: describe qué haría falta y usa "pendingConfirmation" solo para acciones que tú sí puedas realizar.\n` +
          `3. ALCANCE MÍNIMO — Llama solo las herramientas directamente relevantes; guarda en memoria compromisos o preferencias nuevas del usuario.\n\n` +
          `Responde SOLO con JSON válido (sin markdown):\n` +
          `{"note":"Resumen breve de lo propuesto o ejecutado.","pendingConfirmation":"Descripción exacta de la acción que vas a tomar — solo incluye este campo si estás esperando confirmación antes de ejecutar, de lo contrario omítelo o pon null.","thread":null,"resolvedThreadIds":[]}\n` +
          `Reglas:\n` +
          `- "pendingConfirmation": incluye SOLO cuando hayas propuesto una acción y estés esperando que el usuario confirme antes de ejecutar. Debe describir exactamente qué vas a hacer (destinatario, asunto, hora, etc.). Omite el campo o pon null si ya ejecutaste o no hay nada pendiente.\n` +
          `- "thread": null a menos que la acción revele ambigüedad que requiera input antes de ejecutar.\n` +
          `- "resolvedThreadIds": incluye IDs solo si el contenido resuelve explícitamente un thread abierto.`
      }
      try {
        // agent:chat:send never rejects — failures come back as {success:false}
        const res = (await window.api.agent.send(
          sessionKey,
          structuredMessage,
          crypto.randomUUID()
        )) as { success?: boolean; error?: string } | undefined
        if (res && res.success === false) throw new Error(res.error || 'Agent send failed')
        window.api.telemetry.emit('agent.chat.sent', { source: 'capture_panel' })
      } catch {
        if (captureId) {
          updateCaptureNote(captureId, t('capturePanel.error_reach'))
          pendingCaptureIdRef.current = null
          pendingSessionKeyRef.current = null
        }
    }

    setSending(false)
    textareaRef.current?.focus()
  }, [
    text,
    type,
    sending,
    addRawCapture,
    addTask,
    addThread,
    updateCaptureNote,
    textareaRef,
    t
  ])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleConfirm = async (captureId: string, captureSessionKey: string): Promise<void> => {
    // Re-activate pending state so the event handler updates this capture's note
    pendingCaptureIdRef.current = captureId
    pendingSessionKeyRef.current = captureSessionKey
    // Clear confirmation UI immediately (spinner will show again via agentNote null logic isn't needed — note is already set)
    setCaptureConfirmation(captureId, null)
    try {
      await window.api.agent.send(
        captureSessionKey,
        'Confirmado, procede con la acción exactamente como la propusiste.',
        crypto.randomUUID()
      )
    } catch {
      pendingCaptureIdRef.current = null
      pendingSessionKeyRef.current = null
    }
  }

  const handleCancel = (captureId: string, captureSessionKey: string): void => {
    setCaptureConfirmation(captureId, null)
    updateCaptureNote(captureId, 'Acción cancelada.')
    window.api.agent
      .send(captureSessionKey, 'Cancelado, no ejecutes la acción.', crypto.randomUUID())
      .catch(() => {
        /* best effort */
      })
  }

  const handleEmergencyStop = async (): Promise<void> => {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setConfirming(false)
    emergencyStop()
    window.api.telemetry.emit('trust.kill_switch.activated', {})
    try {
      await window.api.agent.stop('*')
    } catch {
      /* best effort */
    }
  }

  const recentCaptures = rawCaptures.filter((c) => !c.archived).slice(0, 20)
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

        {/* Type pills — above textarea */}
        <div className="mb-2 flex gap-1">
          {(['thought', 'action', 'question'] as CaptureType[]).map((ct) => (
            <button
              key={ct}
              onClick={() => setType(ct)}
              className={cn(
                'rounded-full border px-[7px] py-[3px] font-mono text-[9px] transition-colors',
                type === ct
                  ? ACTIVE_PILL_COLORS[ct]
                  : 'border-border text-muted-foreground/60 hover:text-muted-foreground'
              )}
            >
              {t(`capturePanel.type.${ct}`)}
            </button>
          ))}
        </div>

        <div className="relative">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('capturePanel.placeholder')}
            className={cn(
              'h-[80px] w-full resize-none rounded-md border border-border bg-att-surface px-3 py-[10px] pr-10',
              'font-sans text-[12.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/50',
              'outline-none focus:border-border focus:ring-1 focus:ring-ring/30'
            )}
          />

          {/* Send button — inside textarea, bottom-right */}
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className={cn(
              'absolute bottom-2 right-2 flex h-[26px] w-[26px] items-center justify-center rounded',
              'bg-att-blue text-white transition-opacity',
              'disabled:opacity-30'
            )}
          >
            {sending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <svg
                width="12"
                height="12"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M2 8h12M10 4l4 4-4 4" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* ── Recent captures ── */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="mb-2.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
          {t('capturePanel.recents')}
        </p>

        {recentCaptures.length === 0 ? (
          <p className="text-xs text-muted-foreground/50">{t('capturePanel.empty')}</p>
        ) : (
          <div>
            {recentCaptures.map((entry: CaptureEntry) => (
              <div
                key={entry.id}
                className="group cursor-pointer border-b border-border/40 py-[9px] last:border-b-0 hover:bg-muted/10"
              >
                <div className="mb-[3px] flex items-center gap-1.5">
                  <span className="font-mono text-[9px] text-muted-foreground/50">
                    {formatCaptureTime(entry.timestamp)}
                  </span>
                  <span
                    className={cn(
                      'rounded-[2px] px-[5px] py-[1px] font-mono text-[8px]',
                      TYPE_BADGE_COLORS[entry.type]
                    )}
                  >
                    {entry.type}
                  </span>
                  <span className="flex-1" />
                  <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => { e.stopPropagation(); archiveCapture(entry.id) }}
                      title="Archive"
                      className="rounded p-0.5 text-muted-foreground/40 hover:bg-muted/30 hover:text-muted-foreground"
                    >
                      <Archive className="h-2.5 w-2.5" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteCapture(entry.id) }}
                      title="Delete"
                      className="rounded p-0.5 text-muted-foreground/40 hover:bg-att-red/10 hover:text-att-red"
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  </span>
                </div>
                <p className="text-[12px] leading-[1.4] text-muted-foreground">{entry.text}</p>
                {entry.agentNote !== null ? (
                  <>
                    <p className="mt-[5px] flex items-start gap-1 text-[10.5px] italic text-muted-foreground/60">
                      <span className="shrink-0 text-att-blue not-italic">↳</span>
                      {entry.agentNote}
                    </p>
                    {entry.pendingConfirmation && entry.sessionKey && (
                      <div className="mt-2 rounded-md border border-att-orange/30 bg-att-orange/5 p-2.5">
                        <p className="mb-2 text-[10.5px] text-att-orange/90">
                          {entry.pendingConfirmation}
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleConfirm(entry.id, entry.sessionKey!)}
                            className="flex-1 rounded border border-att-green/40 bg-att-green/10 px-2 py-1 font-mono text-[9px] text-att-green transition-colors hover:bg-att-green/20"
                          >
                            ✓ {t('capturePanel.confirm_action')}
                          </button>
                          <button
                            onClick={() => handleCancel(entry.id, entry.sessionKey!)}
                            className="flex-1 rounded border border-border px-2 py-1 font-mono text-[9px] text-muted-foreground/60 transition-colors hover:bg-muted/20"
                          >
                            ✗ {t('capturePanel.cancel_action')}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="mt-[5px] flex items-center gap-1 text-[10.5px] text-muted-foreground/40">
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                    {t('capturePanel.processing')}
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
          {t('capturePanel.activity')}
        </p>
        {recentActivity.length === 0 ? (
          <p className="text-[11px] text-muted-foreground/40">{t('capturePanel.monitoring')}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {recentActivity.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-2 text-[11px] text-muted-foreground"
              >
                <div
                  className={cn(
                    'mt-[5px] h-[5px] w-[5px] shrink-0 rounded-full',
                    DOT_COLORS[entry.type] ?? 'bg-muted-foreground/50'
                  )}
                />
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
              ? 'animate-pulse border-att-red bg-att-red text-white'
              : 'border-att-red/30 text-att-red hover:border-att-red/60 dark:text-att-red'
          )}
        >
          <OctagonX className="h-3 w-3" />
          {confirming ? t('capturePanel.confirm_stop') : t('capturePanel.stop_agent')}
        </button>
        <span className="font-mono text-[10px] text-muted-foreground/40">
          {t('capturePanel.footer')}
        </span>
      </div>
    </div>
  )
}
