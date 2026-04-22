import { useState, useRef, useEffect, useCallback } from 'react'
import { useAgentStore } from '@/stores/agent-store'
import { Upload, Link, FileText, MessageSquare, Check, Clock, X, Send, ListTodo } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'
import { TranscriptUpload } from './TranscriptUpload'

// ── Types ─────────────────────────────────────────────────────────────────────

type CaptureState = 'idle' | 'processing' | 'review'
type SourceType = 'text' | 'url' | 'file' | 'transcript'

interface ActionItem {
  text: string
  owner?: string | null
  checked: boolean
}

type CaptureCategory = 'task' | 'knowledge' | 'decision'

interface CaptureResult {
  category: CaptureCategory
  summary: string
  actionItems: ActionItem[]
  decisions: string[]
  openQuestions: string[]
  keyPoints: string[]
  concepts?: string[]
  takeaways?: string[]
  entities: {
    people: string[]
    projects: string[]
    dates: string[]
  }
}

interface RecentCapture {
  id: string
  sourceType: SourceType
  title: string
  timestamp: number
  result: CaptureResult
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STEPS_TEXT_URL = [
  'Leyendo contenido...',
  'Detectando intención...',
  'Extrayendo entidades clave...',
  'Buscando conexiones...',
  'Estructurando resultados...'
]

const FILE_TYPES: Record<string, string> = {
  text: '',
  url: '',
  file: '.pdf,.docx,.txt,.md,.csv'
}

const STORAGE_KEY = 'attacca:captures:recent'
const MAX_RECENTS = 20

function loadRecents(): RecentCapture[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as RecentCapture[]
  } catch {
    return []
  }
}

function saveRecents(entries: RecentCapture[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_RECENTS)))
}

