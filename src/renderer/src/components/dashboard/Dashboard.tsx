import { useEffect, useRef } from 'react'
import { useUsageStore } from '@/stores/usage-store'
import { LandscapeView } from './LandscapeView'
import { CapturePanel } from './CapturePanel'
import { UsageLimitBanner } from '@/components/shared/UsageLimitBanner'
// Gateway event listener + hydrate moved to AppShell for persistence across navigation

export function Dashboard(): React.JSX.Element {
  const fetchUsage = useUsageStore((s) => s.fetchUsage)
  const captureTextareaRef = useRef<HTMLTextAreaElement>(null)

  // Fetch usage on mount and periodically
  useEffect(() => {
    fetchUsage()
    const interval = setInterval(fetchUsage, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [fetchUsage])

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <UsageLimitBanner />

      <div className="flex flex-1 overflow-hidden">
        {/* Center: Landscape */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <LandscapeView />
        </div>

        {/* Right panel: Capture + Activity + Emergency (280px) */}
        <div className="flex w-72 flex-col overflow-hidden">
          <CapturePanel captureRef={captureTextareaRef} />
        </div>
      </div>
    </div>
  )
}
