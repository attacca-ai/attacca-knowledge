import { useRef, useEffect, useState } from 'react'
import { TitleBar } from './TitleBar'
import { Sidebar, type SidebarView } from './Sidebar'
import { OfflineBanner } from '@/components/shared/OfflineBanner'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { Dashboard } from '@/components/dashboard/Dashboard'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { CaptureView } from '@/components/features/CaptureView'
import { TasksView } from '@/components/features/TasksView'
import { VaultView } from '@/components/features/VaultView'
import { AreasView } from '@/components/features/AreasView'
import { DecisionsView } from '@/components/features/DecisionsView'
import { ReviewsView } from '@/components/features/ReviewsView'
import { useActivityStore } from '@/stores/activity-store'
import { useCaptureStore } from '@/stores/capture-store'
import { useProjectStore } from '@/stores/project-store'
import { useTaskStore } from '@/stores/task-store'
import { useTodayStore } from '@/stores/today-store'
import { useVaultStore } from '@/stores/vault-store'
import { useAreaStore } from '@/stores/area-store'
import { useDecisionStore } from '@/stores/decision-store'
import { useReviewStore } from '@/stores/review-store'
import { useAgent } from '@/hooks/useAgent'

export function AppShell(): React.JSX.Element {
  const [activeView, setActiveView] = useState<SidebarView>('today')
  const prevViewRef = useRef<SidebarView>('today')
  const lastMessageRef = useRef<string | null>(null)
  const addActivity = useActivityStore((s) => s.addActivity)
  const completeTask = useTaskStore((s) => s.completeTask)
  const failTask = useTaskStore((s) => s.failTask)

  // Restore persisted state across every split store on mount (runs once).
  useEffect(() => {
    void Promise.all([
      useActivityStore.getState().hydrate(),
      useCaptureStore.getState().hydrate(),
      useProjectStore.getState().hydrate(),
      useTaskStore.getState().hydrate(),
      useTodayStore.getState().hydrate(),
      useVaultStore.getState().hydrate(),
      useAreaStore.getState().hydrate(),
      useDecisionStore.getState().hydrate(),
      useReviewStore.getState().hydrate()
    ])
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
      const task = useTaskStore.getState().currentTask
      if (task) completeTask(task.id, lastMessageRef.current ?? undefined)
      lastMessageRef.current = null
    })

    const unsubError = window.api.agent.onError((data) => {
      const errorMsg = data.error || 'An error occurred'
      addActivity({ type: 'error', description: errorMsg })
      const task = useTaskStore.getState().currentTask
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

  return (
    <div className="flex h-screen flex-col bg-background">
      <TitleBar />
      <OfflineBanner />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeView={activeView} onViewChange={setActiveView} />
        <main className="flex flex-1 flex-col overflow-hidden">
          <ErrorBoundary>
            {activeView === 'today' && <Dashboard />}
            {activeView === 'inbox' && <CaptureView />}
            {activeView === 'tasks' && <TasksView />}
            {activeView === 'areas' && <AreasView />}
            {activeView === 'decisions' && <DecisionsView />}
            {activeView === 'reviews' && <ReviewsView />}
            {activeView === 'vault' && <VaultView />}
            {activeView === 'settings' && <SettingsPage />}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
