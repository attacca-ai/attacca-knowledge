import { useState } from 'react'
import { Settings } from 'lucide-react'
import { useCaptureStore } from '@/stores/capture-store'
import { useTaskStore } from '@/stores/task-store'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/i18n'

export type SidebarView =
  | 'today'
  | 'inbox'
  | 'tasks'
  | 'areas'
  | 'decisions'
  | 'reviews'
  | 'vault'
  | 'settings'

interface SidebarProps {
  activeView: SidebarView
  onViewChange: (view: SidebarView) => void
}

// ── Inline SVG icons ──────────────────────────────────────────────────────────
const IconCollapse = ({ flipped }: { flipped?: boolean }): React.JSX.Element => (
  <svg
    className={cn('h-[13px] w-[13px] shrink-0 transition-transform', flipped && 'rotate-180')}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M10 4l-4 4 4 4" />
  </svg>
)

const IconToday = (): React.JSX.Element => (
  <svg
    className="h-[14px] w-[14px] shrink-0"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </svg>
)

const IconInbox = (): React.JSX.Element => (
  <svg
    className="h-[14px] w-[14px] shrink-0"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M2 9l2-5h8l2 5v4a1 1 0 01-1 1H3a1 1 0 01-1-1V9z" />
    <path d="M2 9h4l1 2h2l1-2h4" />
  </svg>
)

const IconTasks = (): React.JSX.Element => (
  <svg
    className="h-[14px] w-[14px] shrink-0"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M3 4h10M3 8h10M3 12h7" />
    <path d="M12 11l1 1 2-2.5" />
  </svg>
)

const IconAreas = (): React.JSX.Element => (
  <svg
    className="h-[14px] w-[14px] shrink-0"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <circle cx="5" cy="5" r="3" />
    <circle cx="11" cy="11" r="3" />
    <path d="M8 8l0 0" />
  </svg>
)

const IconDecisions = (): React.JSX.Element => (
  <svg
    className="h-[14px] w-[14px] shrink-0"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M8 2v5M8 7l-4 3M8 7l4 3" />
    <circle cx="4" cy="12" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
  </svg>
)

const IconReviews = (): React.JSX.Element => (
  <svg
    className="h-[14px] w-[14px] shrink-0"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M3 3h8l2 2v8H3z" />
    <path d="M5 7h6M5 10h4" />
  </svg>
)

const IconVault = (): React.JSX.Element => (
  <svg
    className="h-[14px] w-[14px] shrink-0"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" />
    <path d="M5 5h6M5 8h4M5 11h5" />
  </svg>
)

// ── Collapsed icon button ─────────────────────────────────────────────────────
interface IconBtnProps {
  view: SidebarView
  icon: React.ReactNode
  title: string
  badge?: number
  isActive: boolean
  onViewChange: (view: SidebarView) => void
}

function IconBtn({
  view,
  icon,
  title,
  badge,
  isActive,
  onViewChange
}: IconBtnProps): React.JSX.Element {
  return (
    <button
      onClick={() => onViewChange(view)}
      title={title}
      className={cn(
        'relative mx-auto flex h-9 w-9 items-center justify-center rounded transition-colors',
        isActive
          ? 'bg-att-blue/12 text-att-blue'
          : 'text-muted-foreground/60 hover:bg-muted/20 hover:text-foreground'
      )}
    >
      {icon}
      {badge !== undefined && badge > 0 && (
        <span className="absolute right-[5px] top-[5px] flex h-[13px] min-w-[13px] items-center justify-center rounded-full bg-att-blue px-[2px] font-mono text-[7px] text-white">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  )
}

// ── Expanded nav item ─────────────────────────────────────────────────────────
interface NavItemProps {
  view: SidebarView
  label: string
  icon: React.ReactNode
  badge?: number
  isActive: boolean
  onViewChange: (view: SidebarView) => void
}

function NavItem({
  view,
  label,
  icon,
  badge,
  isActive,
  onViewChange
}: NavItemProps): React.JSX.Element {
  return (
    <button
      onClick={() => onViewChange(view)}
      className={cn(
        'flex w-full items-center gap-[9px] rounded px-2 py-[7px] text-left text-[12.5px] transition-colors',
        isActive
          ? 'bg-att-blue/12 text-att-blue'
          : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground'
      )}
    >
      <span className={cn('shrink-0', isActive ? 'opacity-100' : 'opacity-[.7]')}>{icon}</span>
      <span className="flex-1">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="min-w-[18px] rounded-[10px] bg-att-blue px-[5px] py-[1px] text-center font-mono text-[9px] text-white">
          {badge}
        </span>
      )}
    </button>
  )
}

