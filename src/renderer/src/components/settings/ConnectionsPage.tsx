import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useOnboardingStore } from '@/stores/onboarding-store'
import { TOOL_CATEGORIES } from '@/lib/constants'
import { Loader2 } from 'lucide-react'

const TOOL_NAMES: Record<string, string> = {
  'google-calendar': 'Google Calendar',
  'outlook-calendar': 'Outlook Calendar',
  gmail: 'Gmail',
  'outlook-email': 'Outlook Email',
  clickup: 'ClickUp',
  asana: 'Asana',
  trello: 'Trello',
  notion: 'Notion',
  activecollab: 'ActiveCollab',
  'google-drive': 'Google Drive',
  onedrive: 'OneDrive',
  dropbox: 'Dropbox',
  slack: 'Slack',
  teams: 'Microsoft Teams',
  telegram: 'Telegram'
}

// All tools from categories
const ALL_TOOLS = Object.values(TOOL_CATEGORIES).flatMap((c) => c.tools)

export function ConnectionsPage(): React.JSX.Element {
  const { connectedTools, addConnectedTool, removeConnectedTool } = useOnboardingStore()
  const [connecting, setConnecting] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ActiveCollab dialog state
  const [acDialogOpen, setAcDialogOpen] = useState(false)
  const [acTab, setAcTab] = useState<string>('cloud')
  const [acEmail, setAcEmail] = useState('')
  const [acPassword, setAcPassword] = useState('')
  const [acInstanceUrl, setAcInstanceUrl] = useState('')
  const [acConnecting, setAcConnecting] = useState(false)

  // Load persisted connected tools on mount
  useEffect(() => {
    window.api.oauth.getConnected().then((tools) => {
      for (const tool of tools) {
        addConnectedTool(tool)
      }
    })
  }, [addConnectedTool])

  // Listen for OAuth callbacks
  useEffect(() => {
    const unsub = window.api.oauth.onCallback((result) => {
      if (result.success) {
        addConnectedTool(result.provider)
      } else {
        setError(result.error || 'Connection failed')
      }
      setConnecting(null)
    })
    return unsub
  }, [addConnectedTool])

  const handleConnect = async (tool: string): Promise<void> => {
    // ActiveCollab uses credential-based auth — open dialog
    if (tool === 'activecollab') {
      setAcDialogOpen(true)
      return
    }

    setConnecting(tool)
    setError(null)
    const result = await window.api.oauth.start(tool)
    if (!result.success) {
      setError(result.error || 'Could not start connection')
      setConnecting(null)
    }
  }

  const handleActiveCollabConnect = async (): Promise<void> => {
    setAcConnecting(true)
    setError(null)

    try {
      const result =
        acTab === 'cloud'
          ? await window.api.activecollab.connectCloud(acEmail, acPassword)
          : await window.api.activecollab.connectSelfHosted(acInstanceUrl, acEmail, acPassword)

      if (result.success) {
        addConnectedTool('activecollab')
        setAcDialogOpen(false)
        setAcEmail('')
        setAcPassword('')
        setAcInstanceUrl('')
      } else {
        setError(result.error || 'ActiveCollab connection failed')
      }
    } catch {
      setError('ActiveCollab connection failed')
    }
    setAcConnecting(false)
  }

  const handleDisconnect = async (tool: string): Promise<void> => {
    setDisconnecting(tool)
    setError(null)
    const result = await window.api.oauth.disconnect(tool)
    if (result.success) {
      removeConnectedTool(tool)
    } else {
      setError(result.error || 'Disconnect failed')
    }
    setDisconnecting(null)
  }

  return (
    <div className="flex flex-1 flex-col p-6">
      <h2 className="mb-4 text-xl font-semibold text-foreground">Connections</h2>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {ALL_TOOLS.map((tool) => {
          const isConnected = connectedTools.includes(tool)
          const isConnecting = connecting === tool
          const isDisconnecting = disconnecting === tool

          return (
            <div
              key={tool}
              className="flex items-center justify-between rounded-md border border-border p-3"
            >
              <span className="text-sm text-foreground">{TOOL_NAMES[tool] || tool}</span>
              <div className="flex items-center gap-2">
                {isConnected ? (
                  <>
                    <Badge
                      variant="outline"
                      className="text-green-600 dark:text-green-400"
                    >
                      Connected
                    </Badge>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" disabled={isDisconnecting}>
                          {isDisconnecting ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            'Disconnect'
                          )}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Disconnect {TOOL_NAMES[tool] || tool}?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This will remove the stored credentials. You can reconnect at
                            any time.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => handleDisconnect(tool)}
                          >
                            Disconnect
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isConnecting}
                    onClick={() => handleConnect(tool)}
                  >
                    {isConnecting ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : null}
                    Connect
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ActiveCollab Connection Dialog */}
      <Dialog open={acDialogOpen} onOpenChange={setAcDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect ActiveCollab</DialogTitle>
            <DialogDescription>
              Your password is sent directly to ActiveCollab and is not stored by Attacca.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={acTab} onValueChange={setAcTab}>
            <TabsList className="w-full">
              <TabsTrigger value="cloud" className="flex-1">
                Cloud
              </TabsTrigger>
              <TabsTrigger value="selfhosted" className="flex-1">
                Self-Hosted
              </TabsTrigger>
            </TabsList>

            <TabsContent value="cloud" className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ac-cloud-email">Email</Label>
                <Input
                  id="ac-cloud-email"
                  type="email"
                  value={acEmail}
                  onChange={(e) => setAcEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ac-cloud-password">Password</Label>
                <Input
                  id="ac-cloud-password"
                  type="password"
                  value={acPassword}
                  onChange={(e) => setAcPassword(e.target.value)}
                />
              </div>
            </TabsContent>

            <TabsContent value="selfhosted" className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ac-sh-url">Instance URL</Label>
                <Input
                  id="ac-sh-url"
                  type="url"
                  value={acInstanceUrl}
                  onChange={(e) => setAcInstanceUrl(e.target.value)}
                  placeholder="https://projects.mycompany.com"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ac-sh-email">Email</Label>
                <Input
                  id="ac-sh-email"
                  type="email"
                  value={acEmail}
                  onChange={(e) => setAcEmail(e.target.value)}
                  placeholder="you@company.com"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ac-sh-password">Password</Label>
                <Input
                  id="ac-sh-password"
                  type="password"
                  value={acPassword}
                  onChange={(e) => setAcPassword(e.target.value)}
                />
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button
              onClick={handleActiveCollabConnect}
              disabled={acConnecting || !acEmail || !acPassword || (acTab === 'selfhosted' && !acInstanceUrl)}
            >
              {acConnecting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
