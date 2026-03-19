import { useState, useEffect, useRef } from 'react'
import { Switch } from '@/components/ui/switch'
import { Loader2, FolderOpen } from 'lucide-react'
import { LLM_PROVIDERS, type LLMProviderKey } from '@/lib/constants'
import { useSettingsStore } from '@/stores/settings-store'
import { useTrustStore } from '@/stores/trust-store'
import { useUsageStore } from '@/stores/usage-store'
import { TRUST_PROFILES, type TrustProfile } from '@/types/trust'
import { BYOKGuide } from './BYOKGuide'
import { TelemetryDataCategories } from './TelemetryDataCategories'
import { TelemetryViewer } from './TelemetryViewer'
import { SystemHealth } from './SystemHealth'

// ── Mono font shorthand ──────────────────────────────────────
const MONO = "'IBM Plex Mono', monospace"

// ── Left nav sections ────────────────────────────────────────
const SECTIONS = [
  { id: 'trust',     label: 'Perfil de confianza', group: 'Comportamiento' },
  { id: 'rhythm',    label: 'Tu rutina',            group: 'Comportamiento' },
  { id: 'usage',     label: 'Uso del agente',        group: 'Avanzado' },
  { id: 'byok',      label: 'API propia (BYOK)',     group: 'Avanzado' },
  { id: 'composio',  label: 'Composio (tools)',      group: 'Avanzado' },
  { id: 'telemetry', label: 'Datos de investigación',group: 'Avanzado' },
  { id: 'health',    label: 'System Health',         group: 'Avanzado' },
]

// ── Trust profile extended data ──────────────────────────────
const TRUST_EXTRA: Record<
  TrustProfile,
  { tag: string; tagCls: string; scenario: string; risks: { label: string; cls: string }[] }
> = {
  cautious: {
    tag: 'recomendado para empezar',
    tagCls: 'bg-[rgba(76,175,130,.1)] text-[#4caf82]',
    scenario:
      'Llega un email de un cliente. El agente lee, redacta una respuesta y <strong style="color:#e8e9eb;font-weight:500">te la muestra para que la apruebes</strong> antes de enviar. También te pide confirmación antes de crear cualquier tarea.',
    risks: [
      { label: 'low · silencioso', cls: 'bg-[rgba(76,175,130,.1)] text-[#4caf82]' },
      { label: 'mid · confirmar',  cls: 'bg-[rgba(212,168,67,.1)] text-[#d4a843]' },
      { label: 'high · bloquea',   cls: 'bg-[rgba(224,92,92,.1)] text-[#e05c5c]' },
    ],
  },
  balanced: {
    tag: 'más popular',
    tagCls: 'bg-[rgba(91,124,246,.12)] text-[#5b7cf6]',
    scenario:
      'El agente archiva y etiqueta tu inbox <em style="font-style:normal">sin preguntarte</em>. Si quiere enviar un email en tu nombre, aparece un aviso con un botón para aprobar o cancelar en 30 segundos.',
    risks: [
      { label: 'low · silencioso',      cls: 'bg-[rgba(76,175,130,.1)] text-[#4caf82]' },
      { label: 'mid · notifica + undo', cls: 'bg-[rgba(212,168,67,.1)] text-[#d4a843]' },
      { label: 'high · bloquea',        cls: 'bg-[rgba(224,92,92,.1)] text-[#e05c5c]' },
    ],
  },
  autonomous: {
    tag: 'para Take Over',
    tagCls: 'bg-[rgba(240,160,75,.1)] text-[#f0a04b]',
    scenario:
      'El agente procesa tu inbox, crea tareas y cancela una reunión de bajo impacto solo. Aparece una cuenta regresiva de 2 min para el envío de un email — si no la cancelas, se envía.',
    risks: [
      { label: 'low · silencioso',       cls: 'bg-[rgba(76,175,130,.1)] text-[#4caf82]' },
      { label: 'mid · silencioso',       cls: 'bg-[rgba(212,168,67,.1)] text-[#d4a843]' },
      { label: 'high · 2 min countdown', cls: 'bg-[rgba(224,92,92,.1)] text-[#e05c5c]' },
    ],
  },
}

