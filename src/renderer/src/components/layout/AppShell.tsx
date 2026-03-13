import { useState } from 'react'
import { TitleBar } from './TitleBar'
import { Sidebar, type SidebarView } from './Sidebar'
import { OfflineBanner } from '@/components/shared/OfflineBanner'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { Dashboard } from '@/components/dashboard/Dashboard'
import { ScheduleView } from '@/components/features/ScheduleView'
import { TranscriptUpload } from '@/components/features/TranscriptUpload'
import { WorkflowAdder } from '@/components/features/WorkflowAdder'
import { TakeOverMode } from '@/components/features/TakeOverMode'
import { MetaAgent } from '@/components/features/MetaAgent'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { ConnectionsPage } from '@/components/settings/ConnectionsPage'
import { CustomToolsPage } from '@/components/custom-tools/CustomToolsPage'
import { CaptureView } from '@/components/features/CaptureView'

export function AppShell(): React.JSX.Element {
  const [activeView, setActiveView] = useState<SidebarView>('dashboard')
  const [customToolName, setCustomToolName] = useState<string>('')

  const handleNavigateToCustomTools = (toolName: string): void => {
    setCustomToolName(toolName)
    setActiveView('custom-tools')
  }

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
            {activeView === 'schedule' && <ScheduleView />}
            {activeView === 'transcripts' && <TranscriptUpload />}
            {activeView === 'workflows' && <WorkflowAdder />}
            {activeView === 'takeover' && <TakeOverMode />}
            {activeView === 'meta-agent' && <MetaAgent />}
            {activeView === 'settings' && <SettingsPage />}
            {activeView === 'connections' && (
              <ConnectionsPage onNavigateToCustomTools={handleNavigateToCustomTools} />
            )}
            {activeView === 'custom-tools' && (
              <CustomToolsPage
                initialToolName={customToolName}
                onBack={() => setActiveView('connections')}
              />
            )}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
