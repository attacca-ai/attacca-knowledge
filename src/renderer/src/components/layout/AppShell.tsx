import { useRef, useEffect, useMemo, useState } from 'react'
import { TitleBar } from './TitleBar'
import { Sidebar, type SidebarView } from './Sidebar'
import { OfflineBanner } from '@/components/shared/OfflineBanner'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { Dashboard } from '@/components/dashboard/Dashboard'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { CaptureView } from '@/components/features/CaptureView'
import { TasksView } from '@/components/features/TasksView'
import { KnowledgeBasePage } from '@/components/features/KnowledgeBasePage'
import { ApprovalDialog } from '@/components/permissions/ApprovalDialog'
import { MidRiskNotification } from '@/components/permissions/MidRiskNotification'
import { usePermissionStore } from '@/stores/permission-store'
import { useAgentStore } from '@/stores/agent-store'
import { useAgent } from '@/hooks/useAgent'
import type { RiskTier } from '@/lib/permission-engine'

export function AppShell(): React.JSX.Element {
  const [activeView, setActiveView] = useState<SidebarView>('dashboard')
  const prevViewRef = useRef<SidebarView>('dashboard')
  const lastMessageRef = useRef<string | null>(null)
  const pendingApprovals = usePermissionStore((s) => s.pendingApprovals)
  const { addActivity, completeTask, failTask, hydrate } = useAgentStore()
  const midRiskApprovals = useMemo(
    () => pendingApprovals.filter((a) => a.tier === 'medium'),
    [pendingApprovals]
  )

  // Restore persisted state on mount (runs once, never unmounts)
  useEffect(() => {
    hydrate()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cross-component navigation via custom events
  useEffect(() => {
    const handler = (e: Event): void => {
      const { view } = (e as CustomEvent<{ view: SidebarView }>).detail
      if (view) setActiveView(view)
    }
    window.addEventListener('attacca:navigate', handler)
    return () => window.removeEventListener('attacca:navigate', handler)
  }, [])

  // Initialize the agent client IPC listeners (must be called once at root level)
  useAgent()

  // Global agent event listeners — live in AppShell so they never unmount.
  // This ensures agent events (task completion, chat messages, errors) are
  // captured even when the user navigates away from the Dashboard.
  useEffect(() => {
    const unsubToolCall = window.api.agent.onToolCall((data) => {
      addActivity({
        type: 'tool_call',
        description: `Calling tool: ${data.toolName || 'unknown'}`,
        details: JSON.stringify(data.toolInput, null, 2)
      })
    })

    const unsubToolResult = window.api.agent.onToolResult((data) => {
      addActivity({
        type: 'tool_result',
        description: 'Tool result received',
        details: data.summary
      })
    })

    const unsubFinal = window.api.agent.onFinal((data) => {
      const text = data.message
      if (text) {
        lastMessageRef.current = text
        addActivity({ type: 'message', description: text })
      }
      const task = useAgentStore.getState().currentTask
      if (task) completeTask(task.id, lastMessageRef.current ?? undefined)
      lastMessageRef.current = null
    })

    const unsubError = window.api.agent.onError((data) => {
      const errorMsg = data.error || 'An error occurred'
      addActivity({ type: 'error', description: errorMsg })
      const task = useAgentStore.getState().currentTask
      if (task) failTask(task.id, errorMsg)
    })

    return () => {
      unsubToolCall()
      unsubToolResult()
      unsubFinal()
      unsubError()
    }
  }, [addActivity, completeTask, failTask])

  useEffect(() => {
    const prev = prevViewRef.current
    if (prev !== activeView) {
      window.api.telemetry.emit('feature.viewed', { view: activeView, previousView: prev })
      prevViewRef.current = activeView
    }
  }, [activeView])

  // Listen for permission requests from the main process (Composio server)
  useEffect(() => {
    const unsub = window.api.permission.onRequest((request) => {
      const { isStandingApprovalActive, addPendingApproval } = usePermissionStore.getState()

      // Check renderer-side standing approval first
      if (isStandingApprovalActive(request.actionName, request.toolkit)) {
        window.api.permission.resolve(request.requestId, true, false)
        return
      }

      addPendingApproval(
        {
          actionType: request.actionName,
          toolId: request.toolkit,
          tier: request.tier as RiskTier,
          description: request.description,
          params: request.params
        },
        request.requestId
      )
    })
    return unsub
  }, [])

  return (
    <div className="flex h-screen flex-col bg-background">
      <TitleBar />
      <OfflineBanner />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeView={activeView} onViewChange={setActiveView} />
        <main className="flex flex-1 flex-col overflow-hidden">
          <ErrorBoundary>
            {activeView === 'dashboard' && <Dashboard />}
            {activeView === 'capture' && <CaptureView />}
            {activeView === 'tasks' && <TasksView />}
            {activeView === 'knowledge-base' && <KnowledgeBasePage />}
            {activeView === 'settings' && <SettingsPage />}
          </ErrorBoundary>
        </main>
      </div>

      {/* Permission UI — renders globally so it works from any view */}
      <ApprovalDialog />
      {midRiskApprovals.map((a) => (
        <div key={a.id} className="fixed bottom-4 right-4 z-50 w-96">
          <MidRiskNotification approval={a} />
        </div>
      ))}
    </div>
  )
}
