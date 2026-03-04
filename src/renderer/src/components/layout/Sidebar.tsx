import {
  LayoutDashboard,
  Settings,
  Link2,
  FileText,
  Workflow,
  Calendar,
  Zap,
  Plug,
  PlusSquare,
} from 'lucide-react'
import { useAgentStore } from '@/stores/agent-store'
import { cn } from '@/lib/utils'

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

interface NavItem {
  id: SidebarView
  label: string
  icon: React.ReactNode
  badge?: number
  isCapture?: boolean
}

export function Sidebar({ activeView, onViewChange }: SidebarProps): React.JSX.Element {
  const rawCapturesCount = useAgentStore((s) => s.rawCapturesCount)

  const WORKSPACE_NAV: NavItem[] = [
    { id: 'dashboard',   label: 'Landscape',   icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
    { id: 'dashboard',   label: 'Capture',     icon: <PlusSquare className="h-3.5 w-3.5" />, isCapture: true, badge: rawCapturesCount > 0 ? rawCapturesCount : undefined },
    { id: 'schedule',    label: 'Schedule',    icon: <Calendar className="h-3.5 w-3.5" /> },
    { id: 'transcripts', label: 'Transcripts', icon: <FileText className="h-3.5 w-3.5" /> },
  ]

  const AGENT_NAV: NavItem[] = [
    { id: 'workflows',   label: 'Workflows',   icon: <Workflow className="h-3.5 w-3.5" /> },
    { id: 'takeover',    label: 'Take Over',   icon: <Zap className="h-3.5 w-3.5" /> },
    { id: 'connections', label: 'Connections', icon: <Link2 className="h-3.5 w-3.5" /> },
  ]

  const BOTTOM_NAV: NavItem[] = [
    { id: 'meta-agent', label: 'Custom Tools', icon: <Plug className="h-3.5 w-3.5" /> },
    { id: 'settings',   label: 'Settings',     icon: <Settings className="h-3.5 w-3.5" /> },
  ]

  const renderItem = (item: NavItem): React.JSX.Element => {
    // "Landscape" is active when on dashboard; "Capture" is never shown as active (it navigates to dashboard)
    const active = item.isCapture
      ? false
      : item.label === 'Landscape'
        ? activeView === 'dashboard'
        : activeView === item.id

    return (
      <button
        key={`${item.id}-${item.label}`}
        onClick={() => onViewChange(item.id)}
        className={cn(
          'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12.5px] transition-colors',
          active
            ? 'bg-blue-500/10 text-blue-400'
            : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
        )}
      >
        <span className={cn('shrink-0', active ? 'opacity-100' : 'opacity-60')}>
          {item.icon}
        </span>
        <span className="flex-1">{item.label}</span>
        {item.badge !== undefined && item.badge > 0 && (
          <span className="min-w-[18px] rounded-full bg-blue-500 px-1 text-center font-mono text-[9px] text-white">
            {item.badge}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="flex w-[200px] shrink-0 flex-col border-r border-border bg-background py-4">
      {/* Workspace section */}
      <div className="px-3">
        <p className="mb-1.5 px-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/50">
          Workspace
        </p>
        <nav className="flex flex-col gap-0.5">
          {WORKSPACE_NAV.map(renderItem)}
        </nav>
      </div>

      <div className="mx-3 my-3 h-px bg-border/60" />

      {/* Agent section */}
      <div className="px-3">
        <p className="mb-1.5 px-2 font-mono text-[9px] uppercase tracking-widest text-muted-foreground/50">
          Agent
        </p>
        <nav className="flex flex-col gap-0.5">
          {AGENT_NAV.map(renderItem)}
        </nav>
      </div>

      {/* Bottom nav */}
      <div className="mt-auto px-3">
        <div className="mb-3 h-px bg-border/60" />
        <nav className="flex flex-col gap-0.5">
          {BOTTOM_NAV.map(renderItem)}
        </nav>
      </div>
    </div>
  )
}
