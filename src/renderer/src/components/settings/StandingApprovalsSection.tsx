import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

interface StandingApproval {
  actionName: string
  expiresAt: number
  grantedAt: number
}

/**
 * Settings section listing persisted standing approvals (Spec B PR B4).
 * Only users on the `balanced` trust profile with medium-tier actions can
 * have persisted grants — the list is empty otherwise.
 *
 * Revocation removes the grant from both the in-memory Map and settings.json.
 */
export function StandingApprovalsSection(): React.JSX.Element {
  const [approvals, setApprovals] = useState<StandingApproval[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.permission.listStanding()
      if (result.success) {
        setApprovals(result.approvals)
      } else {
        setError(result.error ?? 'Failed to load standing approvals')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load standing approvals')
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  async function handleRevoke(actionName: string): Promise<void> {
    try {
      await window.api.permission.revokeStanding(actionName)
      setApprovals((prev) => prev.filter((a) => a.actionName !== actionName))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed')
    }
  }

  function formatDate(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    })
  }

  function humanizeActionName(actionName: string): string {
    const parts = actionName.split('_')
    const prefix = parts[0] ?? ''
    const rest = parts.slice(1).join(' ').toLowerCase()
    return `${prefix.charAt(0) + prefix.slice(1).toLowerCase()}: ${rest}`
  }

  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading…</p>
  }

  if (error) {
    return (
      <div className="text-xs text-att-red">
        {error}{' '}
        <button type="button" className="underline" onClick={() => void load()}>
          Retry
        </button>
      </div>
    )
  }

  if (approvals.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No standing approvals. When you approve a medium-risk action with &ldquo;Don&rsquo;t ask
        again&rdquo; while on the Balanced trust profile, it will appear here and persist for 30
        days.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {approvals.map((a) => (
        <div
          key={a.actionName}
          className="flex items-center justify-between rounded-md border border-att-divider px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{humanizeActionName(a.actionName)}</div>
            <div className="text-[11px] text-muted-foreground">
              Granted {formatDate(a.grantedAt)} · Expires {formatDate(a.expiresAt)}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleRevoke(a.actionName)}
            className="ml-3"
          >
            Revoke
          </Button>
        </div>
      ))}
    </div>
  )
}
