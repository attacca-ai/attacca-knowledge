import { useState } from 'react'
import { Loader2, Check, ChevronLeft, ChevronRight, Globe } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { LLM_PROVIDERS, type LLMProviderKey } from '@/lib/constants'

const MONO = "'IBM Plex Mono', monospace"
const TOTAL_STEPS = 4

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

  // Telemetry state
  const [telemetryOptIn, setTelemetryOptIn] = useState(false)

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

  async function handleFinish(): Promise<void> {
    await window.api.telemetry.setOptIn(telemetryOptIn)
    window.api.telemetry.emit('onboarding.completed', {
      llmProvider: llmProvider,
      telemetryOptIn
    })
    await window.api.onboarding.complete()
    onComplete()
  }

  function canProceed(): boolean {
    if (step === 1) return llmSaved
    return true
  }

  const STEP_LABELS = ['welcome', 'llm_provider', 'telemetry', 'ready']

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

          {/* Step 2: Telemetry */}
          {step === 2 && (
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

          {/* Step 3: Ready */}
          {step === 3 && (
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

          {step < TOTAL_STEPS - 1 && step !== 2 && (
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

          {step === 2 && <div />}
        </div>
      </div>
    </div>
  )
}
