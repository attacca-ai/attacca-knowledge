import { LayoutDashboard, Settings, Link2, ChevronLeft, ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export type SidebarView = 'dashboard' | 'settings' | 'connections'

interface SidebarProps {
  activeView: SidebarView
  onViewChange: (view: SidebarView) => void
}

const NAV_ITEMS: { id: SidebarView; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: 'connections', label: 'Connections', icon: <Link2 className="h-4 w-4" /> },
  { id: 'settings', label: 'Settings', icon: <Settings className="h-4 w-4" /> }
]

export function Sidebar({ activeView, onViewChange }: SidebarProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col border-r border-border bg-sidebar transition-[width]',
        collapsed ? 'w-12' : 'w-48'
      )}
    >
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {NAV_ITEMS.map((item) => (
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
        ))}
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
