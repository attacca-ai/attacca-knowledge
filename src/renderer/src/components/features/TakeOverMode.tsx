import { useState, useEffect } from 'react'
import { useAgentStore } from '@/stores/agent-store'

// ── Types ────────────────────────────────────────────────────────────────────

type Phase = 'briefing' | 'active' | 'return'

interface ScopeAction {
  label: string
  desc: string
  risk: 'mid' | 'hold'
}

interface ToolkitScope {
  icon: string
  label: string
  actions: ScopeAction[]
}

interface ScopeToggle {
  toolId: string
  actionLabel: string
  enabled: boolean
}

interface ActivityItem {
  id: string
  status: 'active' | 'done' | 'held'
  title: string
  sub: string
  tool: string
  time: string
  risk?: 'mid' | 'high'
}

interface HeldCard {
  id: string
  title: string
  desc: string
  detail: string
  tool: string
  risk: 'mid' | 'high'
  primaryAction: string
  acknowledged: boolean
}

interface DoneCard {
  id: string
  title: string
  desc: string
  tool: string
  seen: boolean
}

interface TimelineItem {
  status: 'done' | 'held'
  text: string
  time: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COMPOSIO_TO_TOOL_KEY: Record<string, string> = {
  googlecalendar: 'google-calendar',
  googledrive: 'google-drive',
  gmail: 'gmail',
  slack: 'slack',
  clickup: 'clickup',
  asana: 'asana',
  notion: 'notion',
  trello: 'trello'
}

const TOOLKIT_SCOPE: Record<string, ToolkitScope> = {
  'google-calendar': {
    icon: '📅',
    label: 'Google Calendar',
    actions: [
      {
        label: 'Aceptar invitaciones de calendario',
        desc: 'Solo si hay disponibilidad. Conflictos → guardar para ti.',
        risk: 'mid'
      },
      {
        label: 'Rechazar conflictos automáticamente',
        desc: 'Si hay overlap, responde "no disponible" al organizador.',
        risk: 'mid'
      }
    ]
  },
  gmail: {
    icon: '✉',
    label: 'Gmail',
    actions: [
      {
        label: 'Archivar y etiquetar inbox',
        desc: 'Organizar lo que llegue sin responder.',
        risk: 'mid'
      },
      {
        label: 'Responder emails urgentes',
        desc: 'Solo los marcados como urgentes con respuesta estándar.',
        risk: 'hold'
      }
    ]
  },
  slack: {
    icon: '💬',
    label: 'Slack',
    actions: [
      {
        label: 'Leer y resumir canales',
        desc: 'Solo lectura — nunca publica sin aprobación.',
        risk: 'mid'
      },
      {
        label: 'Postear en canales de Slack',
        desc: 'Mensajes del equipo o clientes — alto riesgo.',
        risk: 'hold'
      }
    ]
  },
  clickup: {
    icon: '✓',
    label: 'ClickUp',
    actions: [
      {
        label: 'Crear y actualizar tareas',
        desc: 'Desde emails y mensajes nuevos que lleguen.',
        risk: 'mid'
      }
    ]
  },
  asana: {
    icon: '✓',
    label: 'Asana',
    actions: [
      {
        label: 'Crear y actualizar tareas',
        desc: 'Desde emails y mensajes nuevos que lleguen.',
        risk: 'mid'
      }
    ]
  },
  trello: {
    icon: '📋',
    label: 'Trello',
    actions: [
      {
        label: 'Mover y actualizar tarjetas',
        desc: 'Desde eventos del flujo de trabajo.',
        risk: 'mid'
      }
    ]
  },
  notion: {
    icon: '📄',
    label: 'Notion',
    actions: [
      {
        label: 'Actualizar páginas de Notion',
        desc: 'Notas y documentos internos — sin compartir.',
        risk: 'mid'
      }
    ]
  },
  'google-drive': {
    icon: '📁',
    label: 'Google Drive',
    actions: [
      {
        label: 'Subir y organizar archivos',
        desc: 'Solo las carpetas designadas.',
        risk: 'mid'
      }
    ]
  }
}

const DURATION_CHIPS = ['1 hora', '2 horas', 'Media jornada', 'Todo el día', 'Hasta que vuelva']

// ── Style tokens ──────────────────────────────────────────────────────────────

const RISK_BADGE: Record<string, string> = {
  mid: 'bg-[rgba(212,168,67,.1)] text-[#d4a843]',
  hold: 'bg-[#232428] text-[#4a4d55]'
}

const ACT_DOT: Record<string, string> = {
  done: 'bg-[#4caf82]',
  active: 'bg-[#5b7cf6] animate-pulse',
  held: 'bg-[#d4a843]'
}

const TAG_TOOL = 'bg-[#232428] text-[#4a4d55]'
const TAG_DONE = 'bg-[rgba(76,175,130,.1)] text-[#4caf82]'
const TAG_HOLD = 'bg-[rgba(212,168,67,.1)] text-[#d4a843]'
const TAG_HIGH = 'bg-[rgba(224,92,92,.1)] text-[#e05c5c]'

// ── Component ─────────────────────────────────────────────────────────────────

export function TakeOverMode(): React.JSX.Element {
  const addActivity = useAgentStore((s) => s.addActivity)

  // Phase state machine
  const [phase, setPhase] = useState<Phase>('briefing')

  // Connected tools
  const [connectedTools, setConnectedTools] = useState<string[]>([])

  // Briefing config
  const [durationPreset, setDurationPreset] = useState('2 horas')
  const [customHours, setCustomHours] = useState('2')
  const [scopeToggles, setScopeToggles] = useState<ScopeToggle[]>([])
  const [exceptions, setExceptions] = useState('')

  // Active phase
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [endAt, setEndAt] = useState<number | null>(null)
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([])
  const [elapsed, setElapsed] = useState('0 min transcurridos')
  const [progress, setProgress] = useState(0)

  // Return phase
  const [heldCards, setHeldCards] = useState<HeldCard[]>([])
  const [doneCards, setDoneCards] = useState<DoneCard[]>([])
  const [timeline, setTimeline] = useState<TimelineItem[]>([])

  // Load connected tools on mount
  useEffect(() => {
    window.api.relay
      .getConnected()
      .then((tools) => {
        const normalized = tools.map((t) => COMPOSIO_TO_TOOL_KEY[t] ?? t)
        setConnectedTools(normalized)
        const toggles: ScopeToggle[] = []
        for (const toolId of normalized) {
          const scope = TOOLKIT_SCOPE[toolId]
          if (!scope) continue
          for (const action of scope.actions) {
            toggles.push({ toolId, actionLabel: action.label, enabled: action.risk === 'mid' })
          }
        }
        setScopeToggles(toggles)
      })
      .catch(() => {})
  }, [])

  // Elapsed timer during active phase
  useEffect(() => {
    if (phase !== 'active' || !startedAt) return
    const tick = (): void => {
      const ms = Date.now() - startedAt
      const mins = Math.floor(ms / 60_000)
      const hrs = Math.floor(mins / 60)
      setElapsed(hrs > 0 ? `${hrs}h ${mins % 60}min transcurridos` : `${mins} min transcurridos`)
      if (endAt) setProgress(Math.min(100, Math.round((ms / (endAt - startedAt)) * 100)))
    }
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [phase, startedAt, endAt])

  // ── Handlers ────────────────────────────────────────────────────────────────

  function toggleScope(toolId: string, actionLabel: string): void {
    setScopeToggles((prev) =>
      prev.map((t) =>
        t.toolId === toolId && t.actionLabel === actionLabel ? { ...t, enabled: !t.enabled } : t
      )
    )
  }

  function handleActivate(): void {
    const now = Date.now()
    const hours =
      durationPreset === 'Hasta que vuelva'
        ? Infinity
        : durationPreset === 'Todo el día'
          ? 8
          : durationPreset === 'Media jornada'
            ? 4
            : durationPreset === '2 horas'
              ? 2
              : durationPreset === '1 hora'
                ? 1
                : Number(customHours) || 2

    setStartedAt(now)
    setEndAt(hours === Infinity ? null : now + hours * 3_600_000)
    setActivityItems([
      {
        id: crypto.randomUUID(),
        status: 'active',
        title: 'Analizando inbox y calendario...',
        sub: 'El agente está revisando lo que llegó mientras estabas fuera.',
        tool: 'Gmail',
        time: 'ahora'
      }
    ])
    addActivity({ type: 'info', description: 'Take Over activado — el agente tomó el control' })
    window.api.telemetry.emit('trust.takeover.activated', {})
    setPhase('active')
  }

  function handleReturn(): void {
    const durationMs = startedAt ? Date.now() - startedAt : 0
    window.api.telemetry.emit('trust.takeover.deactivated', { durationMs, trigger: 'manual' })
    addActivity({ type: 'info', description: 'Take Over finalizado — control devuelto al usuario' })

    const held = activityItems.filter((i) => i.status === 'held')
    const done = activityItems.filter((i) => i.status === 'done')

    setHeldCards(
      held.map((i) => ({
        id: i.id,
        title: i.title,
        desc: i.sub,
        detail: '',
        tool: i.tool,
        risk: i.risk ?? 'mid',
        primaryAction: 'Ver detalle',
        acknowledged: false
      }))
    )
    setDoneCards(
      done.map((i) => ({ id: i.id, title: i.title, desc: i.sub, tool: i.tool, seen: false }))
    )
    setTimeline(
      [...done, ...held].map((i) => ({
        status: i.status === 'done' ? 'done' : 'held',
        text: i.title,
        time: i.time
      }))
    )
    setPhase('return')
  }

  function acknowledgeHeld(id: string): void {
    setHeldCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, acknowledged: !c.acknowledged } : c))
    )
  }

  function markAllSeen(): void {
    setDoneCards((prev) => prev.map((c) => ({ ...c, seen: true })))
  }

  function handleReset(): void {
    setPhase('briefing')
    setStartedAt(null)
    setEndAt(null)
    setActivityItems([])
    setHeldCards([])
    setDoneCards([])
    setTimeline([])
    setElapsed('0 min transcurridos')
    setProgress(0)
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const enabledToggles = scopeToggles.filter((t) => t.enabled)
  const disabledToggles = scopeToggles.filter((t) => !t.enabled)

  const activeItems = activityItems.filter((i) => i.status === 'active')
  const doneItems = activityItems.filter((i) => i.status === 'done')
  const heldItems = activityItems.filter((i) => i.status === 'held')

  const startedAtStr = startedAt
    ? new Date(startedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
    : ''
  const endAtStr = endAt
    ? new Date(endAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
    : null

  const durationStr = startedAt
    ? (() => {
        const ms = (endAt ?? Date.now()) - startedAt
        const mins = Math.floor(ms / 60_000)
        const hrs = Math.floor(mins / 60)
        return hrs > 0 ? `${hrs}h ${mins % 60}min` : `${mins} min`
      })()
    : ''

  // ── Render phases ─────────────────────────────────────────────────────────────

  // ─ PHASE 1: BRIEFING ──────────────────────────────────────────────────────────

  function renderBriefing(): React.JSX.Element {
    // Build aside preview items from scope toggles
    const asideHandled = enabledToggles.slice(0, 4).map((t) => ({
      icon: TOOLKIT_SCOPE[t.toolId]?.icon ?? '·',
      label: t.actionLabel,
      meta: TOOLKIT_SCOPE[t.toolId]?.label ?? t.toolId
    }))
    const asideHeld = disabledToggles.slice(0, 3).map((t) => ({
      icon: TOOLKIT_SCOPE[t.toolId]?.icon ?? '·',
      label: t.actionLabel,
      meta: 'hold — requiere tu criterio'
    }))

    return (
      <div className="flex flex-1 overflow-hidden">
        {/* Main */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-[#1f2024]">
          {/* Header */}
          <div className="flex-shrink-0 border-b border-[#1f2024] px-9 pb-6 pt-7">
            <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55]">
              Take Over · fase 1 — antes de salir
            </div>
            <div className="mb-1 text-[22px] font-light leading-tight tracking-[-0.01em] text-[#e8e9eb]">
              Briefing de salida
            </div>
            <div className="max-w-[500px] text-[13px] leading-[1.55] text-[#7a7d85]">
              Dile al agente cuánto tiempo tienes fuera y qué puede tocar.{' '}
              <span className="text-[#f0a04b]">En 30 segundos queda listo.</span> Lo que no pueda
              resolver sin ti, lo guarda para cuando vuelvas.
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-9 py-6 [scrollbar-width:thin]">
            {/* Duration */}
            <div className="mb-7">
              <div className="mb-2.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024] after:content-['']">
                ¿Cuánto tiempo vas a estar fuera?
              </div>
              <div className="flex flex-wrap gap-1.5">
                {DURATION_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    onClick={() => setDurationPreset(chip)}
                    className={`rounded-full border px-3.5 py-1.5 text-[12px] transition-all ${
                      durationPreset === chip
                        ? 'border-[#f0a04b] bg-[rgba(240,160,75,.1)] text-[#f0a04b]'
                        : 'border-[#2a2b2f] text-[#7a7d85] hover:border-[#4a4d55] hover:text-[#e8e9eb]'
                    }`}
                  >
                    {chip}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  value={customHours}
                  onChange={(e) => setCustomHours(e.target.value)}
                  className="w-14 rounded border border-[#2a2b2f] bg-[#151618] px-2.5 py-1.5 text-center text-[12px] text-[#e8e9eb] outline-none transition-colors focus:border-[#5b7cf6]"
                  placeholder="N"
                />
                <span className="text-[12px] text-[#7a7d85]">
                  horas exactas — o activa manualmente cuando vuelvas
                </span>
              </div>
            </div>

            {/* Scope */}
            <div className="mb-7">
              <div className="mb-2.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024] after:content-['']">
                ¿Qué puede hacer el agente mientras estás fuera?
              </div>

              {connectedTools.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#2a2b2f] px-4 py-6 text-center text-[12px] text-[#4a4d55]">
                  No tienes herramientas conectadas.{' '}
                  <span className="text-[#7a7d85]">
                    Conéctalas en la sección Connections para que el agente pueda actuar.
                  </span>
                </div>
              ) : (
                <div className="overflow-hidden rounded-[10px] border border-[#1f2024] bg-[#151618]">
                  {connectedTools.flatMap((toolId) => {
                    const scope = TOOLKIT_SCOPE[toolId]
                    if (!scope) return []
                    return scope.actions.map((action) => {
                      const toggle = scopeToggles.find(
                        (t) => t.toolId === toolId && t.actionLabel === action.label
                      )
                      const enabled = toggle?.enabled ?? false
                      return (
                        <div
                          key={`${toolId}:${action.label}`}
                          className="flex cursor-pointer items-center gap-3.5 border-b border-[#1f2024] px-4 py-3 transition-colors last:border-b-0 hover:bg-[#1c1d20]"
                          onClick={() => toggleScope(toolId, action.label)}
                        >
                          {/* Icon */}
                          <div
                            className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[12px] ${
                              toolId === 'google-calendar'
                                ? 'bg-[rgba(91,124,246,.12)] text-[#5b7cf6]'
                                : toolId === 'gmail'
                                  ? 'bg-[rgba(155,114,245,.12)] text-[#9b72f5]'
                                  : toolId === 'slack'
                                    ? 'bg-[rgba(74,21,75,.3)] text-[#b39ddb]'
                                    : 'bg-[rgba(76,175,130,.1)] text-[#4caf82]'
                            }`}
                          >
                            {scope.icon}
                          </div>
                          {/* Info */}
                          <div className="flex-1">
                            <div className="mb-0.5 text-[12.5px] text-[#e8e9eb]">
                              {action.label}
                            </div>
                            <div className="text-[11px] leading-[1.3] text-[#4a4d55]">
                              {action.desc}
                            </div>
                          </div>
                          {/* Risk badge */}
                          <span
                            className={`flex-shrink-0 rounded-[2px] px-1.5 py-px font-mono text-[8px] ${RISK_BADGE[action.risk]}`}
                          >
                            {action.risk}
                          </span>
                          {/* Toggle */}
                          <div
                            className={`relative h-[18px] w-8 flex-shrink-0 rounded-full transition-colors ${
                              enabled ? 'bg-[#4caf82]' : 'bg-[#232428]'
                            }`}
                          >
                            <div
                              className={`absolute top-[2px] h-3.5 w-3.5 rounded-full bg-white transition-all ${
                                enabled ? 'right-[2px]' : 'left-[2px]'
                              }`}
                            />
                          </div>
                        </div>
                      )
                    })
                  })}
                </div>
              )}
            </div>

            {/* Exceptions */}
            <div className="mb-7">
              <div className="mb-2.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024] after:content-['']">
                ¿Algo que NO debe tocar? (opcional)
              </div>
              <textarea
                value={exceptions}
                onChange={(e) => setExceptions(e.target.value)}
                placeholder="ej. No respondas nada de Pedro hasta que hable con él. Ignora el hilo de la propuesta por ahora. Si llega algo del cliente Acme, guárdalo sin hacer nada."
                className="h-[72px] w-full resize-none rounded border border-[#2a2b2f] bg-[#151618] px-3.5 py-2.5 text-[12.5px] leading-[1.5] text-[#e8e9eb] outline-none transition-colors placeholder:text-[#4a4d55] focus:border-[#5b7cf6]"
              />
              <div className="mt-1.5 text-[11px] italic text-[#4a4d55]">
                El agente lee esto antes de actuar. Lo específico ayuda más que lo general.
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex flex-shrink-0 items-center gap-3 border-t border-[#1f2024] px-9 py-4">
            <button
              onClick={handleActivate}
              disabled={connectedTools.length === 0}
              className="flex items-center gap-1.5 rounded bg-[#f0a04b] px-7 py-2.5 text-[13px] font-semibold tracking-[.01em] text-[#1a1200] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M5 3l8 5-8 5V3z" />
              </svg>
              Activar Take Over
            </button>
            <div className="text-[11.5px] leading-[1.4] text-[#4a4d55]">
              El agente tomará el control{' '}
              <span className="font-medium text-[#7a7d85]">ahora mismo</span>.
              <br />
              Puedes detenerlo en cualquier momento desde cualquier vista.
            </div>
          </div>
        </div>

        {/* Aside */}
        <div className="flex w-[300px] flex-shrink-0 flex-col overflow-hidden">
          <div className="flex-shrink-0 border-b border-[#1f2024] px-5 pb-3.5 pt-5">
            <div className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55]">
              Lo que el agente ve ahora
            </div>
            <div className="text-[13px] font-light leading-[1.6] text-[#e8e9eb]">
              Hay{' '}
              <span className="text-[#f0a04b]">
                {scopeToggles.length} {scopeToggles.length === 1 ? 'acción' : 'acciones'}
              </span>{' '}
              configuradas. El agente puede manejar{' '}
              <span className="text-[#f0a04b]">{enabledToggles.length} de ellas</span> solo. Las
              otras {disabledToggles.length} las guarda para cuando vuelvas.
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-3.5 [scrollbar-width:thin]">
            {asideHandled.length > 0 && (
              <div className="mb-4.5">
                <div className="mb-2 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024] after:content-['']">
                  Manejará solo
                </div>
                {asideHandled.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 border-b border-[#1f2024] py-2 last:border-b-0"
                  >
                    <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[10px] bg-[rgba(76,175,130,.1)] text-[#4caf82]">
                      {item.icon}
                    </div>
                    <div className="flex-1">
                      <div className="text-[12px] leading-[1.3] text-[#7a7d85]">{item.label}</div>
                      <div className="font-mono text-[9px] text-[#4a4d55]">{item.meta}</div>
                    </div>
                    <span className="mt-0.5 flex-shrink-0 rounded-[2px] bg-[rgba(76,175,130,.1)] px-1.5 py-px font-mono text-[8px] text-[#4caf82]">
                      procesa
                    </span>
                  </div>
                ))}
              </div>
            )}

            {asideHeld.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024] after:content-['']">
                  Guardará para ti
                </div>
                {asideHeld.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 border-b border-[#1f2024] py-2 last:border-b-0"
                  >
                    <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[10px] bg-[rgba(212,168,67,.1)] text-[#d4a843]">
                      ⚑
                    </div>
                    <div className="flex-1">
                      <div className="text-[12px] leading-[1.3] text-[#7a7d85]">{item.label}</div>
                      <div className="font-mono text-[9px] text-[#4a4d55]">{item.meta}</div>
                    </div>
                    <span className="mt-0.5 flex-shrink-0 rounded-[2px] bg-[rgba(212,168,67,.1)] px-1.5 py-px font-mono text-[8px] text-[#d4a843]">
                      guarda
                    </span>
                  </div>
                ))}
              </div>
            )}

            {scopeToggles.length === 0 && (
              <div className="py-4 text-center text-[12px] text-[#4a4d55]">
                Conecta herramientas para ver el plan del agente.
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ─ PHASE 2: ACTIVE ────────────────────────────────────────────────────────────

  function renderActive(): React.JSX.Element {
    return (
      <div className="flex flex-1 overflow-hidden">
        {/* Main */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-[#1f2024]">
          {/* Hero */}
          <div className="flex-shrink-0 border-b border-[rgba(240,160,75,.2)] bg-gradient-to-b from-[rgba(240,160,75,.06)] to-transparent px-9 pb-5 pt-6">
            <div className="mb-2.5 inline-flex items-center gap-1.5 rounded-full border border-[rgba(240,160,75,.3)] bg-[rgba(240,160,75,.1)] px-3 py-1 font-mono text-[9px] tracking-[.08em] text-[#f0a04b]">
              <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#f0a04b]" />
              Take Over activo
            </div>
            <div className="mb-1 text-[22px] font-light leading-tight tracking-[-0.01em] text-[#e8e9eb]">
              El agente está a cargo
            </div>
            <div className="mb-3.5 flex items-center gap-4 text-[12px] text-[#7a7d85]">
              <span>
                Activado a las{' '}
                <strong className="font-medium text-[#e8e9eb]">{startedAtStr}</strong>
              </span>
              <span>·</span>
              <span className="font-mono text-[#f0a04b]">{elapsed}</span>
              {endAtStr && (
                <>
                  <span>·</span>
                  <span>
                    Termina a las <strong className="font-medium text-[#e8e9eb]">{endAtStr}</strong>
                  </span>
                </>
              )}
            </div>
            <div className="flex max-w-[480px] items-center gap-2.5">
              <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-[#232428]">
                <div
                  className="h-full rounded-full bg-[#f0a04b] transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex-shrink-0 font-mono text-[9px] text-[#4a4d55]">
                {progress}% del tiempo transcurrido
              </div>
            </div>
          </div>

          {/* Activity */}
          <div className="flex-1 overflow-y-auto px-9 py-5 [scrollbar-width:thin]">
            {/* Active */}
            {activeItems.length > 0 && (
              <div className="mb-6">
                <div className="mb-2.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024] after:content-['']">
                  Manejando ahora
                  <span className="rounded-[3px] bg-[#232428] px-1.5 py-px text-[9px] text-[#4a4d55]">
                    {activeItems.length} activo
                  </span>
                </div>
                {activeItems.map((item) => (
                  <ActivityRow key={item.id} item={item} />
                ))}
              </div>
            )}

            {/* Done */}
            {doneItems.length > 0 && (
              <div className="mb-6">
                <div className="mb-2.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024] after:content-['']">
                  Completado
                  <span className="rounded-[3px] bg-[#232428] px-1.5 py-px text-[9px] text-[#4a4d55]">
                    {doneItems.length} ítems
                  </span>
                </div>
                {doneItems.map((item) => (
                  <ActivityRow key={item.id} item={item} />
                ))}
              </div>
            )}

            {/* Held */}
            {heldItems.length > 0 && (
              <div className="mb-6">
                <div className="mb-2.5 flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55] after:h-px after:flex-1 after:bg-[#1f2024] after:content-['']">
                  Guardando para ti
                  <span className="rounded-[3px] bg-[#232428] px-1.5 py-px text-[9px] text-[#4a4d55]">
                    {heldItems.length} ítems
                  </span>
                </div>
                {heldItems.map((item) => (
                  <ActivityRow key={item.id} item={item} />
                ))}
              </div>
            )}

            {activityItems.length === 0 && (
              <div className="py-8 text-center text-[12px] text-[#4a4d55]">
                El agente está inicializando...
              </div>
            )}
          </div>
        </div>

        {/* Aside */}
        <div className="flex w-[280px] flex-shrink-0 flex-col overflow-hidden">
          {/* Stats */}
          <div className="flex flex-shrink-0 flex-col gap-3 border-b border-[#1f2024] p-5">
            <div className="mb-1.5 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55]">
              Resumen
            </div>
            <StatRow label="Ítems manejados" value={String(doneItems.length)} color="good" />
            <StatRow label="Guardados para ti" value={String(heldItems.length)} color="warn" />
            <StatRow label="Acciones high-risk" value="0" color="good" />
          </div>

          {/* Held list */}
          <div className="flex-1 overflow-y-auto px-5 py-4 [scrollbar-width:thin]">
            <div className="mb-2.5 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55]">
              En espera · tu criterio
            </div>
            {heldItems.length === 0 ? (
              <div className="text-[11.5px] text-[#4a4d55]">
                Nada guardado todavía — el agente está manejando todo.
              </div>
            ) : (
              heldItems.map((item) => (
                <div
                  key={item.id}
                  className="mb-1.5 rounded-md border border-l-2 border-[#1f2024] border-l-[#d4a843] bg-[#151618] px-3 py-2.5"
                >
                  <div className="mb-0.5 text-[12px] leading-[1.3] text-[#e8e9eb]">
                    {item.title}
                  </div>
                  <div className="text-[11px] italic leading-[1.4] text-[#4a4d55]">{item.sub}</div>
                </div>
              ))
            )}
          </div>

          {/* Stop */}
          <div className="flex-shrink-0 border-t border-[#1f2024] p-3.5">
            <button
              onClick={handleReturn}
              className="flex w-full items-center justify-center gap-1.5 rounded border border-[rgba(224,92,92,.35)] bg-transparent py-2.5 text-[12px] text-[#e05c5c] transition-all hover:border-[#e05c5c] hover:bg-[rgba(224,92,92,.1)]"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                <rect x="3" y="3" width="10" height="10" rx="1" />
              </svg>
              Ya volví — terminar Take Over
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─ PHASE 3: RETURN ────────────────────────────────────────────────────────────

  function renderReturn(): React.JSX.Element {
    return (
      <div className="flex flex-1 overflow-hidden">
        {/* Main */}
        <div className="flex flex-1 flex-col overflow-hidden border-r border-[#1f2024]">
          {/* Header */}
          <div className="flex-shrink-0 border-b border-[#1f2024] px-9 pb-5 pt-6">
            <div className="mb-2.5 inline-flex items-center gap-1.5 rounded-full border border-[rgba(76,175,130,.3)] bg-[rgba(76,175,130,.1)] px-3 py-1 font-mono text-[9px] text-[#4caf82]">
              <svg
                width="8"
                height="8"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M3 8l4 4 6-7" />
              </svg>
              Bienvenido de vuelta
            </div>
            <div className="mb-1 text-[22px] font-light leading-tight tracking-[-0.01em] text-[#e8e9eb]">
              Mientras estuviste fuera
            </div>
            <div className="mb-3.5 text-[12px] text-[#7a7d85]">
              Take Over activo {durationStr} · {startedAtStr} – ahora
            </div>
            <div className="flex gap-4.5">
              <ReturnStat
                value={String(doneCards.length)}
                label="manejados"
                color="text-[#e8e9eb]"
              />
              <div className="w-px bg-[#1f2024]" />
              <ReturnStat
                value={String(heldCards.filter((c) => !c.acknowledged).length)}
                label="necesitan tu atención"
                color="text-[#d4a843]"
              />
              <div className="w-px bg-[#1f2024]" />
              <ReturnStat value="0" label="acciones high-risk" color="text-[#4caf82]" />
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-9 py-5 [scrollbar-width:thin]">
            {/* Needs attention */}
            {heldCards.length > 0 && (
              <div className="mb-7">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[5px] bg-[rgba(212,168,67,.1)] text-[11px] text-[#d4a843]">
                    ⚑
                  </div>
                  <div className="text-[12.5px] font-medium text-[#e8e9eb]">
                    Necesitan tu atención
                  </div>
                  <span className="rounded-[3px] bg-[#232428] px-1.5 py-px font-mono text-[9px] text-[#4a4d55]">
                    {heldCards.filter((c) => !c.acknowledged).length}
                  </span>
                </div>
                <div className="flex flex-col gap-2">
                  {heldCards.map((card) => (
                    <div
                      key={card.id}
                      className={`flex items-start gap-2.5 rounded-lg border border-l-2 border-[#1f2024] border-l-[#d4a843] bg-[#151618] px-3.5 py-3 transition-opacity ${
                        card.acknowledged ? 'opacity-55' : ''
                      }`}
                    >
                      {/* Checkbox */}
                      <button
                        onClick={() => acknowledgeHeld(card.id)}
                        className={`mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded border transition-all ${
                          card.acknowledged
                            ? 'border-[#4caf82] bg-[#4caf82]'
                            : 'border-[#2a2b2f] bg-transparent'
                        }`}
                      >
                        {card.acknowledged && (
                          <span className="text-[9px] font-bold text-white">✓</span>
                        )}
                      </button>
                      {/* Body */}
                      <div className="flex-1">
                        <div className="mb-0.5 text-[12.5px] font-medium leading-[1.3] text-[#e8e9eb]">
                          {card.title}
                        </div>
                        <div className="mb-1.5 text-[11.5px] leading-[1.4] text-[#7a7d85]">
                          {card.desc || 'Requiere tu criterio antes de actuar.'}
                        </div>
                        {card.detail && (
                          <div className="mb-1.5 rounded bg-[#1c1d20] px-2 py-1 font-mono text-[10px] leading-[1.5] text-[#4a4d55]">
                            {card.detail}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`rounded-[2px] px-1.5 py-px font-mono text-[8px] ${TAG_TOOL}`}
                          >
                            {card.tool}
                          </span>
                          <span
                            className={`rounded-[2px] px-1.5 py-px font-mono text-[8px] ${
                              card.risk === 'high' ? TAG_HIGH : TAG_HOLD
                            }`}
                          >
                            {card.risk}-risk
                          </span>
                        </div>
                      </div>
                      {/* Actions */}
                      <div className="flex flex-shrink-0 flex-col gap-1.5">
                        <button className="rounded border border-[#5b7cf6] bg-[#5b7cf6] px-2.5 py-1.5 text-[11px] font-medium text-white transition-opacity hover:opacity-90">
                          {card.primaryAction}
                        </button>
                        <button className="rounded border border-[#2a2b2f] bg-transparent px-2.5 py-1.5 text-[11px] text-[#7a7d85] transition-all hover:border-[#4a4d55] hover:text-[#e8e9eb]">
                          Ignorar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Agent handled */}
            {doneCards.length > 0 && (
              <div className="mb-7">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[5px] bg-[rgba(76,175,130,.1)] text-[11px] text-[#4caf82]">
                    ✓
                  </div>
                  <div className="text-[12.5px] font-medium text-[#e8e9eb]">
                    El agente se encargó
                  </div>
                  <span className="rounded-[3px] bg-[#232428] px-1.5 py-px font-mono text-[9px] text-[#4a4d55]">
                    {doneCards.length}
                  </span>
                  <button
                    onClick={markAllSeen}
                    className="ml-auto rounded border border-transparent bg-transparent px-2 py-0.5 font-mono text-[9px] text-[#4a4d55] transition-all hover:border-[#4caf82] hover:text-[#4caf82]"
                  >
                    marcar todos como vistos
                  </button>
                </div>
                <div className="flex flex-col gap-2">
                  {doneCards.map((card) => (
                    <div
                      key={card.id}
                      className={`flex items-start gap-2.5 rounded-lg border border-[#1f2024] bg-[#151618] px-3.5 py-3 transition-opacity ${
                        card.seen ? 'opacity-55' : ''
                      }`}
                    >
                      <div className="mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded border border-[#4caf82] bg-[#4caf82]">
                        <span className="text-[9px] font-bold text-white">✓</span>
                      </div>
                      <div className="flex-1">
                        <div className="mb-0.5 text-[12.5px] font-medium leading-[1.3] text-[#e8e9eb]">
                          {card.title}
                        </div>
                        <div className="mb-1.5 text-[11.5px] leading-[1.4] text-[#7a7d85]">
                          {card.desc}
                        </div>
                        <div className="flex gap-1.5">
                          <span
                            className={`rounded-[2px] px-1.5 py-px font-mono text-[8px] ${TAG_DONE}`}
                          >
                            completado
                          </span>
                          <span
                            className={`rounded-[2px] px-1.5 py-px font-mono text-[8px] ${TAG_TOOL}`}
                          >
                            {card.tool}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {doneCards.length === 0 && heldCards.length === 0 && (
              <div className="py-8 text-center text-[12px] text-[#4a4d55]">
                No hay actividad registrada en esta sesión.
              </div>
            )}

            {/* New take over button */}
            <div className="pt-2">
              <button
                onClick={handleReset}
                className="rounded border border-[#2a2b2f] bg-transparent px-4 py-2 text-[12px] text-[#7a7d85] transition-all hover:border-[#4a4d55] hover:text-[#e8e9eb]"
              >
                Iniciar nuevo Take Over
              </button>
            </div>
          </div>
        </div>

        {/* Aside */}
        <div className="flex w-[280px] flex-shrink-0 flex-col gap-4.5 overflow-y-auto p-5 [scrollbar-width:thin]">
          <div>
            <div className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55]">
              Lectura del agente
            </div>
            <div className="mb-2.5 text-[13px] font-light leading-[1.6] text-[#e8e9eb]">
              {doneCards.length > 0
                ? `Manejé ${doneCards.length} ${doneCards.length === 1 ? 'ítem' : 'ítems'} mientras estuviste fuera.`
                : 'Estuve monitoreando sin encontrar nada que procesar solo.'}{' '}
              {heldCards.length > 0 && (
                <span className="text-[#f0a04b]">
                  Los {heldCards.length} ítems pendientes requieren tu criterio.
                </span>
              )}
            </div>
            {heldCards.length > 0 && (
              <div className="border-l-2 border-[#2a2b2f] pl-2.5 text-[12px] italic leading-[1.5] text-[#7a7d85]">
                Revisa los ítems marcados — algunos pueden tener urgencia.
              </div>
            )}
          </div>

          <div className="h-px bg-[#1f2024]" />

          {timeline.length > 0 && (
            <div>
              <div className="mb-2 font-mono text-[9px] uppercase tracking-[.1em] text-[#4a4d55]">
                Línea de tiempo
              </div>
              <div>
                {timeline.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2.5 border-b border-[#1f2024] py-2 last:border-b-0"
                  >
                    <div
                      className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                        item.status === 'done' ? 'bg-[#4caf82]' : 'bg-[#d4a843]'
                      }`}
                    />
                    <div className="flex-1">
                      <div className="text-[11.5px] leading-[1.3] text-[#7a7d85]">{item.text}</div>
                      <div className="font-mono text-[9px] text-[#4a4d55]">{item.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Root render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#0e0f11] font-sans text-[13px] text-[#e8e9eb]">
      {phase === 'briefing' && renderBriefing()}
      {phase === 'active' && renderActive()}
      {phase === 'return' && renderReturn()}
    </div>
  )
}

// ── Small helper components ───────────────────────────────────────────────────

function ActivityRow({ item }: { item: ActivityItem }): React.JSX.Element {
  return (
    <div className="flex items-start gap-2.5 border-b border-[#1f2024] py-2.5 last:border-b-0">
      <div className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${ACT_DOT[item.status]}`} />
      <div className="flex-1">
        <div className="mb-0.5 text-[12.5px] leading-[1.3] text-[#e8e9eb]">{item.title}</div>
        <div className="mb-1.5 text-[11.5px] leading-[1.4] text-[#7a7d85]">{item.sub}</div>
        <div className="flex flex-wrap gap-1.5">
          {item.status === 'done' && (
            <span className={`rounded-[2px] px-1.5 py-px font-mono text-[8px] ${TAG_DONE}`}>
              completado
            </span>
          )}
          {item.status === 'held' && (
            <span className={`rounded-[2px] px-1.5 py-px font-mono text-[8px] ${TAG_HOLD}`}>
              guardado
            </span>
          )}
          {item.risk === 'high' && (
            <span className={`rounded-[2px] px-1.5 py-px font-mono text-[8px] ${TAG_HIGH}`}>
              high-risk
            </span>
          )}
          <span className={`rounded-[2px] px-1.5 py-px font-mono text-[8px] ${TAG_TOOL}`}>
            {item.tool}
          </span>
        </div>
      </div>
      <div className="flex-shrink-0 font-mono text-[9px] text-[#4a4d55]">{item.time}</div>
    </div>
  )
}

function StatRow({
  label,
  value,
  color
}: {
  label: string
  value: string
  color: 'good' | 'warn' | 'neutral'
}): React.JSX.Element {
  const valClass =
    color === 'good' ? 'text-[#4caf82]' : color === 'warn' ? 'text-[#d4a843]' : 'text-[#e8e9eb]'
  return (
    <div className="flex items-center justify-between text-[12px] text-[#7a7d85]">
      <span>{label}</span>
      <span className={`font-mono text-[13px] font-medium ${valClass}`}>{value}</span>
    </div>
  )
}

function ReturnStat({
  value,
  label,
  color
}: {
  value: string
  label: string
  color: string
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <div className={`font-mono text-[18px] font-light ${color}`}>{value}</div>
      <div className="text-[10.5px] text-[#4a4d55]">{label}</div>
    </div>
  )
}
