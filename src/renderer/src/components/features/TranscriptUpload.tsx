import { useState, useRef, useEffect, useCallback } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { useAgentStore } from '@/stores/agent-store'
import { Upload, FileText, Clipboard, Check, RefreshCw, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'

// ── Local types ──────────────────────────────────────────────────────────────

type ViewState = 'drop' | 'processing' | 'review' | 'error'
type DraftType = 'calendar' | 'task' | 'email' | 'flag'
type DraftStatus = 'pending' | 'approved' | 'discarded'
type TagStyle = 'tool' | 'risk-mid' | 'risk-high' | 'owner' | 'note'

interface DraftTag {
  label: string
  style: TagStyle
}

interface DraftItem {
  id: string
  type: DraftType
  title: string
  description: string
  detail?: string
  tags: DraftTag[]
  status: DraftStatus
  flagged?: boolean
  primaryLabel: string
  executionPrompt: string
}

interface TranscriptResult {
  meetingName: string
  duration?: string
  wordCount?: number
  agentReading: string
  agentQuestion?: string | null
  attendees?: Array<{ initials: string; name: string; role: string }>
  actionCounts?: {
    mine: number
    others: number
    deliverables: number
    emails: number
    flags: number
  }
  items: Omit<DraftItem, 'status'>[]
}

interface RecentEntry {
  id: string
  name: string
  date: string
  status: 'done' | 'review'
  result?: TranscriptResult
  drafts?: DraftItem[]
}

// ── Style maps ───────────────────────────────────────────────────────────────

const TAG_CLASSES: Record<TagStyle, string> = {
  tool: 'bg-att-surface-raised text-muted-foreground/60',
  'risk-mid': 'bg-att-orange/10 text-att-orange',
  'risk-high': 'bg-att-red/10 text-att-red',
  owner: 'bg-att-blue/12 text-att-blue',
  note: 'bg-att-orange/10 text-att-orange'
}

const SECTION_ICON_CLASSES: Record<DraftType, string> = {
  calendar: 'bg-att-blue/12 text-att-blue',
  task: 'bg-att-green/10 text-att-green',
  email: 'bg-att-purple/12 text-att-purple',
  flag: 'bg-att-orange/10 text-att-orange'
}

const SECTION_LABELS: Record<DraftType, string> = {
  calendar: 'Calendar',
  task: 'Tasks',
  email: 'Emails',
  flag: 'Flags'
}

const SECTION_ICONS: Record<DraftType, string> = {
  calendar: '📅',
  task: '✓',
  email: '✉',
  flag: '⚑'
}

const STEPS = [
  'Transcript read and cleaned',
  'Participants and roles identified',
  'Extracting commitments and deliverables',
  'Preparing follow-up drafts',
  'Structuring for review'
]

const SUPPORTED_TYPES = ['.txt', '.md', '.docx', '.pdf', '.vtt', '.srt']

const DRAFT_ORDER: DraftType[] = ['calendar', 'task', 'email', 'flag']

// ── StateBar ─────────────────────────────────────────────────────────────────

interface StateBarProps {
  viewState: ViewState
  hasResult: boolean
  onNavigate: (s: ViewState) => void
}

function StateBar({ viewState, hasResult, onNavigate }: StateBarProps): React.JSX.Element {
  const btnBase =
    'px-2.5 py-1 rounded border font-mono text-[9px] uppercase tracking-[.06em] transition-all duration-[120ms] cursor-pointer'
  const btnActive = 'bg-att-blue border-att-blue text-white'
  const btnInactive =
    'border-att-divider bg-transparent text-muted-foreground/60 hover:border-att-blue hover:text-att-blue'
  const btnDisabled = 'border-att-divider bg-transparent text-att-divider cursor-default'
  const btnError = 'bg-att-red/20 border-att-red/40 text-att-red'

  return (
    <div
      className="fixed bottom-4 right-4 z-[999] flex items-center gap-1.5 rounded-lg border border-att-divider bg-att-surface-raised p-2"
      style={{ boxShadow: '0 4px 16px rgba(0,0,0,.4)' }}
    >
      <span className="font-mono text-[8px] uppercase text-muted-foreground/60">State:</span>
      <button
        onClick={() => onNavigate('drop')}
        className={`${btnBase} ${viewState === 'drop' ? btnActive : btnInactive}`}
      >
        1 · Drop
      </button>
      <button
        onClick={() => viewState === 'processing' ? undefined : onNavigate('drop')}
        disabled={viewState === 'processing'}
        className={`${btnBase} ${
          viewState === 'processing' ? btnActive
            : viewState === 'error' ? btnError
            : btnDisabled
        }`}
      >
        2 · {viewState === 'error' ? 'Error' : 'Processing'}
      </button>
      <button
        onClick={() => onNavigate('review')}
        disabled={!hasResult}
        className={`${btnBase} ${
          viewState === 'review' ? btnActive : hasResult ? btnInactive : btnDisabled
        }`}
      >
        3 · Review
      </button>
    </div>
  )
}

// ── DraftCard ────────────────────────────────────────────────────────────────

interface DraftCardProps {
  item: DraftItem
  executing: boolean
  onAction: (item: DraftItem, action: 'approve' | 'discard') => Promise<void>
}

function DraftCard({ item, executing, onAction }: DraftCardProps): React.JSX.Element {
  const approved = item.status === 'approved'
  return (
    <div
      className={`rounded-md border bg-att-surface p-4 transition-opacity ${
        item.flagged ? 'border-l-2 border-att-divider border-l-att-orange' : 'border-att-divider'
      } ${approved ? 'opacity-50' : ''}`}
    >
      <div className="mb-1 text-sm font-medium text-foreground">{item.title}</div>
      <div className="mb-2 text-xs leading-relaxed text-muted-foreground">{item.description}</div>
      {item.detail && (
        <div className="mb-2 rounded bg-att-surface-hover px-2 py-1.5 text-xs text-muted-foreground">
          {item.detail}
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-1">
        {item.tags.map((tag, i) => (
          <span key={i} className={`rounded px-1.5 py-0.5 text-[10px] ${TAG_CLASSES[tag.style]}`}>
            {tag.label}
          </span>
        ))}
      </div>
      {approved ? (
        <div className="flex items-center gap-1.5 text-xs text-att-green">
          <Check className="h-3 w-3" strokeWidth={2.5} />
          Approved
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => void onAction(item, 'approve')}
            disabled={executing}
            className="flex items-center gap-1.5 rounded bg-att-blue/12 px-2.5 py-1.5 text-xs text-att-blue transition-colors hover:bg-att-blue/20 disabled:opacity-50"
          >
            {executing && <RefreshCw className="h-3 w-3 animate-spin" />}
            {item.primaryLabel}
          </button>
          <button
            onClick={() => void onAction(item, 'discard')}
            disabled={executing}
            className="rounded px-2.5 py-1.5 text-xs text-muted-foreground/60 transition-colors hover:bg-att-surface-hover hover:text-att-red disabled:opacity-50"
          >
            Discard
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface TranscriptUploadProps {
  embedded?: boolean
}

export function TranscriptUpload({ embedded = false }: TranscriptUploadProps): React.JSX.Element {
  const folderWatchEnabled = useSettingsStore((s) => s.folderWatchEnabled)
  const folderWatchPath = useSettingsStore((s) => s.folderWatchPath)
  const addTranscriptRecord = useAgentStore((s) => s.addTranscriptRecord)
  const updateTranscriptRecord = useAgentStore((s) => s.updateTranscriptRecord)
  const addKBEntry = useAgentStore((s) => s.addKBEntry)

  // View state
  const [viewState, setViewState] = useState<ViewState>('drop')

  // Drop state
  const [meetingName, setMeetingName] = useState('')
  const [notes, setNotes] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [pasteMode, setPasteMode] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [fileName, setFileName] = useState('')

  // Processing state
  const [processingStep, setProcessingStep] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  // Cache content for retry
  const lastContentRef = useRef<{ content: string; name: string } | null>(null)
  const transcriptRecordIdRef = useRef<string | null>(null)

  // Review state
  const [result, setResult] = useState<TranscriptResult | null>(null)
  const [drafts, setDrafts] = useState<DraftItem[]>([])
  const [executingId, setExecutingId] = useState<string | null>(null)

  // Recents (localStorage)
  const [recents, setRecents] = useState<RecentEntry[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('attacca:transcripts:recent') ?? '[]') as RecentEntry[]
    } catch {
      return []
    }
  })

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSessionRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Use a ref so the gateway listener doesn't need fileName in its dep array
  const fileNameRef = useRef<string>('')
  const meetingNameRef = useRef<string>('')

  // Keep refs in sync
  fileNameRef.current = fileName
  meetingNameRef.current = meetingName

  // Timer cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  // Sync draft status changes to localStorage recents
  useEffect(() => {
    if (drafts.length === 0) return
    setRecents((prev) => {
      const updated = prev.map((r) => {
        if (r.drafts && r.result === result) {
          return {
            ...r,
            drafts,
            status: drafts.every((d) => d.status !== 'pending')
              ? ('done' as const)
              : ('review' as const)
          }
        }
        return r
      })
      localStorage.setItem('attacca:transcripts:recent', JSON.stringify(updated))
      return updated
    })
  }, [drafts, result])

  // Agent event listeners — registered once
  useEffect(() => {
    const cleanup = (): void => {
      pendingSessionRef.current = null
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }

    const unsubError = window.api.agent.onError((data) => {
      if (!pendingSessionRef.current || data.sessionKey !== pendingSessionRef.current) return

      cleanup()
      if (transcriptRecordIdRef.current) {
        updateTranscriptRecord(transcriptRecordIdRef.current, {
          status: 'failed',
          completedAt: Date.now(),
          error: 'Agent error during processing'
        })
      }
      setErrorMessage('The agent encountered an error while processing the transcript.')
      setViewState('error')
    })

    const unsubFinal = window.api.agent.onFinal((data) => {
      if (!pendingSessionRef.current || data.sessionKey !== pendingSessionRef.current) return

      cleanup()
      setProcessingStep(STEPS.length) // All steps done

      const rawText = data.message
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)

      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as TranscriptResult
          const draftItems = parsed.items.map((item) => ({
            ...item,
            status: 'pending' as DraftStatus
          }))
          setResult(parsed)
          setDrafts(draftItems)
          const entry: RecentEntry = {
            id: crypto.randomUUID(),
            name: parsed.meetingName || fileNameRef.current,
            date: new Date().toLocaleDateString('en', {
              weekday: 'short',
              day: 'numeric',
              month: 'short'
            }),
            status: 'review',
            result: parsed,
            drafts: draftItems
          }
          setRecents((prev) => {
            const updated = [entry, ...prev].slice(0, 10)
            localStorage.setItem('attacca:transcripts:recent', JSON.stringify(updated))
            return updated
          })

          // Persist to KB/RAG (non-blocking)
          const meetingTitle = parsed.meetingName || meetingNameRef.current || fileNameRef.current
          const attendeeNames = (parsed.attendees ?? []).map((a) => a.name)
          const taskItems = parsed.items
            .filter((i) => i.type === 'task' || i.type === 'calendar')
            .map((i) => ({ text: i.title, owner: undefined }))
          window.api.kb
            .saveCapture({
              id: entry.id,
              sourceType: 'transcript',
              title: meetingTitle,
              content: fileNameRef.current,
              result: {
                summary: parsed.agentReading,
                actionItems: taskItems,
                decisions: parsed.items.filter((i) => i.type === 'flag').map((i) => i.title),
                openQuestions: parsed.agentQuestion ? [parsed.agentQuestion] : [],
                keyPoints: parsed.items.map((i) => i.title),
                entities: {
                  people: attendeeNames,
                  projects: [meetingTitle].filter(Boolean),
                  dates: []
                }
              },
              timestamp: Date.now()
            })
            .then(() => {
              // Track in agent-store so transcript appears in KB Manager
              try {
                addKBEntry({
                  title: meetingTitle || fileNameRef.current || 'Transcript',
                  sourceType: 'transcript',
                  sourceId: entry.id,
                  summary: parsed.agentReading || '',
                  tags: [
                    ...attendeeNames.slice(0, 3),
                    ...(parsed.items.length > 0 ? [`${parsed.items.length} items`] : [])
                  ],
                  folder: 'Transcripts'
                })
              } catch {
                /* addKBEntry failure is non-fatal */
              }
            })
            .catch(() => {
              /* KB write failure is non-fatal */
            })

          // Save each draft item to memory DB individually
          for (const item of parsed.items) {
            window.api.memory
              .save({
                content: `[${meetingTitle}] ${item.title}: ${item.description}${item.detail ? ` — ${item.detail}` : ''}`,
                type: item.type === 'flag' ? 'decision' : 'capture',
                summary: `${item.type}: ${item.title} (${meetingTitle})`,
                tags: [
                  `transcript:${entry.id}`,
                  `draft:${item.type}`,
                  ...attendeeNames.map((n) => `person:${n}`)
                ],
                importance: item.type === 'flag' ? 0.7 : 0.5,
                source_id: entry.id
              })
              .catch(() => {
                /* non-fatal */
              })
          }

          if (transcriptRecordIdRef.current) {
            updateTranscriptRecord(transcriptRecordIdRef.current, {
              status: 'completed',
              completedAt: Date.now()
            })
          }
          setTimeout(() => setViewState('review'), 600)
        } catch {
          if (transcriptRecordIdRef.current) {
            updateTranscriptRecord(transcriptRecordIdRef.current, {
              status: 'failed',
              completedAt: Date.now(),
              error: 'Failed to parse agent response'
            })
          }
          setErrorMessage('Failed to parse the agent response. The transcript may not be in a supported format.')
          setViewState('error')
        }
      } else {
        if (transcriptRecordIdRef.current) {
          updateTranscriptRecord(transcriptRecordIdRef.current, {
            status: 'failed',
            completedAt: Date.now(),
            error: 'Empty response from agent'
          })
        }
        setErrorMessage('The agent returned an empty response. Please try again.')
        setViewState('error')
      }
    })

    return () => {
      unsubFinal()
      unsubError()
    }
  }, [])

  // Start processing a transcript
  const startProcessing = useCallback(
    async (content: string, name: string): Promise<void> => {
      setFileName(name)
      setViewState('processing')
      setProcessingStep(0)

      // Synthetic animation: advance one step every 5s, capped at STEPS.length-1
      timerRef.current = setInterval(() => {
        setProcessingStep((prev) => Math.min(prev + 1, STEPS.length - 1))
      }, 5000)

      lastContentRef.current = { content, name }
      transcriptRecordIdRef.current = addTranscriptRecord({ fileName: name, status: 'processing' })

      const sessionKey = `transcript-${crypto.randomUUID()}`
      pendingSessionRef.current = sessionKey

      const prompt = `Analyze the following meeting transcript. Context: name="${meetingName}", notes="${notes}".

Return ONLY valid JSON:
{
  "meetingName": "...",
  "duration": "N min",
  "wordCount": N,
  "agentReading": "2-3 direct sentences summarizing the meeting",
  "agentQuestion": "a clarifying question or null",
  "attendees": [{"initials":"AB","name":"...","role":"..."}],
  "actionCounts": {"mine":N,"others":N,"deliverables":N,"emails":N,"flags":N},
  "items": [{
    "id":"uid","type":"calendar|task|email|flag",
    "title":"...","description":"...","detail":"...|null",
    "tags":[{"label":"...","style":"tool|risk-mid|risk-high|owner|note"}],
    "primaryLabel":"Confirm|Create task|Review and send|Add context",
    "executionPrompt":"concrete instruction to execute using tools"
  }]
}

Type rules:
- calendar: create/modify event in Google Calendar (with attendees → mid/high-risk)
- task: create task in PM tool (Trello/ClickUp/Asana)
- email: email draft (always high-risk · send)
- flag: attention point with no automatic action, requires human judgment

Transcript:
${content}`

      try {
        await window.api.agent.send(sessionKey, prompt, sessionKey)

        // Safety timeout — if the agent never responds, show error
        timeoutRef.current = setTimeout(() => {
          if (pendingSessionRef.current === sessionKey) {
            pendingSessionRef.current = null
            if (timerRef.current) {
              clearInterval(timerRef.current)
              timerRef.current = null
            }
            if (transcriptRecordIdRef.current) {
              updateTranscriptRecord(transcriptRecordIdRef.current, {
                status: 'failed',
                completedAt: Date.now(),
                error: 'Processing timed out'
              })
            }
            setErrorMessage('Processing timed out — the agent did not respond within 2 minutes. You can retry or go back.')
            setViewState('error')
          }
        }, 120_000)
      } catch {
        pendingSessionRef.current = null
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        if (transcriptRecordIdRef.current) {
          updateTranscriptRecord(transcriptRecordIdRef.current, {
            status: 'failed',
            completedAt: Date.now(),
            error: 'Failed to send to agent'
          })
        }
        setErrorMessage('Failed to send transcript to the agent. Please check your connection and try again.')
        setViewState('error')
      }
    },
    [meetingName, notes]
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent): Promise<void> => {
      e.preventDefault()
      setDragOver(false)
      const files = Array.from(e.dataTransfer.files)
      for (const file of files) {
        const ext = '.' + file.name.split('.').pop()?.toLowerCase()
        if (!SUPPORTED_TYPES.includes(ext)) continue
        const content = await file.text()
        await startProcessing(content, file.name)
        break
      }
    },
    [startProcessing]
  )

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
      const file = e.target.files?.[0]
      if (!file) return
      const content = await file.text()
      await startProcessing(content, file.name)
      e.target.value = ''
    },
    [startProcessing]
  )

  const handlePasteSubmit = useCallback(async (): Promise<void> => {
    if (!pasteText.trim()) return
    await startProcessing(pasteText.trim(), 'pasted transcript')
    setPasteText('')
    setPasteMode(false)
  }, [pasteText, startProcessing])

  const handleItemAction = useCallback(
    async (item: DraftItem, action: 'approve' | 'discard'): Promise<void> => {
      if (action === 'discard') {
        setDrafts((prev) => prev.map((d) => (d.id === item.id ? { ...d, status: 'discarded' } : d)))
        return
      }
      setExecutingId(item.id)
      const sessionKey = `transcript-exec-${crypto.randomUUID()}`
      const prompt =
        `Execute this transcript action:\n"${item.executionPrompt}"\n` +
        `Use tools (Google Calendar, Gmail, ClickUp, etc.).\n` +
        `Respond ONLY with JSON: {"text":"Brief confirmation."}`
      try {
        await window.api.agent.send(sessionKey, prompt, sessionKey)
        setDrafts((prev) => prev.map((d) => (d.id === item.id ? { ...d, status: 'approved' } : d)))

        // Record the approved action as a decision in the memory DB
        const meetingTitle = result?.meetingName || meetingNameRef.current || fileNameRef.current
        window.api.memory
          .save({
            content: `Approved transcript action: ${item.title} — ${item.description}`,
            type: 'decision',
            summary: `Executed: ${item.title} (${meetingTitle})`,
            tags: [`draft:${item.type}`, `action:approved`],
            importance: 0.6
          })
          .catch(() => {
            /* non-fatal */
          })
      } catch {
        // no-op: leave item as pending
      } finally {
        setExecutingId(null)
      }
    },
    []
  )

  const handleApproveAll = useCallback((): void => {
    drafts
      .filter((d) => d.status === 'pending')
      .forEach((item) => void handleItemAction(item, 'approve'))
  }, [drafts, handleItemAction])

  function handleRecentClick(entry: RecentEntry): void {
    if (!entry.result) return
    const d: DraftItem[] =
      entry.drafts ??
      entry.result.items.map((item) => ({ ...item, status: 'pending' as DraftStatus }))
    setResult(entry.result)
    setDrafts(d)
    setFileName(entry.name)
    setViewState('review')
  }

  function handleStateNavigate(s: ViewState): void {
    if (s === 'drop') {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      pendingSessionRef.current = null
      setErrorMessage(null)
      setViewState('drop')
    } else if (s === 'review') {
      if (result) {
        setViewState('review')
      } else {
        const latest = recents.find((r) => r.result)
        if (latest) handleRecentClick(latest)
      }
    }
  }

  function handleRetry(): void {
    setErrorMessage(null)
    if (lastContentRef.current) {
      void startProcessing(lastContentRef.current.content, lastContentRef.current.name)
    } else {
      setViewState('drop')
    }
  }

  // Grouped draft items for review (discarded items hidden)
  const grouped = DRAFT_ORDER.map((type) => ({
    type,
    items: drafts.filter((d) => d.type === type && d.status !== 'discarded')
  })).filter((g) => g.items.length > 0)

  // ── STATE 1: DROP ───────────────────────────────────────────────────────────

  if (viewState === 'drop') {
    return (
      <div className="flex h-full overflow-hidden">
        <StateBar
          viewState={viewState}
          hasResult={!!result || recents.some((r) => !!r.result)}
          onNavigate={handleStateNavigate}
        />
        {/* Left panel */}
        <div
          className={`flex flex-1 flex-col overflow-y-auto ${embedded ? 'px-6 pb-6 pt-0' : 'p-8'}`}
        >
          {!embedded && (
            <>
              <div className="mb-1 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
                Transcripts
              </div>
              <div className="mb-2 text-2xl font-semibold text-foreground">New meeting</div>
              <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
                Finish the meeting, drop the transcript and <em>go do whatever you need to do</em>.
                The agent processes everything and has drafts ready when you come back.
              </p>
            </>
          )}

          {/* Context frame */}
          <div className="mb-6 rounded-md border border-att-divider bg-att-surface p-4">
            <div className="mb-3 text-xs text-muted-foreground/60">Context for the agent</div>
            <div className="mb-3">
              <div className="mb-1 text-xs text-muted-foreground">
                What was the meeting called? <span className="text-att-red">*</span>
              </div>
              <input
                type="text"
                value={meetingName}
                onChange={(e) => setMeetingName(e.target.value)}
                placeholder="e.g. Client kickoff / Product sync / 1:1 with Pedro"
                className="w-full rounded border border-att-divider bg-att-surface-hover px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-att-blue"
              />
            </div>
            <div>
              <div className="mb-1 text-xs text-muted-foreground">
                Anything the agent should know before processing?
              </div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. This was a new client meeting. I'm responsible for the proposal."
                rows={3}
                className="w-full resize-none rounded border border-att-divider bg-att-surface-hover px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-att-blue"
              />
              <div className="mt-1 text-xs text-muted-foreground/60">
                The agent uses this to decide what belongs to you vs. others.
              </div>
            </div>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              if (!meetingName.trim()) return
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              if (!meetingName.trim()) return
              void handleDrop(e)
            }}
            className={`flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed py-10 transition-colors ${
              !meetingName.trim()
                ? 'border-att-divider opacity-40 cursor-not-allowed'
                : dragOver
                  ? 'border-att-blue bg-[rgba(91,124,246,.05)]'
                  : 'border-att-divider hover:border-muted-foreground/60'
            }`}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-att-surface-hover text-muted-foreground/60">
              <Upload className="h-5 w-5" />
            </div>
            <div className="text-sm font-medium text-muted-foreground">Drop transcript file here</div>
            <div className="text-xs text-muted-foreground/60">{SUPPORTED_TYPES.join(' · ')}</div>
          </div>

          {/* Separator */}
          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-att-divider" />
            <div className="text-xs tracking-[0.08em] text-muted-foreground/60">OR</div>
            <div className="h-px flex-1 bg-att-divider" />
          </div>

          {/* Paste button */}
          <button
            onClick={() => meetingName.trim() && setPasteMode(!pasteMode)}
            disabled={!meetingName.trim()}
            className="flex items-center gap-2 self-start rounded border border-att-divider bg-att-surface px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-muted-foreground/60 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-att-divider disabled:hover:text-muted-foreground"
          >
            <Clipboard className="h-3.5 w-3.5" />
            Paste transcript text
          </button>

          {/* Paste textarea */}
          {pasteMode && (
            <div className="mt-3 flex flex-col gap-2">
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste your transcript here..."
                rows={8}
                className="w-full resize-y rounded border border-att-divider bg-att-surface-hover px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-att-blue"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setPasteMode(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handlePasteSubmit} disabled={!pasteText.trim()}>
                  Process transcript
                </Button>
              </div>
            </div>
          )}

          {/* Browse button (hidden input) */}
          <div className="mt-3">
            <input
              ref={fileInputRef}
              type="file"
              accept={SUPPORTED_TYPES.join(',')}
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => meetingName.trim() && fileInputRef.current?.click()}
              disabled={!meetingName.trim()}
              className="flex items-center gap-2 rounded border border-att-divider bg-att-surface px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-muted-foreground/60 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-att-divider disabled:hover:text-muted-foreground"
            >
              <FileText className="h-3.5 w-3.5" />
              Browse files
            </button>
          </div>
        </div>

        {/* Right sidebar */}
        {!embedded && (
          <div className="flex w-60 shrink-0 flex-col border-l border-att-divider p-5">
            <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
              Recent transcripts
            </div>
            {recents.length === 0 ? (
              <div className="text-xs text-muted-foreground/60">No transcripts yet.</div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {recents.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => handleRecentClick(r)}
                    className={`rounded px-2 py-2 transition-colors ${r.result ? 'cursor-pointer hover:bg-att-surface-hover' : 'cursor-default opacity-40'}`}
                  >
                    <div className="mb-1 text-xs font-medium text-foreground">{r.name}</div>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground/60">
                      <span>{r.date}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 ${
                          r.status === 'done'
                            ? 'bg-[rgba(76,175,130,.1)] text-att-green'
                            : 'bg-att-orange/10 text-att-orange'
                        }`}
                      >
                        {r.status === 'done' ? 'processed' : 'in review'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {folderWatchEnabled && folderWatchPath && (
              <div className="mt-4 rounded border border-att-divider bg-att-surface p-3">
                <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
                  Watched folder
                </div>
                <div className="mb-1 font-mono text-[11px] text-att-blue">{folderWatchPath}</div>
                <div className="text-[11px] text-muted-foreground/60">
                  New files in this folder are processed automatically.
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // ── STATE 2: PROCESSING ──────────────────────────────────────────────────────

  if (viewState === 'processing') {
    const pct = Math.round((processingStep / STEPS.length) * 100)
    const stepLabel =
      processingStep < STEPS.length
        ? STEPS[processingStep].toLowerCase()
        : STEPS[STEPS.length - 1].toLowerCase()

    return (
      <div
        className={`flex h-full flex-col overflow-y-auto ${embedded ? 'px-6 pb-6 pt-0' : 'p-8'}`}
      >
        <StateBar
          viewState={viewState}
          hasResult={!!result || recents.some((r) => !!r.result)}
          onNavigate={handleStateNavigate}
        />
        {!embedded && (
          <>
            <div className="mb-1 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
              Transcripts · processing
            </div>
            <div className="mb-5 text-2xl font-semibold text-foreground">Agent is on it</div>
          </>
        )}

        {/* File card */}
        <div className="mb-5 flex items-center gap-3 rounded-md border border-att-divider bg-att-surface p-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-att-surface-hover text-muted-foreground/60">
            <FileText className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{fileName}</div>
            {meetingName && <div className="truncate text-xs text-muted-foreground">{meetingName}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5 rounded border border-att-divider px-2 py-1 text-xs text-muted-foreground">
            <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-att-blue" />
            processing
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-5">
          <div className="mb-2 h-1 overflow-hidden rounded-full bg-att-surface-hover">
            <div
              className="h-full rounded-full bg-att-blue transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground">
            Step {Math.min(processingStep + 1, STEPS.length)} of {STEPS.length} · {stepLabel}
          </div>
        </div>

        {/* Feed */}
        <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
          What the agent is doing
        </div>
        <div className="mb-6 flex flex-col gap-3">
          {STEPS.map((step, i) => {
            const done = i < processingStep
            const active = i === processingStep && processingStep < STEPS.length
            return (
              <div key={i} className="flex items-start gap-3">
                <div
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    done
                      ? 'bg-[rgba(76,175,130,.1)] text-att-green'
                      : active
                        ? 'bg-att-blue/12 text-att-blue'
                        : 'bg-att-surface-hover text-muted-foreground/60'
                  }`}
                >
                  {done ? (
                    <Check className="h-3 w-3" strokeWidth={2.5} />
                  ) : active ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <Clock className="h-3 w-3" />
                  )}
                </div>
                <div className={`text-sm ${done || active ? 'text-foreground' : 'text-muted-foreground/60'}`}>
                  {step}
                </div>
              </div>
            )
          })}
        </div>

        {/* Away note */}
        <div className="flex items-start gap-3 rounded-md border border-att-divider bg-att-surface p-4">
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
          <div className="text-sm text-muted-foreground">
            <strong className="text-foreground">You can leave.</strong> When you're done with
            whatever you need to do, come back to Transcripts. Everything will be ready for you to
            review and approve — you don't need to wait here.
          </div>
        </div>
      </div>
    )
  }

  // ── STATE: ERROR ──────────────────────────────────────────────────────────────

  if (viewState === 'error') {
    return (
      <div
        className={`flex h-full flex-col items-center justify-center gap-4 ${embedded ? 'px-6 pb-6 pt-0' : 'p-8'}`}
      >
        <StateBar
          viewState={viewState}
          hasResult={!!result || recents.some((r) => !!r.result)}
          onNavigate={handleStateNavigate}
        />
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-att-red/10">
          <svg
            className="h-6 w-6 text-att-red"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <circle cx="8" cy="8" r="6" />
            <path d="M8 5v3.5M8 10.5v.5" />
          </svg>
        </div>
        <div className="text-center">
          <div className="mb-1 text-sm font-semibold text-foreground">Processing failed</div>
          <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
            {errorMessage ?? 'An unexpected error occurred.'}
          </p>
        </div>
        {fileName && (
          <div className="flex items-center gap-2 rounded-md border border-att-divider bg-att-surface px-3 py-2">
            <FileText className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="text-xs text-muted-foreground">{fileName}</span>
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => handleStateNavigate('drop')}>
            Back
          </Button>
          {lastContentRef.current && (
            <Button size="sm" onClick={handleRetry}>
              <RefreshCw className="mr-1.5 h-3 w-3" />
              Retry
            </Button>
          )}
        </div>
      </div>
    )
  }

  // ── STATE 3: REVIEW ──────────────────────────────────────────────────────────

  const r = result!
  const counts = r.actionCounts

  return (
    <div className="flex h-full overflow-hidden">
      <StateBar
        viewState={viewState}
        hasResult={!!result || recents.some((r) => !!r.result)}
        onNavigate={handleStateNavigate}
      />
      {/* Main panel */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 border-b border-att-divider px-6 pb-4 pt-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <div className="mb-1 flex items-center gap-2">
                <div className="flex items-center gap-1.5 rounded border border-att-green/30 bg-att-green/8 px-2 py-0.5 text-xs text-att-green">
                  <Check className="h-2.5 w-2.5" strokeWidth={2.5} />
                  ready for review
                </div>
              </div>
              <div className="text-xl font-semibold text-foreground">
                {r.meetingName || fileName}
              </div>
              {(r.duration ?? r.wordCount) && (
                <div className="mt-0.5 text-xs text-muted-foreground/60">
                  {[r.duration, r.wordCount ? `${r.wordCount.toLocaleString()} words` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              )}
            </div>
            <button
              onClick={handleApproveAll}
              className="shrink-0 rounded border border-att-divider bg-att-surface px-3 py-1.5 text-sm text-foreground transition-colors hover:border-att-blue hover:text-att-blue"
            >
              Approve all
            </button>
          </div>

          {/* Stats row */}
          {counts && (
            <div className="flex flex-wrap gap-4">
              {counts.mine > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="h-1.5 w-1.5 rounded-full bg-att-green" />
                  {counts.mine} tasks
                </div>
              )}
              {counts.deliverables > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="h-1.5 w-1.5 rounded-full bg-att-blue" />
                  {counts.deliverables} events
                </div>
              )}
              {counts.emails > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="h-1.5 w-1.5 rounded-full bg-att-purple" />
                  {counts.emails} emails
                </div>
              )}
              {counts.flags > 0 && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="h-1.5 w-1.5 rounded-full bg-att-orange" />
                  {counts.flags} flags
                </div>
              )}
            </div>
          )}
        </div>

        {/* Draft cards */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {grouped.map(({ type, items }) => (
            <div key={type} className="mb-7">
              {/* Section header */}
              <div className="mb-3 flex items-center gap-2">
                <div
                  className={`flex h-6 w-6 items-center justify-center rounded text-xs ${SECTION_ICON_CLASSES[type]}`}
                >
                  {SECTION_ICONS[type]}
                </div>
                <div className="text-sm font-medium text-foreground">{SECTION_LABELS[type]}</div>
                <span className="rounded bg-att-surface-hover px-1.5 py-0.5 text-xs text-muted-foreground">
                  {items.length}
                </span>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-2">
                {items.map((item) => (
                  <DraftCard
                    key={item.id}
                    item={item}
                    executing={executingId === item.id}
                    onAction={handleItemAction}
                  />
                ))}
              </div>
            </div>
          ))}

          <button
            onClick={() => {
              setViewState('drop')
              setResult(null)
              setDrafts([])
            }}
            className="mb-4 text-xs text-muted-foreground/60 hover:text-muted-foreground"
          >
            ← Process another transcript
          </button>
        </div>
      </div>

      {/* Aside */}
      <div className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-att-divider p-5">
        {/* Agent reading */}
        <div>
          <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
            Agent reading
          </div>
          <div className="text-sm leading-relaxed text-muted-foreground">{r.agentReading}</div>
          {r.agentQuestion && (
            <div className="mt-2 rounded border border-att-divider bg-att-surface p-2 text-xs text-muted-foreground">
              {r.agentQuestion}
            </div>
          )}
        </div>

        <div className="h-px bg-att-divider" />

        {/* Attendees */}
        {r.attendees && r.attendees.length > 0 && (
          <>
            <div>
              <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
                Attendees
              </div>
              <div className="flex flex-col gap-2">
                {r.attendees.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-att-surface-hover font-mono text-[10px] text-muted-foreground/60">
                      {a.initials}
                    </div>
                    <div>
                      <div className="text-xs text-foreground">{a.name}</div>
                      <div className="text-[10px] text-muted-foreground/60">{a.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="h-px bg-att-divider" />
          </>
        )}

        {/* Action counts */}
        {counts && (
          <div>
            <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
              Action summary
            </div>
            <div className="flex flex-col gap-1.5">
              {counts.mine > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Yours</span>
                  <span className="text-foreground">{counts.mine} tasks</span>
                </div>
              )}
              {counts.others > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Others (tracking)</span>
                  <span className="text-foreground">{counts.others} tasks</span>
                </div>
              )}
              {counts.deliverables > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Deliverables</span>
                  <span className="text-foreground">{counts.deliverables} drafts</span>
                </div>
              )}
              {counts.emails > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Outgoing emails</span>
                  <span className="text-foreground">{counts.emails} (high-risk)</span>
                </div>
              )}
              {counts.flags > 0 && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Open flags</span>
                  <span className="text-foreground">{counts.flags}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
