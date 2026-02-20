import { useState } from 'react'
import { useOnboardingStore } from '@/stores/onboarding-store'
import { LLM_PROVIDERS, type LLMProviderKey } from '@/lib/constants'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Loader2, Check, ExternalLink, ArrowLeft, ArrowRight } from 'lucide-react'

export function LLMProviderStep({ onComplete: _ }: { onComplete: () => void }): React.JSX.Element {
  const { llmProvider, apiKeyValidated, setLLMProvider, setApiKeyValidated, nextStep, prevStep } =
    useOnboardingStore()

  const [selectedProvider, setSelectedProvider] = useState<LLMProviderKey | null>(
    (llmProvider as LLMProviderKey) || null
  )
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)

  const handleSelectProvider = (provider: LLMProviderKey): void => {
    setSelectedProvider(provider)
    setApiKey('')
    setTestError(null)
    setApiKeyValidated(false)
  }

  const handleTestConnection = async (): Promise<void> => {
    if (!selectedProvider || !apiKey.trim()) return

    setTesting(true)
    setTestError(null)

    try {
      const result = await window.api.llm.testConnection(selectedProvider, apiKey.trim())
      if (result.success) {
        const config = LLM_PROVIDERS[selectedProvider]
        setLLMProvider(selectedProvider, config.defaultModel)
        setApiKeyValidated(true)
        // Save config to OpenClaw
        await window.api.llm.saveConfig(selectedProvider, config.defaultModel, apiKey.trim())
      } else {
        setTestError(result.error || 'Connection test failed')
      }
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Test failed')
    } finally {
      setTesting(false)
    }
  }

  const canProceed = apiKeyValidated && selectedProvider

  return (
    <div className="flex flex-1 flex-col p-8">
      <div className="mx-auto w-full max-w-2xl">
        <h2 className="mb-2 text-2xl font-bold text-foreground">Choose your AI provider</h2>
        <p className="mb-6 text-muted-foreground">
          Attacca uses your own API key to connect to an AI provider. Select one below and
          enter your API key.
        </p>

        {/* Provider cards */}
        <div className="mb-6 grid grid-cols-3 gap-3">
          {(Object.entries(LLM_PROVIDERS) as [LLMProviderKey, (typeof LLM_PROVIDERS)[LLMProviderKey]][]).map(
            ([key, provider]) => (
              <Card
                key={key}
                className={`cursor-pointer transition-colors ${
                  selectedProvider === key
                    ? 'border-primary bg-primary/5'
                    : 'hover:border-muted-foreground/30'
                }`}
                onClick={() => handleSelectProvider(key)}
              >
                <CardHeader className="p-4">
                  <CardTitle className="flex items-center justify-between text-sm">
                    {provider.name}
                    {selectedProvider === key && apiKeyValidated && (
                      <Check className="h-4 w-4 text-green-500" />
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 pt-0">
                  <Badge variant="outline" className="text-xs">
                    {provider.defaultModel}
                  </Badge>
                </CardContent>
              </Card>
            )
          )}
        </div>

        {/* API key input */}
        {selectedProvider && (
          <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-foreground">
                {LLM_PROVIDERS[selectedProvider].name} API Key
              </h3>
              <button
                onClick={() =>
                  window.api.app.openExternal(LLM_PROVIDERS[selectedProvider].apiKeyUrl)
                }
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="h-3 w-3" />
                Get API key
              </button>
            </div>

            <div className="text-sm text-muted-foreground">
              {selectedProvider === 'anthropic' && (
                <p>Go to console.anthropic.com, create an API key, and paste it below.</p>
              )}
              {selectedProvider === 'openai' && (
                <p>Go to platform.openai.com, navigate to API keys, create one, and paste it below.</p>
              )}
              {selectedProvider === 'google' && (
                <p>Go to Google AI Studio, generate an API key, and paste it below.</p>
              )}
            </div>

            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="Paste your API key here"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  setTestError(null)
                  if (apiKeyValidated) setApiKeyValidated(false)
                }}
                className="font-mono text-sm"
              />
              <Button
                onClick={handleTestConnection}
                disabled={testing || !apiKey.trim()}
                variant={apiKeyValidated ? 'default' : 'outline'}
              >
                {testing ? (
                  <Loader2 className="animate-spin" />
                ) : apiKeyValidated ? (
                  <>
                    <Check className="h-4 w-4" />
                    Verified
                  </>
                ) : (
                  'Test Connection'
                )}
              </Button>
            </div>

            {testError && <p className="text-sm text-destructive">{testError}</p>}
            {apiKeyValidated && (
              <p className="text-sm text-green-600 dark:text-green-400">
                Connection verified successfully!
              </p>
            )}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="mx-auto mt-auto flex w-full max-w-2xl items-center justify-between pt-6">
        <Button variant="ghost" onClick={prevStep}>
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button onClick={nextStep} disabled={!canProceed}>
          Next
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
