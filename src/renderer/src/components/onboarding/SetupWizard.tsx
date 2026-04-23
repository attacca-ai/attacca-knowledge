import { useState } from 'react'
import { Loader2, Check, ChevronLeft, ChevronRight, Globe, FolderOpen, Plus } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { LLM_PROVIDERS, type LLMProviderKey } from '@/lib/constants'
import type { VaultMode } from '@/stores/onboarding-store'

const MONO = "'IBM Plex Mono', monospace"
const TOTAL_STEPS = 6

/**
 * Default areas offered during onboarding (spec §6.2 + resolved Q3).
 * Pre-checked. User must keep ≥1 to advance; custom adds allowed.
 */
interface DefaultArea {
  name: string
  emoji: string
  description: string
}
const DEFAULT_AREAS: DefaultArea[] = [
  { name: 'Health', emoji: '🏃', description: 'Physical activity, sleep, nutrition, medical' },
  { name: 'Career', emoji: '💼', description: 'Work, side projects, professional growth' },
  { name: 'Family & Relationships', emoji: '❤️', description: 'Partner, family, close friends' },
  { name: 'Finance', emoji: '💰', description: 'Income, spending, saving, investments' },
  { name: 'Learning', emoji: '📚', description: 'Books, courses, research, skill building' },
  { name: 'Personal Projects', emoji: '🛠️', description: 'Hobbies, side interests, crafts' }
]

interface SetupWizardProps {
  onComplete: () => void
}

