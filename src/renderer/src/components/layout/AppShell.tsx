import { useState } from 'react'
import { TitleBar } from './TitleBar'
import { Sidebar, type SidebarView } from './Sidebar'
import { Dashboard } from '@/components/dashboard/Dashboard'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { ConnectionsPage } from '@/components/settings/ConnectionsPage'

export function AppShell(): React.JSX.Element {
  const [activeView, setActiveView] = useState<SidebarView>('dashboard')

  return (
    <div className="flex h-screen flex-col bg-background">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar activeView={activeView} onViewChange={setActiveView} />
        <main className="flex flex-1 flex-col overflow-hidden">
          {activeView === 'dashboard' && <Dashboard />}
          {activeView === 'settings' && <SettingsPage />}
          {activeView === 'connections' && <ConnectionsPage />}
        </main>
      </div>
    </div>
  )
}