export function Sidebar({ activeView, onViewChange }: SidebarProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const { t } = useTranslation()
  const rawCapturesCount = useCaptureStore((s) => s.rawCapturesCount)
  const isProcessing = useTaskStore((s) => s.isProcessing)

  const agentStatus = isProcessing ? 'working' : 'watching'

  // ── Collapsed: icon-only rail ─────────────────────────────────────────────
  if (collapsed) {
    return (
      <div className="flex w-11 shrink-0 flex-col border-r border-att-divider bg-background py-2">
        {/* Expand toggle */}
        <button
          onClick={() => setCollapsed(false)}
          title={t('sidebar.expand')}
          className="mx-auto mb-1 flex h-9 w-9 items-center justify-center rounded text-muted-foreground/30 transition-colors hover:bg-muted/20 hover:text-muted-foreground"
        >
          <IconCollapse flipped />
        </button>

        {/* Workspace icons */}
        <IconBtn
          view="today"
          icon={<IconToday />}
          title={t('sidebar.today')}
          isActive={activeView === 'today'}
          onViewChange={onViewChange}
        />
        <IconBtn
          view="inbox"
          icon={<IconInbox />}
          title={t('sidebar.inbox')}
          isActive={activeView === 'inbox'}
          badge={rawCapturesCount > 0 ? rawCapturesCount : undefined}
          onViewChange={onViewChange}
        />
        <IconBtn
          view="tasks"
          icon={<IconTasks />}
          title={t('sidebar.tasks')}
          isActive={activeView === 'tasks'}
          onViewChange={onViewChange}
        />
        <IconBtn
          view="areas"
          icon={<IconAreas />}
          title={t('sidebar.areas')}
          isActive={activeView === 'areas'}
          onViewChange={onViewChange}
        />
        <IconBtn
          view="decisions"
          icon={<IconDecisions />}
          title={t('sidebar.decisions')}
          isActive={activeView === 'decisions'}
          onViewChange={onViewChange}
        />
        <IconBtn
          view="reviews"
          icon={<IconReviews />}
          title={t('sidebar.reviews')}
          isActive={activeView === 'reviews'}
          onViewChange={onViewChange}
        />
        <IconBtn
          view="vault"
          icon={<IconVault />}
          title={t('sidebar.vault')}
          isActive={activeView === 'vault'}
          onViewChange={onViewChange}
        />

        {/* Bottom */}
        <div className="mt-auto">
          <div className="mx-auto mb-1 h-px w-6 bg-att-divider" />
          <IconBtn
            view="settings"
            icon={<Settings className="h-[14px] w-[14px]" />}
            title={t('sidebar.settings')}
            isActive={activeView === 'settings'}
            onViewChange={onViewChange}
          />
          {/* Status dot */}
          <div
            className="mx-auto mt-1 flex h-8 w-8 items-center justify-center"
            title={t('sidebar.agent_status', { status: t(`sidebar.status.${agentStatus}`) })}
          >
            <div
              className={cn(
                'h-[7px] w-[7px] rounded-full',
                agentStatus === 'working'
                  ? 'animate-pulse bg-att-blue'
                  : 'animate-pulse bg-att-green shadow-[0_0_5px_var(--att-green)]'
              )}
            />
          </div>
        </div>
      </div>
    )
  }

  // ── Expanded: full sidebar with labels ────────────────────────────────────
  return (
    <div className="flex w-[220px] shrink-0 flex-col border-r border-att-divider bg-background py-4">
      {/* ── Collapse toggle ── */}
      <div className="mb-2 flex items-center justify-between px-3 pb-1">
        <p className="mb-1 px-2 font-mono text-[9px] uppercase tracking-[.12em] text-muted-foreground/50">
          {t('sidebar.workspace')}
        </p>
        <button
          onClick={() => setCollapsed(true)}
          title={t('sidebar.collapse')}
          className="rounded p-1 text-muted-foreground/30 transition-colors hover:bg-muted/20 hover:text-muted-foreground"
        >
          <IconCollapse />
        </button>
      </div>

      {/* ── WORKSPACE ── */}
      <div className="mb-2 px-3">
        <nav className="flex flex-col gap-0.5">
          <NavItem
            view="today"
            label={t('sidebar.today')}
            icon={<IconToday />}
            isActive={activeView === 'today'}
            onViewChange={onViewChange}
          />
          <NavItem
            view="inbox"
            label={t('sidebar.inbox')}
            icon={<IconInbox />}
            isActive={activeView === 'inbox'}
            badge={rawCapturesCount > 0 ? rawCapturesCount : undefined}
            onViewChange={onViewChange}
          />
          <NavItem
            view="tasks"
            label={t('sidebar.tasks')}
            icon={<IconTasks />}
            isActive={activeView === 'tasks'}
            onViewChange={onViewChange}
          />
          <NavItem
            view="areas"
            label={t('sidebar.areas')}
            icon={<IconAreas />}
            isActive={activeView === 'areas'}
            onViewChange={onViewChange}
          />
          <NavItem
            view="decisions"
            label={t('sidebar.decisions')}
            icon={<IconDecisions />}
            isActive={activeView === 'decisions'}
            onViewChange={onViewChange}
          />
          <NavItem
            view="reviews"
            label={t('sidebar.reviews')}
            icon={<IconReviews />}
            isActive={activeView === 'reviews'}
            onViewChange={onViewChange}
          />
          <NavItem
            view="vault"
            label={t('sidebar.vault')}
            icon={<IconVault />}
            isActive={activeView === 'vault'}
            onViewChange={onViewChange}
          />
        </nav>
      </div>

      {/* ── BOTTOM ── */}
      <div className="mt-auto px-3">
        <div className="mb-[10px] h-px bg-att-divider" />

        <NavItem
          view="settings"
          label={t('sidebar.settings')}
          icon={<Settings className="h-[14px] w-[14px]" />}
          isActive={activeView === 'settings'}
          onViewChange={onViewChange}
        />

        {/* Agent status widget */}
        <div className="mt-2 flex items-center gap-2 rounded-[6px] border border-att-divider bg-att-surface px-2 py-[10px]">
          <div
            className={cn(
              'h-[7px] w-[7px] shrink-0 rounded-full',
              agentStatus === 'working'
                ? 'animate-pulse bg-att-blue'
                : 'animate-pulse bg-att-green shadow-[0_0_6px_var(--att-green)]'
            )}
          />
          <span className="text-[11px] text-muted-foreground">
            <strong className="font-medium text-foreground">{t('sidebar.agent')}</strong>
            {' · '}
            {t(`sidebar.status.${agentStatus}`)}
          </span>
        </div>
      </div>
    </div>
  )
}
