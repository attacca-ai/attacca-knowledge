import { useState, useEffect, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { useOnboardingStore } from '@/stores/onboarding-store'
import { TOOL_CATEGORIES } from '@/lib/constants'
import { ToolCard } from './connections/ToolCard'
import { CatalogPanel } from './connections/CatalogPanel'
import { EscapeHatch } from './connections/EscapeHatch'

interface ConnectionsPageProps {
  onNavigateToCustomTools: (toolName: string) => void
}

// Tools that use credential-based auth instead of Composio OAuth
const CREDENTIAL_BASED_TOOLS = ['activecollab', 'telegram']

// All tools from curated categories
const ALL_CURATED_TOOLS = Object.values(TOOL_CATEGORIES).flatMap((c) => c.tools)

// Curated metadata: emoji + short description
const TOOL_META: Record<string, { emoji: string; label: string; description: string }> = {
  'google-calendar': { emoji: '📅', label: 'Google Calendar', description: 'Calendario y recordatorios' },
  'outlook-calendar': { emoji: '📆', label: 'Outlook Calendar', description: 'Calendario de Microsoft' },
  gmail: { emoji: '📧', label: 'Gmail', description: 'Correo de Google' },
  'outlook-email': { emoji: '📨', label: 'Outlook Mail', description: 'Correo de Microsoft' },
  clickup: { emoji: '✔️', label: 'ClickUp', description: 'Gestión de proyectos todo-en-uno' },
  asana: { emoji: '🔔', label: 'Asana', description: 'Proyectos y seguimiento de tareas' },
  trello: { emoji: '🧩', label: 'Trello', description: 'Tableros Kanban' },
  notion: { emoji: '📊', label: 'Notion', description: 'Docs y bases de datos' },
  activecollab: { emoji: '🟠', label: 'ActiveCollab', description: 'Gestión de proyectos' },
  'google-drive': { emoji: '📁', label: 'Google Drive', description: 'Almacenamiento en la nube' },
  onedrive: { emoji: '☁️', label: 'OneDrive', description: 'Almacenamiento de Microsoft' },
  dropbox: { emoji: '📦', label: 'Dropbox', description: 'Sincronización de archivos' },
  slack: { emoji: '💬', label: 'Slack', description: 'Mensajería de equipo' },
  teams: { emoji: '🤝', label: 'Microsoft Teams', description: 'Colaboración de equipo' },
  telegram: { emoji: '✈️', label: 'Telegram', description: 'Notificaciones del agente' }
}

function getToolMeta(toolId: string): { emoji: string; label: string; description: string } {
  return (
    TOOL_META[toolId] ?? {
      emoji: toolId.charAt(0).toUpperCase(),
      label: toolId,
      description: 'Herramienta externa'
    }
  )
}

export function ConnectionsPage({
  onNavigateToCustomTools
}: ConnectionsPageProps): React.JSX.Element {
  const { connectedTools, addConnectedTool, removeConnectedTool } = useOnboardingStore()
  const [connecting, setConnecting] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ActiveCollab dialog state
  const [acDialogOpen, setAcDialogOpen] = useState(false)
  const [acTab, setAcTab] = useState<string>('cloud')
  const [acEmail, setAcEmail] = useState('')
  const [acPassword, setAcPassword] = useState('')
  const [acInstanceUrl, setAcInstanceUrl] = useState('')
  const [acConnecting, setAcConnecting] = useState(false)

  // Load persisted connected tools on mount
  useEffect(() => {
    async function loadConnections(): Promise<void> {
      try {
        const relayApps = await window.api.composio.getConnected()
        for (const app of relayApps) addConnectedTool(app)
      } catch {
        // Composio may not be configured
      }
      try {
        const localTools = await window.api.oauth.getConnected()
        for (const tool of localTools) addConnectedTool(tool)
      } catch {
        // ignore
      }
    }
    loadConnections()
  }, [addConnectedTool])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  // Listen for local OAuth callbacks (Telegram)
  useEffect(() => {
    const unsub = window.api.oauth.onCallback(
      (result: { success: boolean; provider: string; error?: string }) => {
        if (result.success) addConnectedTool(result.provider)
        else setError(result.error || 'Connection failed')
        setConnecting(null)
      }
    )
    return unsub
  }, [addConnectedTool])

  const handleConnect = async (tool: string): Promise<void> => {
    if (tool === 'activecollab') {
      setAcDialogOpen(true)
      return
    }

    if (tool === 'telegram') {
      setConnecting(tool)
      setError(null)
      const result = await window.api.oauth.start(tool)
      if (!result.success) {
        setError(result.error || 'Could not start connection')
        setConnecting(null)
      }
      return
    }

    setConnecting(tool)
    setError(null)
    try {
      const result = await window.api.composio.initiateOAuth(tool)
      if (!result.success) {
        setError(result.error || 'Could not start connection')
        setConnecting(null)
        return
      }
      if (!result.redirectUrl || !result.connectionId) {
        setError('Missing redirect URL or connection ID')
        setConnecting(null)
        return
      }
      await window.api.app.openExternal(result.redirectUrl)
      const connectionId = result.connectionId
      pollRef.current = setInterval(async () => {
        try {
          const status = await window.api.composio.getStatus(connectionId)
          if (status.status === 'active') {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            addConnectedTool(tool)
            setConnecting(null)
          } else if (status.status === 'failed' || status.status === 'expired') {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            setError(`Conexión ${status.status}. Inténtalo de nuevo.`)
            setConnecting(null)
          }
        } catch {
          // Keep polling on network errors
        }
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed')
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
    if (CREDENTIAL_BASED_TOOLS.includes(tool)) {
      const result = await window.api.oauth.disconnect(tool)
      if (result.success) removeConnectedTool(tool)
      else setError(result.error || 'Disconnect failed')
    } else {
      const result = await window.api.oauth.disconnect(tool)
      if (result.success) removeConnectedTool(tool)
      else setError('Disconnect failed')
    }
    setDisconnecting(null)
  }

  // Build display sets
  const connectedCurated = ALL_CURATED_TOOLS.filter((t) => connectedTools.includes(t))
  const connectedExtras = connectedTools.filter((t) => !(ALL_CURATED_TOOLS as readonly string[]).includes(t))
  const allConnectedForDisplay = [...connectedCurated, ...connectedExtras]
  const availableCurated = ALL_CURATED_TOOLS.filter((t) => !connectedTools.includes(t))

  return (
    <div className="flex flex-1 overflow-hidden bg-[#0e0f11]">
      {/* ── Main panel ── */}
      <div className="flex flex-1 flex-col overflow-hidden border-r border-[#1f2024]">
        {/* Header */}
        <div className="shrink-0 border-b border-[#1f2024] px-8 py-6">
          <div className="mb-[5px] font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55]">
            Connections
          </div>
          <h1 className="mb-1 text-[20px] font-light tracking-[-0.01em] text-[#e8e9eb]">
            Herramientas conectadas
          </h1>
          <p className="max-w-[480px] text-[12.5px] leading-[1.5] text-[#7a7d85]">
            Las herramientas que el agente puede usar. Conecta lo que necesites y el agente se adapta.
          </p>
        </div>

        {/* Body */}
        <div
          className="flex-1 overflow-y-auto px-8 py-5"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#2a2b2f transparent' }}
        >
          {error && (
            <div className="mb-4 max-w-[600px] rounded-md border border-[rgba(224,92,92,.3)] bg-[rgba(224,92,92,.1)] px-3 py-2 text-sm text-[#e05c5c]">
              {error}
            </div>
          )}

          {/* Connected tools */}
          {allConnectedForDisplay.length > 0 && (
            <section className="mb-6">
              <SectionLabel>Conectadas</SectionLabel>
              <div className="grid max-w-[600px] grid-cols-2 gap-2">
                {allConnectedForDisplay.map((tool) => {
                  const meta = getToolMeta(tool)
                  return (
                    <ToolCard
                      key={tool}
                      toolId={tool}
                      label={meta.label}
                      description={meta.description}
                      emoji={meta.emoji}
                      isConnected={true}
                      isConnecting={connecting === tool}
                      isDisconnecting={disconnecting === tool}
                      onConnect={() => handleConnect(tool)}
                      onDisconnect={() => handleDisconnect(tool)}
                    />
                  )
                })}
              </div>
            </section>
          )}

          {/* Available curated tools */}
          {availableCurated.length > 0 && (
            <section className="mb-6">
              <SectionLabel>Agregar del catálogo</SectionLabel>
              <div className="grid max-w-[600px] grid-cols-2 gap-2">
                {availableCurated.map((tool) => {
                  const meta = getToolMeta(tool)
                  return (
                    <ToolCard
                      key={tool}
                      toolId={tool}
                      label={meta.label}
                      description={meta.description}
                      emoji={meta.emoji}
                      isConnected={false}
                      isConnecting={connecting === tool}
                      isDisconnecting={false}
                      onConnect={() => handleConnect(tool)}
                      onDisconnect={() => handleDisconnect(tool)}
                    />
                  )
                })}
              </div>
            </section>
          )}

          {/* Escape hatch */}
          <section>
            <SectionLabel>¿No encuentras lo que necesitas?</SectionLabel>
            <EscapeHatch onClick={() => onNavigateToCustomTools('')} />
          </section>
        </div>
      </div>

      {/* ── Catalog panel (right) ── */}
      <CatalogPanel
        connectedTools={connectedTools}
        onConnectTool={handleConnect}
        onNavigateToCustomTools={onNavigateToCustomTools}
      />

      {/* ActiveCollab dialog */}
      <Dialog open={acDialogOpen} onOpenChange={setAcDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar ActiveCollab</DialogTitle>
            <DialogDescription>
              Tu contraseña se envía directamente a ActiveCollab y no es almacenada por Attacca.
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
                  placeholder="tu@empresa.com"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ac-cloud-password">Contraseña</Label>
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
                <Label htmlFor="ac-sh-url">URL de instancia</Label>
                <Input
                  id="ac-sh-url"
                  type="url"
                  value={acInstanceUrl}
                  onChange={(e) => setAcInstanceUrl(e.target.value)}
                  placeholder="https://projects.miempresa.com"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ac-sh-email">Email</Label>
                <Input
                  id="ac-sh-email"
                  type="email"
                  value={acEmail}
                  onChange={(e) => setAcEmail(e.target.value)}
                  placeholder="tu@empresa.com"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ac-sh-password">Contraseña</Label>
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
              disabled={
                acConnecting ||
                !acEmail ||
                !acPassword ||
                (acTab === 'selfhosted' && !acInstanceUrl)
              }
            >
              {acConnecting ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Conectar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-[10px] flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.12em] text-[#4a4d55]">
      {children}
      <span className="h-px flex-1 bg-[#1f2024]" />
    </div>
  )
}
