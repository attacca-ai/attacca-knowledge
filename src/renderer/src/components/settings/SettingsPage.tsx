import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Check, Loader2, FolderOpen, Key, Shield, Users } from 'lucide-react'
import { LLM_PROVIDERS, type LLMProviderKey } from '@/lib/constants'
import { useSettingsStore } from '@/stores/settings-store'
import { useTrustStore } from '@/stores/trust-store'
import { TRUST_PROFILES, type TrustProfile } from '@/types/trust'
import { BYOKGuide } from './BYOKGuide'
import { TelemetryDataCategories } from './TelemetryDataCategories'

export function SettingsPage(): React.JSX.Element {
  // BYOK state
  const [selectedProvider, setSelectedProvider] = useState<LLMProviderKey>('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [apiKeyHint, setApiKeyHint] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  )

  // App Preferences
  const settings = useSettingsStore()
  const { loadSettings } = settings

  // Trust profile
  const trustProfile = useTrustStore((s) => s.profile)
  const setTrustProfile = useTrustStore((s) => s.setProfile)
  const loadTrustProfile = useTrustStore((s) => s.loadProfile)

  // Load settings on mount
  useEffect(() => {
    loadSettings()
    loadLLMConfig()
    loadTrustProfile()
  }, [loadSettings, loadTrustProfile])

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
      setFeedback({ type: 'error', message: 'Please enter an API key' })
      return
    }

    setTesting(true)
    setFeedback(null)

    try {
      const result = await window.api.llm.testConnection(selectedProvider, apiKey)
      if (!result.success) {
        setFeedback({ type: 'error', message: result.error || 'Connection test failed' })
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
      setFeedback({ type: 'success', message: 'API key saved. Gateway restarted.' })
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save'
      })
    } finally {
      setTesting(false)
      setSaving(false)
    }
  }

  function handleToggleBYOK(enabled: boolean): void {
    settings.setSetting('byokEnabled', enabled)
    if (!enabled) {
      settings.setSetting('byokProvider', null)
    }
  }

  async function handleTelemetryToggle(optIn: boolean): Promise<void> {
    settings.setSetting('telemetryOptIn', optIn)
    await window.api.telemetry.setOptIn(optIn)
  }

  async function handleDeleteTelemetryData(): Promise<void> {
    await window.api.telemetry.deleteData()
    setFeedback({ type: 'success', message: 'Telemetry data deleted.' })
  }

  async function handleSelectFolder(): Promise<void> {
    const path = await window.api.fs.selectFolder()
    if (path) {
      settings.setSetting('folderWatchPath', path)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-8 overflow-y-auto p-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure BYOK, preferences, and research data
        </p>
      </div>

      {/* ── Section 1: Bring Your Own Key ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-medium text-foreground">Bring Your Own Key</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Use your own API key to bypass the managed relay and monthly usage ceiling.
          When disabled, Attacca uses the managed relay service.
        </p>

        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <Label htmlFor="byok-toggle">Enable BYOK</Label>
          <Switch
            id="byok-toggle"
            checked={settings.byokEnabled}
            onCheckedChange={handleToggleBYOK}
          />
        </div>

        {settings.byokEnabled && (
          <>
            <div className="grid grid-cols-3 gap-3">
              {(
                Object.entries(LLM_PROVIDERS) as [
                  LLMProviderKey,
                  (typeof LLM_PROVIDERS)[LLMProviderKey]
                ][]
              ).map(([key, provider]) => (
                <Card
                  key={key}
                  className={`cursor-pointer transition-colors ${
                    selectedProvider === key
                      ? 'border-primary bg-primary/5'
                      : 'hover:border-muted-foreground/30'
                  }`}
                  onClick={() => {
                    setSelectedProvider(key)
                    setFeedback(null)
                  }}
                >
                  <CardHeader className="p-4 pb-2">
                    <CardTitle className="text-sm font-medium">{provider.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <Badge variant="secondary" className="text-xs">
                      {provider.defaultModel}
                    </Badge>
                    {selectedProvider === key && <Check className="mt-2 size-4 text-primary" />}
                  </CardContent>
                </Card>
              ))}
            </div>

            <BYOKGuide provider={selectedProvider} />

            {apiKeyHint && (
              <p className="text-sm text-muted-foreground">
                Current key: <span className="font-mono">{apiKeyHint}</span>
              </p>
            )}

            <div className="flex items-end gap-3">
              <div className="flex-1 space-y-2">
                <Label htmlFor="api-key">API Key</Label>
                <Input
                  id="api-key"
                  type="password"
                  placeholder={apiKeyHint ? 'Enter new key to replace' : 'Paste your API key'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
              <Button onClick={handleTestAndSave} disabled={testing || saving || !apiKey.trim()}>
                {testing ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Testing...
                  </>
                ) : saving ? (
                  <>
                    <Loader2 className="mr-2 size-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Test & Save'
                )}
              </Button>
            </div>

            {feedback && (
              <p
                className={`text-sm ${feedback.type === 'success' ? 'text-green-600' : 'text-destructive'}`}
              >
                {feedback.message}
              </p>
            )}
          </>
        )}
      </section>

      <Separator />

      {/* ── Section 2: App Preferences ── */}
      <section className="space-y-6">
        <h3 className="text-lg font-medium text-foreground">App Preferences</h3>

        <div className="grid grid-cols-2 gap-6">
          {/* Morning briefing time */}
          <div className="space-y-2">
            <Label htmlFor="morning-time">Morning briefing time</Label>
            <Input
              id="morning-time"
              type="time"
              value={settings.morningBriefingTime}
              onChange={(e) => settings.setSetting('morningBriefingTime', e.target.value)}
            />
          </div>

          {/* EOD summary time */}
          <div className="space-y-2">
            <Label htmlFor="eod-time">EOD summary time</Label>
            <Input
              id="eod-time"
              type="time"
              value={settings.eodSummaryTime}
              onChange={(e) => settings.setSetting('eodSummaryTime', e.target.value)}
            />
          </div>

          {/* Take Over summary interval */}
          <div className="space-y-2">
            <Label>Take Over summary interval</Label>
            <Select
              value={String(settings.takeOverSummaryInterval)}
              onValueChange={(v) => settings.setSetting('takeOverSummaryInterval', Number(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Every 1 hour</SelectItem>
                <SelectItem value="2">Every 2 hours</SelectItem>
                <SelectItem value="3">Every 3 hours</SelectItem>
                <SelectItem value="4">Every 4 hours</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Take Over auto-disable */}
          <div className="space-y-2">
            <Label>Take Over auto-disable after</Label>
            <Select
              value={String(settings.takeOverAutoDisable)}
              onValueChange={(v) => settings.setSetting('takeOverAutoDisable', Number(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {h} hours
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Folder watch */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="folder-watch">Folder watch</Label>
            <Switch
              id="folder-watch"
              checked={settings.folderWatchEnabled}
              onCheckedChange={(checked) => settings.setSetting('folderWatchEnabled', checked)}
            />
          </div>
          {settings.folderWatchEnabled && (
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={settings.folderWatchPath || 'No folder selected'}
                className="flex-1 text-sm"
              />
              <Button variant="outline" size="icon" onClick={handleSelectFolder}>
                <FolderOpen className="size-4" />
              </Button>
            </div>
          )}
        </div>
      </section>

      <Separator />

      {/* ── Section 3: Trust Profile ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-medium text-foreground">Trust Profile</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Control how much autonomy your assistant has when performing actions.
        </p>

        <div className="flex flex-col gap-2">
          {(Object.entries(TRUST_PROFILES) as [TrustProfile, (typeof TRUST_PROFILES)[TrustProfile]][]).map(
            ([key, config]) => (
              <label
                key={key}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                  trustProfile === key
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/30'
                }`}
              >
                <input
                  type="radio"
                  name="trust-profile"
                  value={key}
                  checked={trustProfile === key}
                  onChange={() => setTrustProfile(key)}
                  className="mt-0.5"
                />
                <div>
                  <div className="text-sm font-medium text-foreground">{config.label}</div>
                  <div className="text-xs text-muted-foreground">{config.description}</div>
                </div>
              </label>
            )
          )}
        </div>
      </section>

      <Separator />

      {/* ── Section 4: Research Data ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-medium text-foreground">Research Data</h3>
        </div>

        <div className="flex items-center justify-between rounded-md border border-border p-3">
          <div>
            <Label htmlFor="telemetry-toggle">Anonymous research telemetry</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Help improve Attacca by sharing anonymous usage patterns
            </p>
          </div>
          <Switch
            id="telemetry-toggle"
            checked={settings.telemetryOptIn}
            onCheckedChange={handleTelemetryToggle}
          />
        </div>

        <div className="flex items-center gap-2">
          <TelemetryDataCategories />
          <Button variant="outline" size="sm" onClick={handleDeleteTelemetryData}>
            Delete My Data
          </Button>
        </div>
      </section>
    </div>
  )
}
