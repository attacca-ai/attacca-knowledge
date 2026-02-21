import { useUsageStore } from '@/stores/usage-store'
import { AlertTriangle } from 'lucide-react'

export function UsageLimitBanner(): React.JSX.Element | null {
  const { limitReached, byokActive, resetDate } = useUsageStore()

  if (!limitReached || byokActive) return null

  const formattedDate = resetDate
    ? new Date(resetDate).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
    : 'next month'

  return (
    <div className="flex items-center gap-3 border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-2">
      <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-400" />
      <p className="flex-1 text-sm text-yellow-800 dark:text-yellow-200">
        Your assistant has reached its monthly usage limit. Enable BYOK in Settings to continue.
        Usage resets on {formattedDate}.
      </p>
    </div>
  )
}