function relativeTime(
  ts: number,
  t: (key: string, params?: Record<string, string | number>) => string
): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return t('capture.time.now')
  if (mins < 60) return t('capture.time.minutes', { n: mins })
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return t('capture.time.hours', { n: hrs })
  const days = Math.floor(hrs / 24)
  if (days === 1) return t('capture.time.yesterday')
  return t('capture.time.days', { n: days })
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SourcePill({
  type,
  active,
  onClick
}: {
  type: SourceType
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const icon = {
    text: <MessageSquare className="h-3 w-3" />,
    url: <Link className="h-3 w-3" />,
    file: <Upload className="h-3 w-3" />,
    transcript: <FileText className="h-3 w-3" />
  }[type]

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1.5 text-[11px] font-medium transition-all duration-[100ms]',
        active
          ? 'border-att-blue bg-att-blue/12 text-att-blue'
          : 'border-att-divider bg-transparent text-muted-foreground hover:border-att-surface-raised hover:text-foreground'
      )}
    >
      {icon}
      {t(`capture.source.${type}`)}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function CaptureView(): React.JSX.Element {
  const { t } = useTranslation()
  const rawCaptures = useAgentStore((s) => s.rawCaptures)
  const addLocalTask = useAgentStore((s) => s.addLocalTask)
  const addKBEntry = useAgentStore((s) => s.addKBEntry)

  const [captureState, setCaptureState] = useState<CaptureState>('idle')
  const [sourceType, setSourceType] = useState<SourceType>('text')

  // Idle inputs
  const [textInput, setTextInput] = useState('')
  const [urlInput, setUrlInput] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [fileName, setFileName] = useState('')

  // Processing
  const [processingStep, setProcessingStep] = useState(0)
  const STEPS_TEXT_URL_T = [
    t('capture.steps_text.0'),
    t('capture.steps_text.1'),
    t('capture.steps_text.2'),
    t('capture.steps_text.3'),
    t('capture.steps_text.4')
  ]
  const STEPS_FILE_T = [
    t('capture.steps_file.0'),
    t('capture.steps_file.1'),
    t('capture.steps_file.2'),
    t('capture.steps_file.3'),
    t('capture.steps_file.4')
  ]
  const steps = sourceType === 'text' || sourceType === 'url' ? STEPS_TEXT_URL_T : STEPS_FILE_T

  // Review
  const [result, setResult] = useState<CaptureResult | null>(null)
  const [actionItems, setActionItems] = useState<ActionItem[]>([])
  const [savedToast, setSavedToast] = useState(false)

  // Chat (review state)
  const [capturedContent, setCapturedContent] = useState('')
  const [chatMessages, setChatMessages] = useState<
    Array<{ role: 'user' | 'assistant'; text: string }>
  >([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)

  // Recents
  const [recents, setRecents] = useState<RecentCapture[]>(loadRecents)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pendingSessionRef = useRef<string | null>(null)
  const pendingChatSessionRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const chatBottomRef = useRef<HTMLDivElement>(null)
  const sourceTypeRef = useRef<SourceType>(sourceType)
  sourceTypeRef.current = sourceType

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages, chatLoading])

  // Agent event listener — registered once
  useEffect(() => {
    const unsub = window.api.agent.onFinal((data) => {
      const { sessionKey, message: rawText } = data

      // Chat Q&A response
      if (sessionKey && sessionKey === pendingChatSessionRef.current) {
        pendingChatSessionRef.current = null
        setChatLoading(false)
        setChatMessages((prev) => [...prev, { role: 'assistant', text: rawText }])
        return
      }

      // Initial analysis response
      if (sessionKey !== pendingSessionRef.current) return

      pendingSessionRef.current = null
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setProcessingStep(STEPS_TEXT_URL.length)

      const jsonMatch = rawText.match(/\{[\s\S]*\}/)

      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as CaptureResult
          // Default category for backward compatibility
          if (!parsed.category) parsed.category = parsed.actionItems?.length > 0 ? 'task' : 'knowledge'
          const items = (parsed.actionItems ?? []).map((a) => ({ ...a, checked: false }))
          setResult(parsed)
          setActionItems(items)
          setTimeout(() => setCaptureState('review'), 500)
        } catch {
          setCaptureState('idle')
        }
      } else {
        setCaptureState('idle')
      }
    })

    return unsub
  }, [])

  const startCapture = useCallback(
    async (content: string, _title: string, typeLabelOverride?: string): Promise<void> => {
      const type = sourceTypeRef.current

      if (captureState !== 'processing') {
        setCaptureState('processing')
      }
      setProcessingStep(0)
      setResult(null)
      setActionItems([])
      setCapturedContent(content)
      setChatMessages([])
      setChatInput('')

      window.api.telemetry.emit('capture.started', { sourceType: type })

      timerRef.current = setInterval(() => {
        setProcessingStep((prev) => Math.min(prev + 1, STEPS_TEXT_URL.length - 1))
      }, 5000)

      const sessionKey = `agent:main:capture-${crypto.randomUUID()}`
      pendingSessionRef.current = sessionKey

      const typeLabel =
        typeLabelOverride ??
        (type === 'text' ? 'nota/texto' : type === 'url' ? 'artículo/página web' : 'archivo')

      const prompt = `Procesa el siguiente ${typeLabel}. Primero clasifica el contenido, luego extrae información según su tipo.

PASO 1 — Clasifica en UNA categoría:
- "task": contiene compromisos, acciones por hacer, asignaciones, deadlines (reuniones, minutas, emails de trabajo)
- "knowledge": contiene conceptos, teorías, frameworks, tutoriales, artículos, aprendizajes (artículos, notas de estudio, documentación)
- "decision": contiene análisis de opciones, trade-offs, evaluaciones, comparaciones (propuestas, reviews, estrategias)

PASO 2 — Devuelve SOLO JSON válido:
{
  "category": "task|knowledge|decision",
  "summary": "2-3 oraciones resumiendo el contenido principal",
  "actionItems": [{"text": "acción concreta", "owner": "nombre o null"}],
  "decisions": ["decisión confirmada o hecho establecido"],
  "openQuestions": ["pregunta sin resolver o tema pendiente"],
  "keyPoints": ["punto clave relevante"],
  "concepts": ["concepto, framework, o idea clave para recordar"],
  "takeaways": ["insight accionable o lección aprendida"],
  "entities": {
    "people": ["nombres de personas mencionadas"],
    "projects": ["proyectos o temas principales"],
    "dates": ["fechas o plazos mencionados"]
  }
}

Reglas por categoría:
- Si category="task": enfócate en actionItems y decisions. concepts/takeaways pueden estar vacíos.
- Si category="knowledge": enfócate en concepts, takeaways y keyPoints. actionItems vacío a menos que haya acciones explícitas.
- Si category="decision": enfócate en decisions, openQuestions y takeaways. actionItems solo si hay next steps concretos.

Reglas generales:
- actionItems: solo compromisos concretos con acción clara. Lista vacía si no hay.
- decisions: afirmaciones de finalidad, acuerdos confirmados. Lista vacía si no hay.
- concepts: ideas, frameworks, modelos mentales extraídos del contenido. Lista vacía si no aplica.
- takeaways: insights accionables — qué cambiaría en tu trabajo después de leer esto. Lista vacía si no aplica.
- keyPoints: 3-5 puntos más importantes del contenido.
- entities: extrae solo los que aparecen claramente en el texto.

Contenido:
${content}`

      try {
        await window.api.agent.send(sessionKey, prompt, sessionKey)
      } catch {
        pendingSessionRef.current = null
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        setCaptureState('idle')
      }
    },
    [captureState]
  )

  const [urlError, setUrlError] = useState<string | null>(null)

  const handleCapture = useCallback(async (): Promise<void> => {
    if (sourceType === 'text') {
      if (!textInput.trim()) return
      await startCapture(textInput, textInput.slice(0, 60))
    } else if (sourceType === 'url') {
      const trimmedUrl = urlInput.trim()
      if (!trimmedUrl) return
      setUrlError(null)
      setCaptureState('processing') // show processing UI immediately while we extract

      const extraction = await window.api.relay.extractUrl(trimmedUrl)
      if (!extraction.success || !extraction.text) {
        setCaptureState('idle')
        setUrlError(extraction.error ?? t('capture.url_error_default'))
        return
      }

      const typeLabel =
        extraction.type === 'youtube' ? 'transcripción de video YouTube' : 'artículo/página web'
      await startCapture(extraction.text, extraction.title ?? trimmedUrl, typeLabel)
    }
  }, [sourceType, textInput, urlInput, startCapture, t])

  const handleChatSend = useCallback(async (): Promise<void> => {
    const question = chatInput.trim()
    if (!question || chatLoading || !capturedContent) return

    setChatInput('')
    setChatMessages((prev) => [...prev, { role: 'user', text: question }])
    setChatLoading(true)

    const sessionKey = `agent:main:capture-chat-${crypto.randomUUID()}`
    pendingChatSessionRef.current = sessionKey

    const prompt = `Aquí está el contenido fuente:

${capturedContent.slice(0, 10000)}

Basándote únicamente en el contenido anterior, responde esta pregunta de forma concisa y directa:

${question}`

    try {
      await window.api.agent.send(sessionKey, prompt, sessionKey)
    } catch {
      pendingChatSessionRef.current = null
      setChatLoading(false)
      setChatMessages((prev) => [...prev, { role: 'assistant', text: t('capture.chat_error') }])
    }
  }, [chatInput, chatLoading, capturedContent, t])

  const handleFile = useCallback(
    async (file: File): Promise<void> => {
      setFileName(file.name)
      const text = await file.text()
      await startCapture(text, file.name)
    },
    [startCapture]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent): void => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files[0]
      if (file) void handleFile(file)
    },
    [handleFile]
  )

  const handleSave = useCallback(async (): Promise<void> => {
    if (!result || savedToast) return
    const titleRaw =
      (sourceType === 'text' ? textInput : sourceType === 'url' ? urlInput : fileName) || 'Captura'
    const id = crypto.randomUUID()
    const timestamp = Date.now()
    const entry: RecentCapture = {
      id,
      sourceType,
      title: titleRaw.slice(0, 80),
      timestamp,
      result: { ...result, actionItems }
    }

    // Persist to local recents (UI)
    setRecents((prev) => {
      const updated = [entry, ...prev]
      saveRecents(updated)
      return updated
    })

    // Persist to KB files on disk
    try {
      await window.api.kb.saveCapture({
        id,
        sourceType,
        title: titleRaw.slice(0, 80),
        content: sourceType === 'text' ? textInput : sourceType === 'url' ? urlInput : fileName,
        result: {
          summary: result.summary,
          actionItems: actionItems.map((a) => ({ text: a.text, owner: a.owner ?? undefined })),
          decisions: result.decisions,
          openQuestions: result.openQuestions,
          keyPoints: result.keyPoints,
          entities: result.entities
        },
        timestamp
      })
      // Also track in agent-store KB entries for the KB Manager view
      addKBEntry({
        title: titleRaw.slice(0, 80),
        sourceType: sourceType === 'text' || sourceType === 'url' ? 'capture' : 'transcript',
        sourceId: id,
        summary: result.summary,
        tags: [
          ...(result.entities?.projects ?? []).slice(0, 3),
          ...(result.entities?.people ?? []).slice(0, 3)
        ],
        folder: sourceType === 'transcript' ? 'Transcripts' : 'Captures'
      })
    } catch {
      // KB write failure is non-fatal — local recents already saved
    }

    window.api.telemetry.emit('capture.saved', {
      sourceType,
      hasActionItems: actionItems.length > 0,
      actionItemCount: actionItems.length
    })

    setSavedToast(true)
    setTimeout(() => {
      setSavedToast(false)
      setCaptureState('idle')
      setTextInput('')
      setUrlInput('')
      setFileName('')
    }, 1500)
  }, [result, savedToast, sourceType, textInput, urlInput, fileName, actionItems, addKBEntry])

  const handleDiscard = (): void => {
    window.api.telemetry.emit('capture.discarded', { sourceType })
    setCaptureState('idle')
    setResult(null)
    setActionItems([])
    setChatMessages([])
    setChatInput('')
    pendingChatSessionRef.current = null
  }

  const handleCancel = (): void => {
    pendingSessionRef.current = null
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setCaptureState('idle')
  }

  const canCapture =
    (sourceType === 'text' && textInput.trim().length > 0) ||
    (sourceType === 'url' && urlInput.trim().length > 0)

  // ── Content renderer for non-transcript source types ──────────────────────

  const renderContent = (): React.JSX.Element => {
    // ── REVIEW state ──────────────────────────────────────────────────────
    if (captureState === 'review' && result) {
      const sourceTitle =
        sourceType === 'text'
          ? textInput.slice(0, 60) + (textInput.length > 60 ? '...' : '')
          : sourceType === 'url'
            ? urlInput
            : fileName

      return (
        <div className="flex h-full overflow-hidden">
          {/* Main panel */}
          <div className="flex flex-1 flex-col overflow-y-auto p-6">
            {/* Back button + Header */}
            <button
              onClick={() => setCaptureState('idle')}
              className="mb-3 flex items-center gap-1 text-xs text-att-blue transition-colors hover:text-[#4a6be5]"
            >
              <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 4l-4 4 4 4" />
              </svg>
              Back to captures
            </button>
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-att-green/12">
                <Check className="h-3.5 w-3.5 text-att-green" strokeWidth={2.5} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">
                    {t('capture.ready_to_review')}
                  </p>
                  {result.category && (
                    <span className={cn(
                      'rounded px-1.5 py-0.5 font-mono text-[8px] uppercase',
                      result.category === 'task' ? 'bg-att-blue/12 text-att-blue'
                        : result.category === 'knowledge' ? 'bg-att-purple/12 text-att-purple'
                        : 'bg-att-orange/12 text-att-orange'
                    )}>
                      {result.category}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t(`capture.source.${sourceType}`)} · {sourceTitle}
                </p>
              </div>
            </div>

            {/* Summary */}
            <section className="mb-5">
              <h3 className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground/60">
                {t('capture.summary')}
              </h3>
              <p className="text-sm leading-relaxed text-foreground/80">{result.summary}</p>
            </section>

            {/* Action items */}
            {actionItems.length > 0 && (
              <section className="mb-5">
                <h3 className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground/60">
                  {t('capture.action_items', { count: actionItems.length })}
                </h3>
                <div className="flex flex-col gap-1.5">
                  {actionItems.map((item, i) => (
                    <div key={i} className="group flex items-start gap-2.5">
                      <label className="flex flex-1 cursor-pointer items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={item.checked}
                          onChange={(e) =>
                            setActionItems((prev) =>
                              prev.map((a, j) => (j === i ? { ...a, checked: e.target.checked } : a))
                            )
                          }
                          className="mt-0.5 shrink-0 accent-att-blue"
                        />
                        <span
                          className={cn(
                            'text-sm leading-snug',
                            item.checked ? 'text-muted-foreground/60 line-through' : 'text-foreground'
                          )}
                        >
                          {item.text}
                          {item.owner && (
                            <span className="ml-1.5 text-[10px] text-att-blue">@{item.owner}</span>
                          )}
                        </span>
                      </label>
                      <button
                        onClick={() => addLocalTask({
                          description: item.text + (item.owner ? ` (@${item.owner})` : ''),
                          sourceType: 'capture'
                        })}
                        className="shrink-0 rounded p-1 text-muted-foreground/30 opacity-0 transition-all hover:bg-att-blue/12 hover:text-att-blue group-hover:opacity-100"
                        title="Send to Tasks"
                      >
                        <ListTodo className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Decisions */}
            {result.decisions.length > 0 && (
              <section className="mb-5">
                <h3 className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground/60">
                  {t('capture.decisions', { count: result.decisions.length })}
                </h3>
                <div className="flex flex-col gap-1.5">
                  {result.decisions.map((d, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 text-att-green">✓</span>
                      <span className="text-sm text-foreground">{d}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Open questions */}
            {result.openQuestions.length > 0 && (
              <section className="mb-5">
                <h3 className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground/60">
                  {t('capture.open_questions', { count: result.openQuestions.length })}
                </h3>
                <div className="flex flex-col gap-1.5">
                  {result.openQuestions.map((q, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 text-att-orange">?</span>
                      <span className="text-sm text-foreground">{q}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Concepts (knowledge captures) */}
            {result.concepts && result.concepts.length > 0 && (
              <section className="mb-5">
                <h3 className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-att-purple/60">
                  Concepts & Frameworks
                </h3>
                <div className="flex flex-col gap-1.5">
                  {result.concepts.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-md border border-att-purple/15 bg-att-purple/5 px-3 py-2">
                      <span className="mt-0.5 shrink-0 text-att-purple">◆</span>
                      <span className="text-sm text-foreground">{c}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Takeaways (knowledge + decision captures) */}
            {result.takeaways && result.takeaways.length > 0 && (
              <section className="mb-5">
                <h3 className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-att-green/60">
                  Takeaways
                </h3>
                <div className="flex flex-col gap-1.5">
                  {result.takeaways.map((tw, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="mt-0.5 shrink-0 text-att-green">→</span>
                      <span className="text-sm text-foreground">{tw}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Key points */}
            {result.keyPoints.length > 0 && (
              <section className="mb-5">
                <h3 className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground/60">
                  {t('capture.key_points')}
                </h3>
                <ul className="flex flex-col gap-1">
                  {result.keyPoints.map((k, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-att-surface-raised" />
                      {k}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          {/* Aside */}
          <aside className="w-[288px] shrink-0 overflow-y-auto border-l border-att-divider p-5">
            {/* Source info */}
            <div className="mb-5">
              <p className="mb-1 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground/60">
                {t('capture.source_label')}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(`capture.source.${sourceType}`)} · {relativeTime(Date.now(), t)}
              </p>
            </div>

            {/* Actions — context-aware based on capture category */}
            <div className="mb-5 flex flex-col gap-2">
              {/* Primary save action */}
              <button
                onClick={() => void handleSave()}
                disabled={savedToast}
                className={cn(
                  'flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  savedToast
                    ? 'bg-att-green/12 text-att-green'
                    : 'bg-att-blue/12 text-att-blue hover:bg-att-blue/20'
                )}
              >
                {savedToast ? (
                  <>
                    <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                    {t('capture.saved')}
                  </>
                ) : result.category === 'knowledge' ? (
                  'Save to Knowledge Base'
                ) : result.category === 'task' ? (
                  'Save & Send to Tasks'
                ) : (
                  t('capture.save_to_memory')
                )}
              </button>

              {/* Secondary: task captures → auto-create tasks for all action items */}
              {result.category === 'task' && actionItems.length > 0 && !savedToast && (
                <button
                  onClick={() => {
                    for (const item of actionItems.filter((a) => !a.checked)) {
                      addLocalTask({
                        description: item.text + (item.owner ? ` (@${item.owner})` : ''),
                        sourceType: 'capture'
                      })
                    }
                    void handleSave()
                  }}
                  className="rounded-md border border-att-blue/30 px-3 py-2 text-sm text-att-blue transition-colors hover:bg-att-blue/8"
                >
                  Save + Create {actionItems.filter((a) => !a.checked).length} tasks
                </button>
              )}

              <button
                onClick={handleDiscard}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground/60 transition-colors hover:bg-att-surface-hover hover:text-att-red"
              >
                {t('capture.discard')}
              </button>
            </div>

            {/* Entities — extracted names, projects, and dates (click to ask about them) */}
            {(result.entities.people.length > 0 ||
              result.entities.projects.length > 0 ||
              result.entities.dates.length > 0) && (
              <div className="mb-5">
                <p className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground/60">
                  {t('capture.entities')}
                </p>
                <div className="flex flex-col gap-2">
                  {result.entities.people.length > 0 && (
                    <div>
                      <span className="mb-1 block text-[9px] text-muted-foreground/40">People</span>
                      <div className="flex flex-wrap gap-1">
                        {result.entities.people.map((p, i) => (
                          <button
                            key={i}
                            onClick={() => setChatInput(`What does "${p}" do or decide in this content?`)}
                            className="rounded bg-att-blue/10 px-1.5 py-0.5 text-[10px] text-att-blue transition-colors hover:bg-att-blue/20"
                            title={`Ask about ${p}`}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {result.entities.projects.length > 0 && (
                    <div>
                      <span className="mb-1 block text-[9px] text-muted-foreground/40">Projects</span>
                      <div className="flex flex-wrap gap-1">
                        {result.entities.projects.map((p, i) => (
                          <button
                            key={i}
                            onClick={() => setChatInput(`What is mentioned about "${p}" in this content?`)}
                            className="rounded bg-att-green/10 px-1.5 py-0.5 text-[10px] text-att-green transition-colors hover:bg-att-green/20"
                            title={`Ask about ${p}`}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {result.entities.dates.length > 0 && (
                    <div>
                      <span className="mb-1 block text-[9px] text-muted-foreground/40">Dates</span>
                      <div className="flex flex-wrap gap-1">
                        {result.entities.dates.map((d, i) => (
                          <button
                            key={i}
                            onClick={() => setChatInput(`What happens on "${d}" according to this content?`)}
                            className="rounded bg-att-orange/10 px-1.5 py-0.5 text-[10px] text-att-orange transition-colors hover:bg-att-orange/20"
                            title={`Ask about ${d}`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Chat */}
            <div className="border-t border-att-divider pt-4">
              <p className="mb-3 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground/60">
                {t('capture.ask')}
              </p>

              {/* Messages */}
              {chatMessages.length > 0 && (
                <div className="mb-3 flex flex-col gap-2.5">
                  {chatMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                    >
                      <span
                        className={cn(
                          'max-w-[220px] rounded-lg px-3 py-2 text-xs leading-relaxed',
                          msg.role === 'user'
                            ? 'bg-att-blue/15 text-foreground/80'
                            : 'bg-att-surface text-foreground/80'
                        )}
                      >
                        {msg.text}
                      </span>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <span className="flex items-center gap-1 rounded-lg bg-att-surface px-3 py-2">
                        <span
                          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
                          style={{ animationDelay: '0ms' }}
                        />
                        <span
                          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
                          style={{ animationDelay: '120ms' }}
                        />
                        <span
                          className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60"
                          style={{ animationDelay: '240ms' }}
                        />
                      </span>
                    </div>
                  )}
                  <div ref={chatBottomRef} />
                </div>
              )}

              {/* Input */}
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !chatLoading) void handleChatSend()
                  }}
                  placeholder={t('capture.ask_placeholder')}
                  disabled={chatLoading}
                  className="flex-1 rounded-lg border border-att-divider bg-att-surface px-2.5 py-2 text-xs text-foreground placeholder:text-att-surface-raised focus:border-att-blue/50 focus:outline-none disabled:opacity-50"
                />
                <button
                  onClick={() => void handleChatSend()}
                  disabled={chatLoading || !chatInput.trim()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-att-blue text-white transition-colors hover:bg-[#4a6be5] disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </aside>
        </div>
      )
    }

    // ── PROCESSING state ──────────────────────────────────────────────────
    if (captureState === 'processing') {
      const progress = Math.round((processingStep / steps.length) * 100)
      return (
        <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
          <div className="w-full max-w-sm">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm text-foreground">
                {t('capture.processing', {
                  source: t(`capture.source.${sourceType}`).toLowerCase()
                })}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground/60">{progress}%</span>
            </div>
            {/* Progress bar */}
            <div className="mb-5 h-[3px] overflow-hidden rounded-full bg-att-divider">
              <div
                className="h-full rounded-full bg-att-blue transition-all duration-[800ms] ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Steps */}
            <div className="flex flex-col gap-2">
              {steps.map((step, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex items-center gap-2.5 text-sm transition-colors duration-300',
                    i < processingStep
                      ? 'text-att-green'
                      : i === processingStep
                        ? 'text-foreground'
                        : 'text-att-divider'
                  )}
                >
                  {i < processingStep ? (
                    <Check className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
                  ) : i === processingStep ? (
                    <div className="h-3.5 w-3.5 shrink-0 animate-pulse rounded-full bg-att-blue" />
                  ) : (
                    <div className="h-3.5 w-3.5 shrink-0 rounded-full bg-att-divider" />
                  )}
                  {step}
                </div>
              ))}
            </div>

            <button
              onClick={handleCancel}
              className="mt-6 flex items-center gap-1.5 text-xs text-muted-foreground/60 transition-colors hover:text-att-red"
            >
              <X className="h-3 w-3" />
              {t('capture.cancel')}
            </button>
          </div>
        </div>
      )
    }

    // ── IDLE state ────────────────────────────────────────────────────────
    return (
      <div className="flex flex-1 flex-col overflow-y-auto px-6 pb-6">
        {/* Dynamic input area */}
        <div className="mb-4">
          {sourceType === 'text' && (
            <textarea
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={t('capture.text_placeholder')}
              rows={8}
              className="w-full resize-none rounded-lg border border-att-divider bg-att-surface px-3 py-2.5 text-sm text-foreground placeholder:text-att-surface-raised focus:border-att-blue/50 focus:outline-none"
            />
          )}

          {sourceType === 'url' && (
            <div className="flex flex-col gap-2">
              <input
                type="url"
                value={urlInput}
                onChange={(e) => {
                  setUrlInput(e.target.value)
                  setUrlError(null)
                }}
                placeholder="https://..."
                className="w-full rounded-lg border border-att-divider bg-att-surface px-3 py-2.5 text-sm text-foreground placeholder:text-att-surface-raised focus:border-att-blue/50 focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canCapture) void handleCapture()
                }}
              />
              {urlError ? (
                <p className="text-[10px] text-att-red">{urlError}</p>
              ) : (
                <p className="text-[10px] text-muted-foreground/60">{t('capture.url_hint')}</p>
              )}
            </div>
          )}

          {sourceType === 'file' && (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={cn(
                'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed py-10 transition-colors',
                dragOver
                  ? 'border-att-blue bg-att-blue/5'
                  : 'border-att-divider bg-att-surface hover:border-att-surface-raised'
              )}
            >
              <Upload className={cn('h-8 w-8', dragOver ? 'text-att-blue' : 'text-att-surface-raised')} />
              <div className="text-center">
                <p className="text-sm text-foreground">
                  {t('capture.file_drop')}{' '}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="text-att-blue hover:underline"
                  >
                    {t('capture.file_select')}
                  </button>
                </p>
                <p className="mt-1 text-xs text-muted-foreground/60">{t('capture.file_types')}</p>
              </div>
              {fileName && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  {fileName}
                </div>
              )}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept={FILE_TYPES[sourceType] ?? ''}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
            }}
          />
        </div>

        {/* Capture button (only for text/url) */}
        {(sourceType === 'text' || sourceType === 'url') && (
          <button
            onClick={() => void handleCapture()}
            disabled={!canCapture}
            className="mb-6 w-full rounded-md bg-att-blue py-2 text-sm font-medium text-white transition-colors hover:bg-[#4a6be5] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t('capture.button')}
          </button>
        )}

        {/* Offline notice removed — runtime handles errors gracefully */}

        {/* Recents — merged from localStorage captures + agent-store rawCaptures */}
        {(recents.length > 0 || rawCaptures.length > 0) && (
          <div>
            <p className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-muted-foreground/60">
              {t('capture.recents')}
            </p>
            <div className="flex flex-col gap-0.5">
              {/* Processed captures from CaptureView (localStorage) */}
              {recents.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => {
                    setResult(entry.result)
                    setActionItems(entry.result.actionItems.map((a) => ({ ...a, checked: false })))
                    setSourceType(entry.sourceType === 'transcript' ? 'file' : entry.sourceType)
                    // Restore captured content so the chat Q&A works
                    setCapturedContent(entry.result.summary || entry.title)
                    setCaptureState('review')
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-2 text-left transition-colors hover:bg-att-surface"
                >
                  <span className="shrink-0 rounded border border-att-divider px-1 py-0.5 font-mono text-[8px] uppercase text-muted-foreground/60">
                    {entry.sourceType}
                  </span>
                  <span className="flex-1 truncate text-xs text-foreground/80">{entry.title}</span>
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground/60">
                    <Clock className="h-2.5 w-2.5" />
                    {relativeTime(entry.timestamp, t)}
                  </span>
                </button>
              ))}
              {/* Landscape/dashboard captures from agent-store */}
              {rawCaptures.filter((c) => !c.archived).slice(0, 10).map((entry) => (
                <div
                  key={entry.id}
                  className="flex w-full items-center gap-2 rounded px-2 py-2 text-left"
                >
                  <span className={cn(
                    'shrink-0 rounded border px-1 py-0.5 font-mono text-[8px] uppercase',
                    entry.sourceType === 'landscape-chat'
                      ? 'border-att-blue/30 text-att-blue'
                      : 'border-att-divider text-muted-foreground/60'
                  )}>
                    {entry.sourceType ?? entry.type}
                  </span>
                  <span className="flex-1 truncate text-xs text-foreground/80">{entry.text}</span>
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground/60">
                    <Clock className="h-2.5 w-2.5" />
                    {relativeTime(entry.timestamp, t)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header — always visible */}
      <div className="shrink-0 px-6 pt-6">
        <div className="mb-5">
          <h1 className="text-base font-semibold text-foreground">Capture</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Captura información, el agente extrae lo que importa.
          </p>
        </div>

        {/* Source type pills — always visible, reset to idle on click */}
        <div className="mb-4 flex flex-wrap gap-2">
          {(['text', 'url', 'file', 'transcript'] as SourceType[]).map((type) => (
            <SourcePill
              key={type}
              type={type}
              active={sourceType === type}
              onClick={() => {
                setSourceType(type)
                setCaptureState('idle')
              }}
            />
          ))}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {sourceType === 'transcript' ? <TranscriptUpload embedded /> : renderContent()}
      </div>
    </div>
  )
}
