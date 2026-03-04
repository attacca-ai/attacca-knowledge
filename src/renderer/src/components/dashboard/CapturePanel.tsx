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

const TYPE_BADGE_COLORS: Record<CaptureType, string> = {
  thought: 'bg-blue-500/10 text-blue-400',
  action:  'bg-green-500/10 text-green-400',
  question:'bg-yellow-500/10 text-yellow-500',
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
  const now = Date.now()
  const diffMs = now - ts
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return new Date(ts).toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
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

  // Auto-cancel stop confirmation after 3s
  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), 3_000)
    return () => clearTimeout(timer)
  }, [confirming])

  // Listen for agent note coming back for pending capture
  useEffect(() => {
    if (connectionState !== 'connected') return

    const handler = (event: OcEvent): void => {
      if (event.event !== 'chat') return
      const payload = (event.payload ?? {}) as Record<string, unknown>
      if (payload.state !== 'final') return
      if (!pendingCaptureIdRef.current) return

      const message = payload.message as
        | { content?: Array<{ type: string; text?: string }> }
        | undefined
      const note = message?.content?.[0]?.text ?? ''
      if (note) {
        updateCaptureNote(pendingCaptureIdRef.current, note)
        pendingCaptureIdRef.current = null
      }
    }

    gatewayClient.on('*', handler)
    return () => gatewayClient.off('*', handler)
  }, [connectionState, updateCaptureNote])

  const handleSend = useCallback(async (): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    setSending(true)
    setText('')

    // Add capture entry (agentNote starts null)
    let captureId: string | null = null
    addRawCapture({ text: trimmed, type, agentNote: null })
    // Get the id of the just-added entry (it's first in rawCaptures after state update)
    // We'll use a small trick: subscribe once to get the id
    const currentCaptures = useAgentStore.getState().rawCaptures
    captureId = currentCaptures[0]?.id ?? null
    pendingCaptureIdRef.current = captureId

    // Type-specific side effects
    if (type === 'action') {
      addTask(trimmed)
    } else if (type === 'question') {
      addThread({ title: trimmed, holdingNote: '' })
    }

    // Send to agent
    if (connectionState === 'connected') {
      try {
        await gatewayClient.rpc('chat.send', {
          sessionKey: 'agent:main:main',
          message: trimmed,
          idempotencyKey: crypto.randomUUID()
        })
      } catch {
        if (captureId) {
          updateCaptureNote(captureId, 'Could not reach agent.')
          pendingCaptureIdRef.current = null
        }
      }
    } else {
      if (captureId) {
        updateCaptureNote(captureId, 'Agent not connected — queued locally.')
        pendingCaptureIdRef.current = null
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
            'w-full resize-none rounded-md border border-border bg-card px-3 py-2.5',
            'font-sans text-[12.5px] text-foreground placeholder:text-muted-foreground/50',
            'outline-none focus:border-border focus:ring-1 focus:ring-ring/30',
            'leading-relaxed'
          )}
          rows={3}
        />

        <div className="mt-2 flex items-center justify-between">
          {/* Type pills */}
          <div className="flex gap-1">
            {(['thought', 'action', 'question'] as CaptureType[]).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={cn(
                  'rounded-full border px-2 py-0.5 font-mono text-[9px] transition-colors',
                  type === t
                    ? 'border-blue-500/60 bg-blue-500/10 text-blue-400'
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
              'flex h-6 w-6 items-center justify-center rounded',
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
          <div className="flex flex-col divide-y divide-border/40">
            {recentCaptures.map((entry: CaptureEntry) => (
              <div key={entry.id} className="cursor-pointer py-2 hover:bg-muted/20">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="font-mono text-[9px] text-muted-foreground/50">
                    {formatCaptureTime(entry.timestamp)}
                  </span>
                  <span className={cn('rounded px-1 py-0.5 font-mono text-[8px] font-bold', TYPE_BADGE_COLORS[entry.type])}>
                    {entry.type}
                  </span>
                </div>
                <p className="text-[12px] leading-snug text-muted-foreground">{entry.text}</p>
                {entry.agentNote !== null ? (
                  <p className="mt-1 flex items-start gap-1 text-[10.5px] italic text-muted-foreground/60">
                    <span className="shrink-0 text-blue-400">↳</span>
                    {entry.agentNote}
                  </p>
                ) : (
                  <p className="mt-1 flex items-center gap-1 text-[10.5px] text-muted-foreground/40">
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
                <div className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', DOT_COLORS[entry.type] ?? 'bg-muted-foreground/50')} />
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