// ── Helpers ──────────────────────────────────────────────────
function formatTime(value: string): string {
  if (!value) return '—'
  const [hStr, mStr] = value.split(':')
  const h = parseInt(hStr, 10)
  const m = mStr ?? '00'
  const suffix = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${m} ${suffix}`
}

// ── Section header ────────────────────────────────────────────
function SectionHeader({
  eyebrow,
  title,
  desc,
}: {
  eyebrow: string
  title: string
  desc: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-5">
      <div
        className="text-[9px] uppercase tracking-[.12em] text-[#4a4d55] mb-1.5"
        style={{ fontFamily: MONO }}
      >
        {eyebrow}
      </div>
      <div className="text-[17px] font-light text-[#e8e9eb] tracking-[-0.01em] mb-1.5">{title}</div>
      <div className="text-[12.5px] text-[#7a7d85] leading-[1.55] max-w-[480px]">{desc}</div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────
export function SettingsPage(): React.JSX.Element {
  // BYOK state
  const [selectedProvider, setSelectedProvider] = useState<LLMProviderKey>('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [apiKeyHint, setApiKeyHint] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  // Telemetry viewer
  const [showTelemetryViewer, setShowTelemetryViewer] = useState(false)
  // Composio key state
  const [composioKey, setComposioKey] = useState('')
  const [composioKeyHint, setComposioKeyHint] = useState<string | null>(null)
  const [savingComposio, setSavingComposio] = useState(false)
  const [composioFeedback, setComposioFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  // Rhythm: inline edit state
  const [editingTime, setEditingTime] = useState<'morning' | 'eod' | null>(null)

  // Left nav active section
  const [activeSection, setActiveSection] = useState('trust')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Stores
  const settings = useSettingsStore()
  const { loadSettings } = settings
  const { costUsd, requestCount, fetchUsage } = useUsageStore()
  const trustProfile = useTrustStore((s) => s.profile)
  const setTrustProfile = useTrustStore((s) => s.setProfile)
  const loadTrustProfile = useTrustStore((s) => s.loadProfile)

  // Load on mount
  useEffect(() => {
    loadSettings()
    loadLLMConfig()
    loadComposioConfig()
    loadTrustProfile()
    fetchUsage()
  }, [loadSettings, loadTrustProfile, fetchUsage])

  async function loadComposioConfig(): Promise<void> {
    try {
      const result = await window.api.composio.getApiKey()
      if (result?.hint) setComposioKeyHint(result.hint)
    } catch {
      // No key configured
    }
  }

  async function handleSaveComposioKey(): Promise<void> {
    if (!composioKey.trim()) return
    setSavingComposio(true)
    setComposioFeedback(null)
    try {
      const result = await window.api.composio.setApiKey(composioKey)
      if (result.success) {
        setComposioKeyHint(composioKey.slice(0, 4) + '...' + composioKey.slice(-4))
        setComposioKey('')
        setComposioFeedback({ type: 'success', message: 'Composio API key guardada.' })
      } else {
        setComposioFeedback({ type: 'error', message: result.error || 'Error al guardar' })
      }
    } catch (err) {
      setComposioFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Error al guardar' })
    } finally {
      setSavingComposio(false)
    }
  }

  // Scroll-spy via IntersectionObserver
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setActiveSection(e.target.id.replace('s-', ''))
          }
        }
      },
      { root, rootMargin: '-25% 0px -65% 0px', threshold: 0 }
    )
    SECTIONS.forEach(({ id }) => {
      const el = root.querySelector(`#s-${id}`)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  function scrollToSection(id: string): void {
    const el = scrollRef.current?.querySelector(`#s-${id}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveSection(id)
  }

  async function loadLLMConfig(): Promise<void> {
    try {
      const config = await window.api.llm.getConfig()
      if (config) {
        setSelectedProvider(config.provider as LLMProviderKey)
        setApiKeyHint(config.apiKeyHint)
      }
    } catch {
      // No config yet
    }
  }

  async function handleTestAndSave(): Promise<void> {
    if (!apiKey.trim()) {
      setFeedback({ type: 'error', message: 'Por favor ingresa una API key' })
      return
    }
    setTesting(true)
    setFeedback(null)
    try {
      const result = await window.api.llm.testConnection(selectedProvider, apiKey)
      if (!result.success) {
        setFeedback({ type: 'error', message: result.error || 'Error al probar la conexión' })
        setTesting(false)
        return
      }
      setTesting(false)
      setSaving(true)
      const provider = LLM_PROVIDERS[selectedProvider]
      await window.api.llm.saveConfig(selectedProvider, provider.defaultModel, apiKey)
      await window.api.gateway.restart()
      setApiKeyHint('****' + apiKey.slice(-4))
      setApiKey('')
      setFeedback({ type: 'success', message: 'API key guardada. Gateway reiniciado.' })
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Error al guardar' })
    } finally {
      setTesting(false)
      setSaving(false)
    }
  }

  function handleToggleBYOK(enabled: boolean): void {
    settings.setSetting('byokEnabled', enabled)
    if (!enabled) settings.setSetting('byokProvider', null)
  }

  async function handleTelemetryToggle(optIn: boolean): Promise<void> {
    settings.setSetting('telemetryOptIn', optIn)
    await window.api.telemetry.setOptIn(optIn)
  }

  async function handleDeleteTelemetryData(): Promise<void> {
    await window.api.telemetry.deleteData()
    setFeedback({ type: 'success', message: 'Datos de telemetría eliminados.' })
  }

  async function handleSelectFolder(): Promise<void> {
    const path = await window.api.fs.selectFolder()
    if (path) settings.setSetting('folderWatchPath', path)
  }

  // Usage is now informational only (no ceiling)

  return (
    <div className="flex h-full overflow-hidden bg-background" style={{ color: '#e8e9eb', fontSize: 13 }}>

      {/* ── Left nav ── */}
      <div
        className="w-[200px] flex-shrink-0 flex flex-col py-5 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ borderRight: '1px solid #1f2024' }}
      >
        <div className="px-4 mb-5 text-[16px] font-light text-[#e8e9eb] tracking-[-0.01em]">
          Ajustes
        </div>

        {/* Group: Comportamiento */}
        <div className="mb-1 px-4">
          <div className="text-[8.5px] uppercase tracking-[.12em] text-[#4a4d55] mb-1" style={{ fontFamily: MONO }}>
            Comportamiento
          </div>
        </div>
        {SECTIONS.filter((s) => s.group === 'Comportamiento').map((s) => (
          <button
            key={s.id}
            onClick={() => scrollToSection(s.id)}
            className="mx-2.5 flex items-center gap-2 px-2 py-[7px] rounded-[6px] text-[12px] cursor-pointer transition-all text-left"
            style={{
              background: activeSection === s.id ? 'rgba(91,124,246,.12)' : 'transparent',
              color: activeSection === s.id ? '#5b7cf6' : '#7a7d85',
            }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors"
              style={{ background: activeSection === s.id ? '#5b7cf6' : '#4a4d55' }}
            />
            {s.label}
          </button>
        ))}

        <div className="mx-4 my-2.5 h-px" style={{ background: '#1f2024' }} />

        {/* Group: Avanzado */}
        <div className="mb-1 px-4">
          <div className="text-[8.5px] uppercase tracking-[.12em] text-[#4a4d55] mb-1" style={{ fontFamily: MONO }}>
            Avanzado
          </div>
        </div>
        {SECTIONS.filter((s) => s.group === 'Avanzado').map((s) => (
          <button
            key={s.id}
            onClick={() => scrollToSection(s.id)}
            className="mx-2.5 flex items-center gap-2 px-2 py-[7px] rounded-[6px] text-[12px] cursor-pointer transition-all text-left"
            style={{
              background: activeSection === s.id ? 'rgba(91,124,246,.12)' : 'transparent',
              color: activeSection === s.id ? '#5b7cf6' : '#7a7d85',
            }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors"
              style={{ background: activeSection === s.id ? '#5b7cf6' : '#4a4d55' }}
            />
            {s.label}
          </button>
        ))}
      </div>

      {/* ── Main content ── */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ padding: '32px 40px' }}
      >

        {/* ══ §1 Trust Profile ══ */}
        <section id="s-trust" className="max-w-[620px] mb-12" style={{ scrollMarginTop: 32 }}>
          <SectionHeader
            eyebrow="Comportamiento · 1 de 2"
            title="Perfil de confianza"
            desc={
              <>
                Define cuánta autonomía tiene el agente cuando actúa en tu nombre.{' '}
                <span style={{ color: '#f0a04b' }}>Puedes cambiarlo en cualquier momento</span> — el agente se adapta de inmediato.
              </>
            }
          />

          <div className="flex flex-col gap-2">
            {(Object.entries(TRUST_PROFILES) as [TrustProfile, (typeof TRUST_PROFILES)[TrustProfile]][]).map(
              ([key, config]) => {
                const extra = TRUST_EXTRA[key]
                const selected = trustProfile === key
                return (
                  <div
                    key={key}
                    onClick={() => setTrustProfile(key)}
                    className="relative overflow-hidden rounded-[10px] cursor-pointer transition-all"
                    style={{
                      background: '#151618',
                      border: `1.5px solid ${selected ? '#5b7cf6' : '#1f2024'}`,
                    }}
                  >
                    {/* Top blue bar when selected */}
                    {selected && (
                      <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: '#5b7cf6' }} />
                    )}

                    {/* Card header row */}
                    <div className="flex items-center gap-3 px-4 pt-3.5 pb-3">
                      {/* Radio dot */}
                      <div
                        className="w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all"
                        style={{
                          borderColor: selected ? '#5b7cf6' : '#2a2b2f',
                          background: selected ? '#5b7cf6' : 'transparent',
                        }}
                      >
                        {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <div className="flex-1 text-[13.5px] font-medium text-[#e8e9eb]">{config.label}</div>
                      <span
                        className="text-[8px] px-[7px] py-[2px] rounded-[3px]"
                        style={{ fontFamily: MONO }}
                      >
                        <span className={`${extra.tagCls} text-[8px] px-[7px] py-[2px] rounded-[3px]`} style={{ fontFamily: MONO }}>
                          {extra.tag}
                        </span>
                      </span>
                    </div>

                    {/* Description */}
                    <div className="text-[12px] text-[#7a7d85] leading-[1.45] px-4 pb-3.5 pl-[44px]">
                      {config.description}
                    </div>

                    {/* Scenario */}
                    <div
                      className="mx-4 mb-3.5 ml-[44px] rounded-[6px] p-2.5 flex gap-2.5 items-start"
                      style={{ background: '#1c1d20', border: '1px solid #1f2024' }}
                    >
                      <span
                        className="text-[8px] text-[#4a4d55] flex-shrink-0 mt-0.5 tracking-[.06em] whitespace-nowrap"
                        style={{ fontFamily: MONO }}
                      >
                        EJEMPLO
                      </span>
                      <div
                        className="text-[11.5px] text-[#7a7d85] leading-[1.45]"
                        dangerouslySetInnerHTML={{ __html: extra.scenario }}
                      />
                    </div>

                    {/* Risk row */}
                    <div className="flex gap-1.5 px-4 pb-3.5 pl-[44px]">
                      {extra.risks.map((r) => (
                        <span
                          key={r.label}
                          className={`${r.cls} text-[8px] px-[7px] py-[2px] rounded-[3px]`}
                          style={{ fontFamily: MONO }}
                        >
                          {r.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )
              }
            )}
          </div>
        </section>

        {/* ══ §2 Tu Rutina ══ */}
        <section id="s-rhythm" className="max-w-[620px] mb-12" style={{ scrollMarginTop: 32 }}>
          <SectionHeader
            eyebrow="Comportamiento · 2 de 2"
            title="Tu rutina"
            desc="Cuándo quieres que el agente te hable y cómo se integra en tu día. El agente aprende tu ritmo con el tiempo, pero estas son las anclas base."
          />

          <div className="grid grid-cols-2 gap-2.5">
            {/* Morning briefing */}
            <div
              className="rounded-lg p-3"
              style={{ background: '#151618', border: '1px solid #1f2024' }}
            >
              <div className="text-[11px] text-[#4a4d55] mb-1.5">Briefing matutino</div>
              <div className="flex items-center justify-between">
                {editingTime === 'morning' ? (
                  <input
                    type="time"
                    value={settings.morningBriefingTime}
                    onChange={(e) => settings.setSetting('morningBriefingTime', e.target.value)}
                    onBlur={() => setEditingTime(null)}
                    autoFocus
                    className="text-[14px] text-[#e8e9eb] bg-transparent outline-none border-b border-[#5b7cf6]"
                  />
                ) : (
                  <span className="text-[14px] text-[#e8e9eb]">{formatTime(settings.morningBriefingTime)}</span>
                )}
                <button
                  onClick={() => setEditingTime('morning')}
                  className="text-[9px] text-[#4a4d55] px-2 py-1 rounded border border-transparent hover:border-[#2a2b2f] hover:text-[#7a7d85] transition-all"
                  style={{ fontFamily: MONO }}
                >
                  editar
                </button>
              </div>
            </div>

            {/* EOD summary */}
            <div
              className="rounded-lg p-3"
              style={{ background: '#151618', border: '1px solid #1f2024' }}
            >
              <div className="text-[11px] text-[#4a4d55] mb-1.5">Resumen de fin de día</div>
              <div className="flex items-center justify-between">
                {editingTime === 'eod' ? (
                  <input
                    type="time"
                    value={settings.eodSummaryTime}
                    onChange={(e) => settings.setSetting('eodSummaryTime', e.target.value)}
                    onBlur={() => setEditingTime(null)}
                    autoFocus
                    className="text-[14px] text-[#e8e9eb] bg-transparent outline-none border-b border-[#5b7cf6]"
                  />
                ) : (
                  <span className="text-[14px] text-[#e8e9eb]">{formatTime(settings.eodSummaryTime)}</span>
                )}
                <button
                  onClick={() => setEditingTime('eod')}
                  className="text-[9px] text-[#4a4d55] px-2 py-1 rounded border border-transparent hover:border-[#2a2b2f] hover:text-[#7a7d85] transition-all"
                  style={{ fontFamily: MONO }}
                >
                  editar
                </button>
              </div>
            </div>

            {/* Take Over summary interval */}
            <div
              className="rounded-lg p-3"
              style={{ background: '#151618', border: '1px solid #1f2024' }}
            >
              <div className="text-[11px] text-[#4a4d55] mb-1.5">Intervalo de resumen en Take Over</div>
              <div className="flex items-center justify-between">
                <select
                  value={String(settings.takeOverSummaryInterval)}
                  onChange={(e) => settings.setSetting('takeOverSummaryInterval', Number(e.target.value))}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontSize: 14,
                    color: '#e8e9eb',
                    outline: 'none',
                    cursor: 'pointer',
                    width: '100%',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    fontFamily: 'inherit',
                  }}
                >
                  <option value="1" style={{ background: '#232428' }}>Cada hora</option>
                  <option value="2" style={{ background: '#232428' }}>Cada 2 horas</option>
                  <option value="3" style={{ background: '#232428' }}>Cada 3 horas</option>
                  <option value="4" style={{ background: '#232428' }}>Cada 4 horas</option>
                </select>
              </div>
            </div>

            {/* Take Over auto-disable */}
            <div
              className="rounded-lg p-3"
              style={{ background: '#151618', border: '1px solid #1f2024' }}
            >
              <div className="text-[11px] text-[#4a4d55] mb-1.5">Take Over se desactiva después de</div>
              <div className="flex items-center justify-between">
                <select
                  value={String(settings.takeOverAutoDisable)}
                  onChange={(e) => settings.setSetting('takeOverAutoDisable', Number(e.target.value))}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    fontSize: 14,
                    color: '#e8e9eb',
                    outline: 'none',
                    cursor: 'pointer',
                    width: '100%',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    fontFamily: 'inherit',
                  }}
                >
                  {[4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
                    <option key={h} value={String(h)} style={{ background: '#232428' }}>
                      {h} horas
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Folder watch — full width */}
            <div
              className="col-span-2 rounded-lg p-3 flex items-start gap-3"
              style={{ background: '#151618', border: '1px solid #1f2024' }}
            >
              <div className="flex-1">
                <div className="text-[13px] text-[#e8e9eb] mb-1">Carpeta vigilada de transcripciones</div>
                <div className="text-[11.5px] text-[#4a4d55] leading-[1.4]">
                  El agente procesa automáticamente los archivos nuevos que aparezcan en esta carpeta.
                </div>
                {settings.folderWatchEnabled && settings.folderWatchPath && (
                  <div
                    className="text-[10px] text-[#5b7cf6] mt-1.5 flex items-center gap-1.5 cursor-pointer hover:underline"
                    onClick={handleSelectFolder}
                  >
                    <FolderOpen className="w-3 h-3" />
                    {settings.folderWatchPath}
                  </div>
                )}
                {settings.folderWatchEnabled && !settings.folderWatchPath && (
                  <button
                    onClick={handleSelectFolder}
                    className="mt-1.5 text-[10px] text-[#5b7cf6] underline cursor-pointer bg-transparent border-0 p-0"
                    style={{ fontFamily: MONO }}
                  >
                    Seleccionar carpeta
                  </button>
                )}
              </div>
              {/* Custom toggle */}
              <div
                onClick={() => settings.setSetting('folderWatchEnabled', !settings.folderWatchEnabled)}
                className="flex-shrink-0 mt-0.5 cursor-pointer"
              >
                <div
                  className="w-[34px] h-[19px] rounded-[10px] relative transition-colors"
                  style={{ background: settings.folderWatchEnabled ? '#4caf82' : '#232428' }}
                >
                  <div
                    className="absolute w-[15px] h-[15px] rounded-full bg-white top-[2px] transition-all"
                    style={{ [settings.folderWatchEnabled ? 'right' : 'left']: 2 }}
                  />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ══ Avanzado divider ══ */}
        <div className="flex items-center gap-3 max-w-[620px] mb-12 mt-4">
          <div className="flex-1 h-px" style={{ background: '#1f2024' }} />
          <span
            className="text-[9px] text-[#4a4d55] uppercase tracking-[.1em] whitespace-nowrap"
            style={{ fontFamily: MONO }}
          >
            Avanzado — no necesitas cambiar esto a menudo
          </span>
          <div className="flex-1 h-px" style={{ background: '#1f2024' }} />
        </div>

        {/* ══ §3 Uso del agente (Usage) ══ */}
        <section id="s-usage" className="max-w-[620px] mb-12" style={{ scrollMarginTop: 32 }}>
          <SectionHeader
            eyebrow="Avanzado · uso"
            title="Uso del agente"
            desc="El agente usa tu propia API key. Aqui puedes ver el costo estimado de este mes basado en los tokens consumidos."
          />

          <div className="rounded-[10px] p-4" style={{ background: '#151618', border: '1px solid #1f2024' }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: '#4caf82', boxShadow: '0 0 5px #4caf82' }}
                  />
                  <span className="text-[13px] text-[#e8e9eb]">
                    El agente funciona con normalidad
                  </span>
                </div>
                <div className="text-[9px] text-[#4a4d55]" style={{ fontFamily: MONO }}>
                  {requestCount} solicitudes este mes
                </div>
              </div>
              <div className="text-right">
                <div className="text-[20px] font-light text-[#e8e9eb]" style={{ fontFamily: MONO }}>
                  ${costUsd.toFixed(2)}
                </div>
                <div className="text-[10px] text-[#4a4d55]" style={{ fontFamily: MONO }}>
                  costo estimado este mes
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ══ §4 BYOK ══ */}
        <section id="s-byok" className="max-w-[620px] mb-12" style={{ scrollMarginTop: 32 }}>
          <SectionHeader
            eyebrow="Avanzado · API propia"
            title="Usar mi propia API key"
            desc="Si tienes tu propia API key de Anthropic, OpenAI o Google, puedes usarla directamente. Esto elimina el límite mensual y enruta las llamadas por tu cuenta."
          />

          <div className="rounded-[10px] p-4" style={{ background: '#151618', border: '1px solid #1f2024' }}>
            {/* Toggle row */}
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="text-[13px] text-[#e8e9eb] mb-1">API key propia (BYOK)</div>
                <div className="text-[11.5px] text-[#4a4d55] leading-[1.4]">
                  {settings.byokEnabled
                    ? 'Activo — el agente usará tu clave directamente.'
                    : 'Desactivado — el agente usa la infraestructura compartida de Attacca.'}
                </div>
              </div>
              <div
                onClick={() => handleToggleBYOK(!settings.byokEnabled)}
                className="flex-shrink-0 mt-0.5 cursor-pointer"
              >
                <div
                  className="w-[34px] h-[19px] rounded-[10px] relative transition-colors"
                  style={{ background: settings.byokEnabled ? '#5b7cf6' : '#232428' }}
                >
                  <div
                    className="absolute w-[15px] h-[15px] rounded-full bg-white top-[2px] transition-all"
                    style={{ [settings.byokEnabled ? 'right' : 'left']: 2 }}
                  />
                </div>
              </div>
            </div>

            {/* Expanded when enabled */}
            {settings.byokEnabled && (
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid #1f2024' }}>
                <div className="text-[11px] text-[#4a4d55] mb-2">¿Qué proveedor quieres usar?</div>

                {/* Provider chips */}
                <div className="flex gap-1.5 mb-3">
                  {(Object.entries(LLM_PROVIDERS) as [LLMProviderKey, (typeof LLM_PROVIDERS)[LLMProviderKey]][]).map(
                    ([key, provider]) => (
                      <button
                        key={key}
                        onClick={() => { setSelectedProvider(key); setFeedback(null) }}
                        className="px-3 py-1.5 rounded-full text-[12px] border transition-all cursor-pointer"
                        style={{
                          background: selectedProvider === key ? 'rgba(91,124,246,.12)' : 'transparent',
                          borderColor: selectedProvider === key ? '#5b7cf6' : '#2a2b2f',
                          color: selectedProvider === key ? '#5b7cf6' : '#7a7d85',
                          fontFamily: 'inherit',
                        }}
                      >
                        {provider.name}
                      </button>
                    )
                  )}
                </div>

                <BYOKGuide provider={selectedProvider} />

                {apiKeyHint && (
                  <p className="text-[11px] text-[#4a4d55] mb-2" style={{ fontFamily: MONO }}>
                    Clave actual: {apiKeyHint}
                  </p>
                )}

                {/* API key input row */}
                <div className="flex gap-2 mt-2">
                  <input
                    type="password"
                    placeholder={apiKeyHint ? 'Ingresa nueva clave para reemplazar' : 'Pega tu API key aquí'}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="flex-1 rounded-[6px] px-3 py-2 text-[11px] text-[#e8e9eb] outline-none transition-colors"
                    style={{
                      background: '#1c1d20',
                      border: '1px solid #2a2b2f',
                      fontFamily: MONO,
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = '#5b7cf6')}
                    onBlur={(e) => (e.currentTarget.style.borderColor = '#2a2b2f')}
                  />
                  <button
                    onClick={handleTestAndSave}
                    disabled={testing || saving || !apiKey.trim()}
                    className="px-3.5 py-2 rounded-[6px] text-[12px] border transition-all cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                    style={{
                      background: 'transparent',
                      border: '1px solid #2a2b2f',
                      color: '#7a7d85',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={(e) => {
                      if (!testing && !saving && apiKey.trim()) {
                        e.currentTarget.style.borderColor = '#5b7cf6'
                        e.currentTarget.style.color = '#5b7cf6'
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#2a2b2f'
                      e.currentTarget.style.color = '#7a7d85'
                    }}
                  >
                    {(testing || saving) && <Loader2 className="w-3 h-3 animate-spin" />}
                    {testing ? 'Probando...' : saving ? 'Guardando...' : 'Probar conexión'}
                  </button>
                </div>

                {feedback && (
                  <p
                    className="mt-2 text-[11px]"
                    style={{ color: feedback.type === 'success' ? '#4caf82' : '#e05c5c' }}
                  >
                    {feedback.message}
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ══ §5 Composio ══ */}
        <section id="s-composio" className="max-w-[620px] mb-12" style={{ scrollMarginTop: 32 }}>
          <SectionHeader
            eyebrow="Avanzado · integraciones"
            title="Composio API Key"
            desc={
              <>
                Agrega una clave de Composio para conectar herramientas como Gmail, Calendar y Slack.{' '}
                <button
                  onClick={() => window.api.app.openExternal('https://composio.dev')}
                  className="text-[#5b7cf6] hover:underline cursor-pointer"
                  style={{ background: 'none', border: 'none', padding: 0, font: 'inherit' }}
                >
                  Obtén una clave gratis en composio.dev
                </button>
              </>
            }
          />

          <div className="rounded-[10px] p-4" style={{ background: '#151618', border: '1px solid #1f2024' }}>
            {composioKeyHint && (
              <p className="text-[11px] text-[#4a4d55] mb-2" style={{ fontFamily: MONO }}>
                Clave actual: {composioKeyHint}
              </p>
            )}

            <div className="flex gap-2">
              <input
                type="password"
                placeholder={composioKeyHint ? 'Ingresa nueva clave para reemplazar' : 'Pega tu Composio API key aquí'}
                value={composioKey}
                onChange={(e) => setComposioKey(e.target.value)}
                className="flex-1 rounded-[6px] px-3 py-2 text-[11px] text-[#e8e9eb] outline-none transition-colors"
                style={{
                  background: '#1c1d20',
                  border: '1px solid #2a2b2f',
                  fontFamily: MONO,
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = '#5b7cf6')}
                onBlur={(e) => (e.currentTarget.style.borderColor = '#2a2b2f')}
              />
              <button
                onClick={handleSaveComposioKey}
                disabled={savingComposio || !composioKey.trim()}
                className="px-3.5 py-2 rounded-[6px] text-[12px] border transition-all cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                style={{
                  background: 'transparent',
                  border: '1px solid #2a2b2f',
                  color: '#7a7d85',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => {
                  if (!savingComposio && composioKey.trim()) {
                    e.currentTarget.style.borderColor = '#5b7cf6'
                    e.currentTarget.style.color = '#5b7cf6'
                  }
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#2a2b2f'
                  e.currentTarget.style.color = '#7a7d85'
                }}
              >
                {savingComposio && <Loader2 className="w-3 h-3 animate-spin" />}
                {savingComposio ? 'Guardando...' : 'Guardar'}
              </button>
            </div>

            {composioFeedback && (
              <p
                className="mt-2 text-[11px]"
                style={{ color: composioFeedback.type === 'success' ? '#4caf82' : '#e05c5c' }}
              >
                {composioFeedback.message}
              </p>
            )}

            {!composioKeyHint && (
              <p className="mt-3 text-[11px] text-[#4a4d55] leading-[1.4]">
                Sin una clave de Composio, el agente funciona para chat pero no puede conectar herramientas externas.
              </p>
            )}
          </div>
        </section>

        {/* ══ §6 Telemetry ══ */}
        <section id="s-telemetry" className="max-w-[620px] mb-12" style={{ scrollMarginTop: 32 }}>
          <SectionHeader
            eyebrow="Avanzado · privacidad"
            title="Datos de investigación"
            desc="Si lo activas, el agente comparte datos anónimos de uso para mejorar el producto. Nunca se comparten emails, archivos, mensajes ni ningún dato identificable."
          />

          <div
            className="rounded-[10px] overflow-hidden"
            style={{ background: '#151618', border: '1px solid #1f2024' }}
          >
            <div className="flex items-start gap-3 p-4">
              <div className="flex-1">
                <div className="text-[13px] text-[#e8e9eb] mb-1">Telemetría anónima de uso</div>
                <div className="text-[11.5px] text-[#4a4d55] leading-[1.4]">
                  Patrones de uso: qué acciones apruebas, con qué frecuencia usas cada sección. Sin contenido, sin IDs personales.
                </div>
              </div>
              <Switch
                checked={settings.telemetryOptIn}
                onCheckedChange={handleTelemetryToggle}
              />
            </div>
            <div
              className="flex items-center gap-2 px-4 py-2.5"
              style={{ borderTop: '1px solid #1f2024' }}
            >
              <TelemetryDataCategories />
              <button
                onClick={() => setShowTelemetryViewer(true)}
                className="px-3 py-1 rounded-[6px] text-[11.5px] border transition-colors cursor-pointer"
                style={{
                  background: 'transparent',
                  border: '1px solid #2a2b2f',
                  color: '#7a7d85',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#5b7cf6'
                  e.currentTarget.style.color = '#5b7cf6'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#2a2b2f'
                  e.currentTarget.style.color = '#7a7d85'
                }}
              >
                Ver datos
              </button>
              <button
                onClick={handleDeleteTelemetryData}
                className="px-3 py-1 rounded-[6px] text-[11.5px] border transition-colors cursor-pointer"
                style={{
                  background: 'transparent',
                  border: '1px solid #2a2b2f',
                  color: '#7a7d85',
                  fontFamily: 'inherit',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = '#e05c5c'
                  e.currentTarget.style.color = '#e05c5c'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#2a2b2f'
                  e.currentTarget.style.color = '#7a7d85'
                }}
              >
                Eliminar mis datos
              </button>
            </div>
          </div>
        </section>

        {/* ══ §7 System Health ══ */}
        <section id="s-health" className="max-w-[620px] mb-12" style={{ scrollMarginTop: 32 }}>
          <SectionHeader
            eyebrow="Avanzado · sistema"
            title="System Health"
            desc="Estado de las tareas de fondo: sintesis de memoria, decaimiento de importancia, backfill de embeddings."
          />
          <SystemHealth />
        </section>

        {showTelemetryViewer && (
          <TelemetryViewer onClose={() => setShowTelemetryViewer(false)} />
        )}

      </div>
    </div>
  )
}