export function SetupWizard({ onComplete }: SetupWizardProps): React.JSX.Element {
  const { t, locale, setLocale } = useTranslation()
  const [step, setStep] = useState(0)

  // LLM state
  const [llmProvider, setLlmProvider] = useState<LLMProviderKey>('anthropic')
  const [llmKey, setLlmKey] = useState('')
  const [llmTesting, setLlmTesting] = useState(false)
  const [llmSaving, setLlmSaving] = useState(false)
  const [llmSaved, setLlmSaved] = useState(false)
  const [llmError, setLlmError] = useState<string | null>(null)

  // Vault state
  const [vaultKind, setVaultKind] = useState<VaultMode['kind']>('managed')
  const [externalVaultPath, setExternalVaultPath] = useState<string>('')
  const [vaultError, setVaultError] = useState<string | null>(null)

  // Telemetry state
  const [telemetryOptIn, setTelemetryOptIn] = useState(false)

  // Areas state — all 6 defaults pre-checked (resolved Q3).
  const [areaSelections, setAreaSelections] = useState<DefaultArea[]>(() => [...DEFAULT_AREAS])
  const [customAreaName, setCustomAreaName] = useState('')
  const [customAreaEmoji, setCustomAreaEmoji] = useState('')

  function toggleDefaultArea(name: string): void {
    setAreaSelections((prev) => {
      const has = prev.some((a) => a.name === name)
      if (has) return prev.filter((a) => a.name !== name)
      const def = DEFAULT_AREAS.find((a) => a.name === name)
      return def ? [...prev, def] : prev
    })
  }

  function addCustomArea(): void {
    const name = customAreaName.trim()
    if (!name) return
    if (areaSelections.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      setCustomAreaName('')
      setCustomAreaEmoji('')
      return
    }
    setAreaSelections((prev) => [
      ...prev,
      { name, emoji: customAreaEmoji.trim() || '📌', description: '' }
    ])
    setCustomAreaName('')
    setCustomAreaEmoji('')
  }

  async function handleTestLLM(): Promise<void> {
    if (!llmKey.trim()) return
    setLlmTesting(true)
    setLlmError(null)
    try {
      const result = await window.api.llm.testConnection(llmProvider, llmKey)
      if (!result.success) {
        setLlmError(result.error || 'Connection test failed')
        setLlmTesting(false)
        return
      }
      setLlmTesting(false)
      setLlmSaving(true)
      const provider = LLM_PROVIDERS[llmProvider]
      await window.api.llm.saveConfig(llmProvider, provider.defaultModel, llmKey)
      setLlmSaved(true)
      setLlmKey('')
    } catch (err) {
      setLlmError(err instanceof Error ? err.message : 'Error')
    } finally {
      setLlmTesting(false)
      setLlmSaving(false)
    }
  }

  async function handlePickExternalVault(): Promise<void> {
    setVaultError(null)
    const picked = await window.api.fs.selectFolder()
    if (picked) setExternalVaultPath(picked)
  }

  async function handleFinish(): Promise<void> {
    // Persist vault mode via the new vault manager — creates missing
    // managed folders and starts the chokidar watcher server-side.
    const vaultMode: VaultMode =
      vaultKind === 'external'
        ? { kind: 'external', path: externalVaultPath }
        : { kind: 'managed', path: 'managed' }
    try {
      await window.api.vault.setMode(vaultMode, { createMissing: true })
    } catch {
      // Fall back to plain setting write so old builds still boot.
      await window.api.settings.set('vaultMode', vaultMode)
    }

    // Seed selected areas (spec §6.2). Errors non-fatal; user can retry
    // in AreasView.
    for (const sel of areaSelections) {
      try {
        await window.api.area.create({
          name: sel.name,
          emoji: sel.emoji,
          description: sel.description
        })
      } catch {
        /* continue seeding others */
      }
    }

    await window.api.telemetry.setOptIn(telemetryOptIn)
    window.api.telemetry.emit('onboarding.completed', {
      llmProvider: llmProvider,
      vaultKind,
      telemetryOptIn,
      areaCount: areaSelections.length
    })
    await window.api.onboarding.complete()
    onComplete()
  }

  function canProceed(): boolean {
    if (step === 1) return llmSaved
    if (step === 2) return vaultKind === 'managed' || externalVaultPath.trim().length > 0
    if (step === 3) return areaSelections.length > 0
    return true
  }

  const STEP_LABELS = ['welcome', 'llm_provider', 'vault', 'areas', 'telemetry', 'ready']

  function goNext(): void {
    if (step < TOTAL_STEPS - 1 && canProceed()) {
      window.api.telemetry.emit('onboarding.step_completed', {
        step,
        stepName: STEP_LABELS[step] || `step_${step}`
      })
      setStep(step + 1)
    }
  }

  function goBack(): void {
    if (step > 0) setStep(step - 1)
  }

  const providerLinks: Record<LLMProviderKey, string> = {
    anthropic: 'https://console.anthropic.com/settings/keys',
    openai: 'https://platform.openai.com/api-keys',
    google: 'https://aistudio.google.com/app/apikey'
  }

  return (
    <div
      className="flex h-screen items-center justify-center bg-background"
      style={{ color: '#e8e9eb' }}
    >
      {/* Draggable titlebar region — matches the 36px overlay from main-window.ts */}
      <div
        className="fixed inset-x-0 top-0 h-9"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      />
      <div className="w-[520px] flex flex-col">
        {/* Language toggle */}
        <div className="flex justify-end mb-4">
          <button
            onClick={() => setLocale(locale === 'en' ? 'es' : 'en')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border cursor-pointer transition-colors"
            style={{
              background: 'transparent',
              border: '1px solid #2a2b2f',
              color: '#7a7d85',
              fontFamily: 'inherit'
            }}
          >
            <Globe className="w-3 h-3" />
            {locale === 'en' ? 'ES' : 'EN'}
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1.5 mb-6 justify-center">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div
              key={i}
              className="h-[3px] rounded-full transition-all"
              style={{
                width: i === step ? 32 : 16,
                background: i <= step ? 'var(--att-blue)' : 'var(--att-surface-raised)'
              }}
            />
          ))}
        </div>

        {/* Content */}
        <div
          className="rounded-[12px] p-6 min-h-[360px] flex flex-col"
          style={{ background: 'var(--att-surface)', border: '1px solid var(--att-divider)' }}
        >
          {/* Step 0: Welcome */}
          {step === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="text-[28px] font-light tracking-[-0.02em] mb-1">
                {t('wizard.welcome.title')}
              </div>
              <div className="text-[13px] text-att-blue mb-4">{t('wizard.welcome.subtitle')}</div>
              <div className="text-[12.5px] text-muted-foreground leading-[1.6] max-w-[400px]">
                {t('wizard.welcome.description')}
              </div>
            </div>
          )}

          {/* Step 1: LLM Key */}
          {step === 1 && (
            <div className="flex-1 flex flex-col">
              <div className="text-[17px] font-light mb-1">{t('wizard.llm.title')}</div>
              <div className="text-[12.5px] text-muted-foreground leading-[1.5] mb-5">
                {t('wizard.llm.description')}
              </div>

              <div className="text-[11px] text-muted-foreground/60 mb-2">
                {t('wizard.llm.provider_label')}
              </div>
              <div className="flex gap-1.5 mb-4">
                {(
                  Object.entries(LLM_PROVIDERS) as [
                    LLMProviderKey,
                    (typeof LLM_PROVIDERS)[LLMProviderKey]
                  ][]
                ).map(([key, provider]) => (
                  <button
                    key={key}
                    onClick={() => {
                      setLlmProvider(key)
                      setLlmError(null)
                      setLlmSaved(false)
                    }}
                    className="px-3 py-1.5 rounded-full text-[12px] border transition-all cursor-pointer"
                    style={{
                      background: llmProvider === key ? 'color-mix(in srgb, var(--att-blue) 12%, transparent)' : 'transparent',
                      borderColor: llmProvider === key ? 'var(--att-blue)' : '#2a2b2f',
                      color: llmProvider === key ? 'var(--att-blue)' : '#7a7d85',
                      fontFamily: 'inherit'
                    }}
                  >
                    {provider.name}
                  </button>
                ))}
              </div>

              <button
                onClick={() => window.api.app.openExternal(providerLinks[llmProvider])}
                className="text-[11px] text-att-blue hover:underline cursor-pointer mb-3 text-left"
                style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit' }}
              >
                {t(`wizard.llm.get_key_${llmProvider}`)}
              </button>

              {llmSaved ? (
                <div className="flex items-center gap-2 py-3">
                  <Check className="w-4 h-4 text-att-green" />
                  <span className="text-[12px] text-att-green">{t('wizard.llm.success')}</span>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="password"
                    placeholder={t('wizard.llm.key_placeholder')}
                    value={llmKey}
                    onChange={(e) => setLlmKey(e.target.value)}
                    className="flex-1 rounded-[6px] px-3 py-2 text-[11px] text-[#e8e9eb] outline-none"
                    style={{ background: 'var(--att-surface-hover)', border: '1px solid #2a2b2f', fontFamily: MONO }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--att-blue)')}
                    onBlur={(e) => (e.currentTarget.style.borderColor = '#2a2b2f')}
                  />
                  <button
                    onClick={handleTestLLM}
                    disabled={llmTesting || llmSaving || !llmKey.trim()}
                    className="px-3.5 py-2 rounded-[6px] text-[12px] border cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                    style={{
                      background: 'transparent',
                      border: '1px solid #2a2b2f',
                      color: '#7a7d85',
                      fontFamily: 'inherit'
                    }}
                  >
                    {(llmTesting || llmSaving) && <Loader2 className="w-3 h-3 animate-spin" />}
                    {llmTesting
                      ? t('wizard.llm.testing')
                      : llmSaving
                        ? t('wizard.llm.saving')
                        : t('wizard.llm.test_button')}
                  </button>
                </div>
              )}

              {llmError && <p className="mt-2 text-[11px] text-att-red">{llmError}</p>}
              {!llmSaved && !llmError && (
                <p className="mt-3 text-[10px] text-muted-foreground/60">{t('wizard.llm.required')}</p>
              )}
            </div>
          )}

          {/* Step 2: Vault mode */}
          {step === 2 && (
            <div className="flex-1 flex flex-col">
              <div className="text-[17px] font-light mb-1">{t('wizard.vault.title')}</div>
              <div className="text-[12.5px] text-muted-foreground leading-[1.5] mb-5">
                {t('wizard.vault.description')}
              </div>

              <div className="flex flex-col gap-2 mb-4">
                <button
                  onClick={() => {
                    setVaultKind('managed')
                    setVaultError(null)
                  }}
                  className="text-left rounded-[8px] p-3.5 border cursor-pointer transition-colors"
                  style={{
                    background:
                      vaultKind === 'managed'
                        ? 'color-mix(in srgb, var(--att-blue) 10%, transparent)'
                        : 'var(--att-surface-hover)',
                    borderColor: vaultKind === 'managed' ? 'var(--att-blue)' : '#2a2b2f',
                    fontFamily: 'inherit'
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-3 h-3 rounded-full border-2 flex-shrink-0"
                      style={{
                        borderColor:
                          vaultKind === 'managed' ? 'var(--att-blue)' : '#4a4d55',
                        background: vaultKind === 'managed' ? 'var(--att-blue)' : 'transparent'
                      }}
                    />
                    <span
                      className="text-[13px]"
                      style={{
                        color: vaultKind === 'managed' ? 'var(--att-blue)' : '#e8e9eb'
                      }}
                    >
                      {t('wizard.vault.managed_title')}
                    </span>
                  </div>
                  <div className="text-[11.5px] text-muted-foreground leading-[1.5] pl-5">
                    {t('wizard.vault.managed_desc')}
                  </div>
                </button>

                <button
                  onClick={() => {
                    setVaultKind('external')
                    setVaultError(null)
                  }}
                  className="text-left rounded-[8px] p-3.5 border cursor-pointer transition-colors"
                  style={{
                    background:
                      vaultKind === 'external'
                        ? 'color-mix(in srgb, var(--att-blue) 10%, transparent)'
                        : 'var(--att-surface-hover)',
                    borderColor: vaultKind === 'external' ? 'var(--att-blue)' : '#2a2b2f',
                    fontFamily: 'inherit'
                  }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div
                      className="w-3 h-3 rounded-full border-2 flex-shrink-0"
                      style={{
                        borderColor:
                          vaultKind === 'external' ? 'var(--att-blue)' : '#4a4d55',
                        background:
                          vaultKind === 'external' ? 'var(--att-blue)' : 'transparent'
                      }}
                    />
                    <span
                      className="text-[13px]"
                      style={{
                        color: vaultKind === 'external' ? 'var(--att-blue)' : '#e8e9eb'
                      }}
                    >
                      {t('wizard.vault.external_title')}
                    </span>
                  </div>
                  <div className="text-[11.5px] text-muted-foreground leading-[1.5] pl-5">
                    {t('wizard.vault.external_desc')}
                  </div>
                </button>
              </div>

              {vaultKind === 'external' && (
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    placeholder={t('wizard.vault.path_placeholder')}
                    value={externalVaultPath}
                    className="flex-1 rounded-[6px] px-3 py-2 text-[11px] text-[#e8e9eb] outline-none"
                    style={{
                      background: 'var(--att-surface-hover)',
                      border: '1px solid #2a2b2f',
                      fontFamily: MONO
                    }}
                  />
                  <button
                    onClick={handlePickExternalVault}
                    className="px-3.5 py-2 rounded-[6px] text-[12px] border cursor-pointer whitespace-nowrap flex items-center gap-1.5"
                    style={{
                      background: 'transparent',
                      border: '1px solid #2a2b2f',
                      color: '#7a7d85',
                      fontFamily: 'inherit'
                    }}
                  >
                    <FolderOpen className="w-3 h-3" />
                    {t('wizard.vault.browse')}
                  </button>
                </div>
              )}

              {vaultError && <p className="mt-2 text-[11px] text-att-red">{vaultError}</p>}
              {vaultKind === 'external' && !externalVaultPath && !vaultError && (
                <p className="mt-3 text-[10px] text-muted-foreground/60">
                  {t('wizard.vault.path_required')}
                </p>
              )}
            </div>
          )}

          {/* Step 3: Areas (Life OS §6.2, resolved Q3) */}
          {step === 3 && (
            <div className="flex-1 flex flex-col">
              <div className="text-[17px] font-light mb-1">{t('wizard.areas.title')}</div>
              <div className="text-[12.5px] text-muted-foreground leading-[1.5] mb-4">
                {t('wizard.areas.description')}
              </div>

              <div className="flex flex-col gap-1.5 mb-3 max-h-[240px] overflow-auto pr-1">
                {DEFAULT_AREAS.map((def) => {
                  const checked = areaSelections.some((a) => a.name === def.name)
                  return (
                    <button
                      key={def.name}
                      onClick={() => toggleDefaultArea(def.name)}
                      className="flex items-center gap-2 rounded-[6px] border px-2.5 py-2 text-left cursor-pointer transition-colors"
                      style={{
                        background: checked
                          ? 'color-mix(in srgb, var(--att-blue) 10%, transparent)'
                          : 'var(--att-surface-hover)',
                        borderColor: checked ? 'var(--att-blue)' : '#2a2b2f',
                        fontFamily: 'inherit'
                      }}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-sm border flex-shrink-0 flex items-center justify-center"
                        style={{
                          borderColor: checked ? 'var(--att-blue)' : '#4a4d55',
                          background: checked ? 'var(--att-blue)' : 'transparent'
                        }}
                      >
                        {checked && <Check className="w-2.5 h-2.5 text-white" />}
                      </span>
                      <span className="text-[14px]">{def.emoji}</span>
                      <div className="flex-1">
                        <div className="text-[12.5px]" style={{ color: checked ? 'var(--att-blue)' : '#e8e9eb' }}>
                          {def.name}
                        </div>
                        <div className="text-[10.5px] text-muted-foreground/70">{def.description}</div>
                      </div>
                    </button>
                  )
                })}

                {areaSelections
                  .filter((a) => !DEFAULT_AREAS.some((d) => d.name === a.name))
                  .map((custom) => (
                    <div
                      key={custom.name}
                      className="flex items-center gap-2 rounded-[6px] border px-2.5 py-2"
                      style={{
                        background: 'color-mix(in srgb, var(--att-blue) 10%, transparent)',
                        borderColor: 'var(--att-blue)'
                      }}
                    >
                      <span className="text-[14px]">{custom.emoji}</span>
                      <div className="flex-1 text-[12.5px]" style={{ color: 'var(--att-blue)' }}>
                        {custom.name}
                      </div>
                      <button
                        onClick={() =>
                          setAreaSelections((prev) => prev.filter((a) => a.name !== custom.name))
                        }
                        className="text-[10px] text-muted-foreground hover:text-att-red cursor-pointer"
                        style={{ background: 'none', border: 'none' }}
                      >
                        remove
                      </button>
                    </div>
                  ))}
              </div>

              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  value={customAreaEmoji}
                  onChange={(e) => setCustomAreaEmoji(e.target.value.slice(0, 4))}
                  placeholder="🔖"
                  className="w-12 rounded-[6px] px-2 py-1.5 text-[12px] text-center outline-none"
                  style={{
                    background: 'var(--att-surface-hover)',
                    border: '1px solid #2a2b2f'
                  }}
                />
                <input
                  type="text"
                  value={customAreaName}
                  onChange={(e) => setCustomAreaName(e.target.value)}
                  placeholder={t('wizard.areas.add_placeholder')}
                  className="flex-1 rounded-[6px] px-2.5 py-1.5 text-[11px] outline-none"
                  style={{
                    background: 'var(--att-surface-hover)',
                    border: '1px solid #2a2b2f',
                    color: '#e8e9eb'
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addCustomArea()
                  }}
                />
                <button
                  onClick={addCustomArea}
                  disabled={!customAreaName.trim()}
                  className="rounded-[6px] px-3 py-1.5 text-[11px] border cursor-pointer whitespace-nowrap flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: 'transparent',
                    border: '1px solid #2a2b2f',
                    color: '#7a7d85',
                    fontFamily: 'inherit'
                  }}
                >
                  <Plus className="w-3 h-3" />
                  {t('wizard.areas.add_button')}
                </button>
              </div>

              {areaSelections.length === 0 && (
                <p className="mt-3 text-[10px] text-att-red">{t('wizard.areas.required')}</p>
              )}
            </div>
          )}

          {/* Step 4: Telemetry */}
          {step === 4 && (
            <div className="flex-1 flex flex-col">
              <div className="text-[17px] font-light mb-1">{t('wizard.telemetry.title')}</div>
              <div className="text-[12.5px] text-muted-foreground leading-[1.5] mb-5">
                {t('wizard.telemetry.description')}
              </div>

              <div
                className="rounded-[8px] p-3.5 mb-3"
                style={{ background: 'var(--att-surface-hover)', border: '1px solid var(--att-surface-raised)' }}
              >
                <div className="text-[11px] text-att-green mb-1.5 font-medium">
                  {t('wizard.telemetry.what_collected')}
                </div>
                <div className="text-[11px] text-muted-foreground leading-[1.5]">
                  {t('wizard.telemetry.what_collected_items')}
                </div>
              </div>

              <div
                className="rounded-[8px] p-3.5 mb-5"
                style={{ background: 'var(--att-surface-hover)', border: '1px solid var(--att-surface-raised)' }}
              >
                <div className="text-[11px] text-att-red mb-1.5 font-medium">
                  {t('wizard.telemetry.what_not_collected')}
                </div>
                <div className="text-[11px] text-muted-foreground leading-[1.5]">
                  {t('wizard.telemetry.what_not_collected_items')}
                </div>
              </div>

              <div className="flex gap-2 mt-auto">
                <button
                  onClick={() => {
                    setTelemetryOptIn(true)
                    goNext()
                  }}
                  className="flex-1 py-2.5 rounded-[8px] text-[12px] border cursor-pointer transition-colors"
                  style={{
                    background: telemetryOptIn ? 'color-mix(in srgb, var(--att-blue) 12%, transparent)' : 'transparent',
                    borderColor: telemetryOptIn ? 'var(--att-blue)' : '#2a2b2f',
                    color: telemetryOptIn ? 'var(--att-blue)' : '#7a7d85',
                    fontFamily: 'inherit'
                  }}
                >
                  {t('wizard.telemetry.enable')}
                </button>
                <button
                  onClick={() => {
                    setTelemetryOptIn(false)
                    goNext()
                  }}
                  className="flex-1 py-2.5 rounded-[8px] text-[12px] border cursor-pointer transition-colors"
                  style={{
                    background: !telemetryOptIn ? 'color-mix(in srgb, var(--att-blue) 12%, transparent)' : 'transparent',
                    borderColor: !telemetryOptIn ? 'var(--att-blue)' : '#2a2b2f',
                    color: !telemetryOptIn ? 'var(--att-blue)' : '#7a7d85',
                    fontFamily: 'inherit'
                  }}
                >
                  {t('wizard.telemetry.disable')}
                </button>
              </div>
            </div>
          )}

          {/* Step 5: Ready */}
          {step === 5 && (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="text-[24px] font-light mb-5">{t('wizard.ready.title')}</div>

              <div className="flex flex-col gap-2 mb-6 text-left">
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-att-green" />
                  <span className="text-[12px] text-muted-foreground">
                    {t('wizard.ready.llm_configured')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-att-green" />
                  <span className="text-[12px] text-muted-foreground">
                    {vaultKind === 'external'
                      ? t('wizard.ready.vault_external')
                      : t('wizard.ready.vault_managed')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Check
                    className="w-3.5 h-3.5"
                    style={{ color: telemetryOptIn ? 'var(--att-green)' : '#4a4d55' }}
                  />
                  <span className="text-[12px] text-muted-foreground">
                    {telemetryOptIn
                      ? t('wizard.ready.telemetry_on')
                      : t('wizard.ready.telemetry_off')}
                  </span>
                </div>
              </div>

              <button
                onClick={handleFinish}
                className="px-6 py-2.5 rounded-[8px] text-[13px] cursor-pointer transition-colors"
                style={{
                  background: 'var(--att-blue)',
                  color: '#fff',
                  border: 'none',
                  fontFamily: 'inherit'
                }}
              >
                {t('wizard.ready.start')}
              </button>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={goBack}
            disabled={step === 0}
            className="flex items-center gap-1 text-[12px] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ background: 'none', border: 'none', color: '#7a7d85', fontFamily: 'inherit' }}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            {t('wizard.nav.back')}
          </button>

          <span className="text-[10px] text-muted-foreground/60" style={{ fontFamily: MONO }}>
            {t('wizard.nav.step', { current: step + 1, total: TOTAL_STEPS })}
          </span>

          {step < TOTAL_STEPS - 1 && step !== 4 && (
            <button
              onClick={goNext}
              disabled={!canProceed()}
              className="flex items-center gap-1 text-[12px] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--att-blue)',
                fontFamily: 'inherit'
              }}
            >
              {step === 0 ? t('wizard.welcome.start') : t('wizard.nav.next')}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}

          {step === 4 && <div />}
        </div>
      </div>
    </div>
  )
}
