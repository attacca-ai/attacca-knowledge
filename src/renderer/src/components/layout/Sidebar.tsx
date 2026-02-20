import {
  LayoutDashboard,
  Settings,
  Link2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Workflow,
  Calendar,
  Zap,
  Plug
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

export type SidebarView =
  | 'dashboard'
  | 'schedule'
  | 'transcripts'
  | 'workflows'
  | 'takeover'
  | 'meta-agent'
  | 'connections'
  | 'settings'

interface SidebarProps {
  activeView: SidebarView
  onViewChange: (view: SidebarView) => void
}

const MAIN_NAV: { id: SidebarView; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: 'schedule', label: 'Schedule', icon: <Calendar className="h-4 w-4" /> },
  { id: 'transcripts', label: 'Transcripts', icon: <FileText className="h-4 w-4" /> },
  { id: 'workflows', label: 'Workflows', icon: <Workflow className="h-4 w-4" /> },
  { id: 'takeover', label: 'Take Over', icon: <Zap className="h-4 w-4" /> },
  { id: 'meta-agent', label: 'Custom Tools', icon: <Plug className="h-4 w-4" /> }
]

const BOTTOM_NAV: { id: SidebarView; label: string; icon: React.ReactNode }[] = [
  { id: 'connections', label: 'Connections', icon: <Link2 className="h-4 w-4" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> }
]

export function Sidebar({ activeView, onViewChange }: SidebarProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)

  const renderItem = (item: { id: SidebarView; label: string; icon: React.ReactNode }): React.JSX.Element => (
    <button
      key={item.id}
      onClick={() => onViewChange(item.id)}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
        activeView === item.id
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'
      )}
      title={collapsed ? item.label : undefined}
    >
      {item.icon}
      {!collapsed && <span>{item.label}</span>}
    </button>
  )

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col border-r border-border bg-sidebar transition-[width]',
        collapsed ? 'w-12' : 'w-48'
      )}
    >
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {MAIN_NAV.map(renderItem)}
        <Separator className="my-2" />
        {BOTTOM_NAV.map(renderItem)}
      </nav>

      <div className="border-t border-sidebar-border p-2">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setCollapsed(!collapsed)}
          className="w-full"
        >
          {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
        </Button>
      </div>
    </div>
  )
}
