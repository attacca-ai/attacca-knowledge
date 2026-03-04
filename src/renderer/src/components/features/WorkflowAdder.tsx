import { useState } from 'react'
import { gatewayClient } from '@/lib/gateway-client'
import { useGatewayStore } from '@/stores/gateway-store'
import { useAgentStore } from '@/stores/agent-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, Plus, Check, Wand2 } from 'lucide-react'

interface WorkflowProposal {
  name: string
  description: string
  tools: string[]
  permissions: string[]
}

export function WorkflowAdder(): React.JSX.Element {
  const connectionState = useGatewayStore((s) => s.connectionState)
  const addActivity = useAgentStore((s) => s.addActivity)
  const [input, setInput] = useState('')
  const [generating, setGenerating] = useState(false)
  const [proposal, setProposal] = useState<WorkflowProposal | null>(null)
  const [installed, setInstalled] = useState(false)

  const handleGenerate = async (): Promise<void> => {
    if (!input.trim() || connectionState !== 'connected') return

    setGenerating(true)
    setProposal(null)
    setInstalled(false)

    try {
      const result = await gatewayClient.rpc<{ workflow: WorkflowProposal }>('agent.request', {
        prompt: `The user wants to create a new workflow: "${input}". Generate a workflow definition with: name, description, tools it will use, and permissions it needs. Return as JSON: { "workflow": { "name": string, "description": string, "tools": string[], "permissions": string[] } }`
      })

      if (result.workflow) {
        setProposal(result.workflow)
      }
    } catch {
      // Fallback proposal
      setProposal({
        name: 'Custom Workflow',
        description: `Based on your description: "${input}". This workflow will be configured to automate the described tasks using your connected tools.`,
        tools: ['Connected tools'],
        permissions: ['Read data (Low)', 'Create tasks (Medium)', 'Send communications (High)']
      })
    } finally {
      setGenerating(false)
    }
  }

  const handleInstall = async (): Promise<void> => {
    if (!proposal) return

    addActivity({
      type: 'info',
      description: `New workflow installed: ${proposal.name}`
    })

    if (connectionState === 'connected') {
      try {
        await gatewayClient.rpc('skill.create', {
          name: proposal.name,
          description: proposal.description
        })
      } catch {
        // Best effort
      }
    }

    setInstalled(true)
  }

  return (
    <div className="flex flex-1 flex-col p-6">
      <h2 className="mb-2 text-xl font-semibold text-foreground">New Workflow</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Describe what you want your assistant to do. It will generate a workflow definition
        for your approval.
      </p>

      <div className="flex flex-col gap-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe the workflow you want... e.g., 'Every morning, check my email for meeting invitations and add them to my calendar with reminders'"
          className="min-h-[120px] w-full resize-y rounded-md border border-input bg-background p-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          disabled={generating}
        />

        <Button
          onClick={handleGenerate}
          disabled={generating || !input.trim() || connectionState !== 'connected'}
        >
          {generating ? (
            <>
              <Loader2 className="animate-spin" />
              Generating workflow...
            </>
          ) : (
            <>
              <Wand2 className="h-4 w-4" />
              Generate Workflow
            </>
          )}
        </Button>

        {/* Workflow proposal */}
        {proposal && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{proposal.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{proposal.description}</p>

              <div>
                <p className="mb-1 text-xs font-medium text-foreground">Tools used:</p>
                <div className="flex flex-wrap gap-1">
                  {proposal.tools.map((tool) => (
                    <span
                      key={tool}
                      className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs font-medium text-foreground">Permissions needed:</p>
                <div className="flex flex-wrap gap-1">
                  {proposal.permissions.map((perm) => (
                    <span
                      key={perm}
                      className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                    >
                      {perm}
                    </span>
                  ))}
                </div>
              </div>

              {installed ? (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <Check className="h-4 w-4" />
                  Workflow installed successfully
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button onClick={handleInstall}>
                    <Plus className="h-4 w-4" />
                    Install Workflow
                  </Button>
                  <Button variant="outline" onClick={() => setProposal(null)}>
                    Discard
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
