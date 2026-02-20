import { useState } from 'react'
import { useLicenseStore } from '@/stores/license-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, KeyRound, ExternalLink } from 'lucide-react'

export function LicenseGate({ onActivated }: { onActivated: () => void }): React.JSX.Element {
  const [key, setKey] = useState('')
  const { status, error, validate } = useLicenseStore()
  const isChecking = status === 'checking'

  const handleActivate = async (): Promise<void> => {
    if (!key.trim()) return
    const success = await validate(key.trim())
    if (success) {
      onActivated()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') handleActivate()
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Activate Attacca</CardTitle>
          <CardDescription>
            Enter your license key to get started. You can purchase a license on our website.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Input
              type="text"
              placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isChecking}
              className="font-mono text-sm"
              autoFocus
            />
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
            {status === 'expired' && (
              <p className="text-sm text-destructive">
                Your license has expired. Please renew your subscription.
              </p>
            )}
          </div>

          <Button onClick={handleActivate} disabled={isChecking || !key.trim()} className="w-full">
            {isChecking ? (
              <>
                <Loader2 className="animate-spin" />
                Verifying...
              </>
            ) : (
              'Activate'
            )}
          </Button>

          <div className="flex flex-col gap-2 pt-2 text-center">
            <button
              onClick={() => window.api.app.openExternal('https://attacca.gumroad.com')}
              className="inline-flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" />
              Purchase a license
            </button>
          </div>
        </CardContent>
      </Card>

      <p className="mt-8 text-xs text-muted-foreground">
        Attacca — AI Productivity Assistant
      </p>
    </div>
  )
}
