import { useState } from 'react'
import { Loader2, Check, ChevronLeft, ChevronRight, Globe } from 'lucide-react'
import { useTranslation } from '@/i18n'
import { LLM_PROVIDERS, type LLMProviderKey } from '@/lib/constants'

const MONO = "'IBM Plex Mono', monospace"
const TOTAL_STEPS = 5

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

  // Composio state
  const [composioKey, setComposioKey] = useState('')
  const [composioSaving, setComposioSaving] = useState(false)
  const [composioSaved, setComposioSaved] = useState(false)
  const [composioError, setComposioError] = useState<string | null>(null)

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

  async function handleSaveComposio(): Promise<void> {
    if (!composioKey.trim()) return
    setComposioSaving(true)
    setComposioError(null)
    try {
      const result = await window.api.composio.setApiKey(composioKey)
      if (result.success) {
        setComposioSaved(true)
        setComposioKey('')
      } else {
        setComposioError(result.error || 'Failed to save')
      }
    } catch (err) {
      setComposioError(err instanceof Error ? err.message : 'Error')
    } finally {
      setComposioSaving(false)
    }
  }

  async function handleFinish(): Promise<void> {
    await window.api.telemetry.setOptIn(telemetryOptIn)
    await window.api.onboarding.complete()
    onComplete()
  }

  function canProceed(): boolean {
    if (step === 1) return llmSaved
    return true
  }

  function goNext(): void {
    if (step < TOTAL_STEPS - 1 && canProceed()) setStep(step + 1)
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
    <div className="flex h-screen items-center justify-center bg-background" style={{ color: '#e8e9eb' }}>
      <div className="w-[520px] flex flex-col">
        {/* Language toggle */}
        <div className="flex justify-end mb-4">
          <button
            onClick={() => setLocale(locale === 'en' ? 'es' : 'en')}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border cursor-pointer transition-colors"
            style={{ background: 'transparent', border: '1px solid #2a2b2f', color: '#7a7d85', fontFamily: 'inherit' }}
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
                background: i <= step ? '#5b7cf6' : '#232428'
              }}
            />
          ))}
        </div>

        {/* Content */}
        <div
          className="rounded-[12px] p-6 min-h-[360px] flex flex-col"
          style={{ background: '#151618', border: '1px solid #1f2024' }}
        >
          {/* Step 0: Welcome */}
          {step === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="text-[28px] font-light tracking-[-0.02em] mb-1">{t('wizard.welcome.title')}</div>
              <div className="text-[13px] text-[#5b7cf6] mb-4">{t('wizard.welcome.subtitle')}</div>
              <div className="text-[12.5px] text-[#7a7d85] leading-[1.6] max-w-[400px]">
                {t('wizard.welcome.description')}
              </div>
            </div>
          )}

          {/* Step 1: LLM Key */}
          {step === 1 && (
            <div className="flex-1 flex flex-col">
              <div className="text-[17px] font-light mb-1">{t('wizard.llm.title')}</div>
              <div className="text-[12.5px] text-[#7a7d85] leading-[1.5] mb-5">{t('wizard.llm.description')}</div>

              <div className="text-[11px] text-[#4a4d55] mb-2">{t('wizard.llm.provider_label')}</div>
              <div className="flex gap-1.5 mb-4">
                {(Object.entries(LLM_PROVIDERS) as [LLMProviderKey, (typeof LLM_PROVIDERS)[LLMProviderKey]][]).map(
                  ([key, provider]) => (
                    <button
                      key={key}
                      onClick={() => { setLlmProvider(key); setLlmError(null); setLlmSaved(false) }}
                      className="px-3 py-1.5 rounded-full text-[12px] border transition-all cursor-pointer"
                      style={{
                        background: llmProvider === key ? 'rgba(91,124,246,.12)' : 'transparent',
                        borderColor: llmProvider === key ? '#5b7cf6' : '#2a2b2f',
                        color: llmProvider === key ? '#5b7cf6' : '#7a7d85',
                        fontFamily: 'inherit'
                      }}
                    >
                      {provider.name}
                    </button>
                  )
                )}
              </div>

              <button
                onClick={() => window.api.app.openExternal(providerLinks[llmProvider])}
                className="text-[11px] text-[#5b7cf6] hover:underline cursor-pointer mb-3 text-left"
                style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit' }}
              >
                {t(`wizard.llm.get_key_${llmProvider}`)}
              </button>

              {llmSaved ? (
                <div className="flex items-center gap-2 py-3">
                  <Check className="w-4 h-4 text-[#4caf82]" />
                  <span className="text-[12px] text-[#4caf82]">{t('wizard.llm.success')}</span>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="password"
                    placeholder={t('wizard.llm.key_placeholder')}
                    value={llmKey}
                    onChange={(e) => setLlmKey(e.target.value)}
                    className="flex-1 rounded-[6px] px-3 py-2 text-[11px] text-[#e8e9eb] outline-none"
                    style={{ background: '#1c1d20', border: '1px solid #2a2b2f', fontFamily: MONO }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = '#5b7cf6')}
                    onBlur={(e) => (e.currentTarget.style.borderColor = '#2a2b2f')}
                  />
                  <button
                    onClick={handleTestLLM}
                    disabled={llmTesting || llmSaving || !llmKey.trim()}
                    className="px-3.5 py-2 rounded-[6px] text-[12px] border cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                    style={{ background: 'transparent', border: '1px solid #2a2b2f', color: '#7a7d85', fontFamily: 'inherit' }}
                  >
                    {(llmTesting || llmSaving) && <Loader2 className="w-3 h-3 animate-spin" />}
                    {llmTesting ? t('wizard.llm.testing') : llmSaving ? t('wizard.llm.saving') : t('wizard.llm.test_button')}
                  </button>
                </div>
              )}

              {llmError && <p className="mt-2 text-[11px] text-[#e05c5c]">{llmError}</p>}
              {!llmSaved && !llmError && (
                <p className="mt-3 text-[10px] text-[#4a4d55]">{t('wizard.llm.required')}</p>
              )}
            </div>
          )}

          {/* Step 2: Composio */}
          {step === 2 && (
            <div className="flex-1 flex flex-col">
              <div className="text-[17px] font-light mb-1">{t('wizard.composio.title')}</div>
              <div className="text-[12.5px] text-[#7a7d85] leading-[1.5] mb-5">{t('wizard.composio.description')}</div>

              <button
                onClick={() => window.api.app.openExternal('https://composio.dev')}
                className="text-[11px] text-[#5b7cf6] hover:underline cursor-pointer mb-3 text-left"
                style={{ background: 'none', border: 'none', padding: 0, fontFamily: 'inherit' }}
              >
                {t('wizard.composio.get_key')}
              </button>

              {composioSaved ? (
                <div className="flex items-center gap-2 py-3">
                  <Check className="w-4 h-4 text-[#4caf82]" />
                  <span className="text-[12px] text-[#4caf82]">{t('wizard.composio.success')}</span>
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder={t('wizard.composio.key_placeholder')}
                      value={composioKey}
                      onChange={(e) => setComposioKey(e.target.value)}
                      className="flex-1 rounded-[6px] px-3 py-2 text-[11px] text-[#e8e9eb] outline-none"
                      style={{ background: '#1c1d20', border: '1px solid #2a2b2f', fontFamily: MONO }}
                      onFocus={(e) => (e.currentTarget.style.borderColor = '#5b7cf6')}
                      onBlur={(e) => (e.currentTarget.style.borderColor = '#2a2b2f')}
                    />
                    <button
                      onClick={handleSaveComposio}
                      disabled={composioSaving || !composioKey.trim()}
                      className="px-3.5 py-2 rounded-[6px] text-[12px] border cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                      style={{ background: 'transparent', border: '1px solid #2a2b2f', color: '#7a7d85', fontFamily: 'inherit' }}
                    >
                      {composioSaving && <Loader2 className="w-3 h-3 animate-spin" />}
                      {composioSaving ? t('wizard.composio.saving') : t('wizard.composio.save_button')}
                    </button>
                  </div>
                  {composioError && <p className="mt-2 text-[11px] text-[#e05c5c]">{composioError}</p>}
                </>
              )}
            </div>
          )}

          {/* Step 3: Telemetry */}
          {step === 3 && (
            <div className="flex-1 flex flex-col">
              <div className="text-[17px] font-light mb-1">{t('wizard.telemetry.title')}</div>
              <div className="text-[12.5px] text-[#7a7d85] leading-[1.5] mb-5">{t('wizard.telemetry.description')}</div>

              <div className="rounded-[8px] p-3.5 mb-3" style={{ background: '#1c1d20', border: '1px solid #232428' }}>
                <div className="text-[11px] text-[#4caf82] mb-1.5 font-medium">{t('wizard.telemetry.what_collected')}</div>
                <div className="text-[11px] text-[#7a7d85] leading-[1.5]">{t('wizard.telemetry.what_collected_items')}</div>
              </div>

              <div className="rounded-[8px] p-3.5 mb-5" style={{ background: '#1c1d20', border: '1px solid #232428' }}>
                <div className="text-[11px] text-[#e05c5c] mb-1.5 font-medium">{t('wizard.telemetry.what_not_collected')}</div>
                <div className="text-[11px] text-[#7a7d85] leading-[1.5]">{t('wizard.telemetry.what_not_collected_items')}</div>
              </div>

              <div className="flex gap-2 mt-auto">
                <button
                  onClick={() => { setTelemetryOptIn(true); goNext() }}
                  className="flex-1 py-2.5 rounded-[8px] text-[12px] border cursor-pointer transition-colors"
                  style={{
                    background: telemetryOptIn ? 'rgba(91,124,246,.12)' : 'transparent',
                    borderColor: telemetryOptIn ? '#5b7cf6' : '#2a2b2f',
                    color: telemetryOptIn ? '#5b7cf6' : '#7a7d85',
                    fontFamily: 'inherit'
                  }}
                >
                  {t('wizard.telemetry.enable')}
                </button>
                <button
                  onClick={() => { setTelemetryOptIn(false); goNext() }}
                  className="flex-1 py-2.5 rounded-[8px] text-[12px] border cursor-pointer transition-colors"
                  style={{
                    background: !telemetryOptIn ? 'rgba(91,124,246,.12)' : 'transparent',
                    borderColor: !telemetryOptIn ? '#5b7cf6' : '#2a2b2f',
                    color: !telemetryOptIn ? '#5b7cf6' : '#7a7d85',
                    fontFamily: 'inherit'
                  }}
                >
                  {t('wizard.telemetry.disable')}
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Ready */}
          {step === 4 && (
            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <div className="text-[24px] font-light mb-5">{t('wizard.ready.title')}</div>

              <div className="flex flex-col gap-2 mb-6 text-left">
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5 text-[#4caf82]" />
                  <span className="text-[12px] text-[#7a7d85]">{t('wizard.ready.llm_configured')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5" style={{ color: composioSaved ? '#4caf82' : '#4a4d55' }} />
                  <span className="text-[12px] text-[#7a7d85]">
                    {composioSaved ? t('wizard.ready.composio_configured') : t('wizard.ready.composio_skipped')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-3.5 h-3.5" style={{ color: telemetryOptIn ? '#4caf82' : '#4a4d55' }} />
                  <span className="text-[12px] text-[#7a7d85]">
                    {telemetryOptIn ? t('wizard.ready.telemetry_on') : t('wizard.ready.telemetry_off')}
                  </span>
                </div>
              </div>

              <button
                onClick={handleFinish}
                className="px-6 py-2.5 rounded-[8px] text-[13px] cursor-pointer transition-colors"
                style={{ background: '#5b7cf6', color: '#fff', border: 'none', fontFamily: 'inherit' }}
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

          <span className="text-[10px] text-[#4a4d55]" style={{ fontFamily: MONO }}>
            {t('wizard.nav.step', { current: step + 1, total: TOTAL_STEPS })}
          </span>

          {step < TOTAL_STEPS - 1 && step !== 3 && (
            <button
              onClick={goNext}
              disabled={!canProceed()}
              className="flex items-center gap-1 text-[12px] cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: 'none', border: 'none', color: '#5b7cf6', fontFamily: 'inherit' }}
            >
              {step === 0 ? t('wizard.welcome.start') : step === 2 && !composioSaved ? t('wizard.composio.skip') : t('wizard.nav.next')}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}

          {step === 3 && <div />}
        </div>
      </div>
    </div>
  )
}
