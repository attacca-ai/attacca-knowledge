import { useEffect } from 'react'
import { useAppStore } from '@/stores/app-store'
import { useLicenseStore } from '@/stores/license-store'
import { useOnboardingStore } from '@/stores/onboarding-store'
import { useGateway } from '@/hooks/useGateway'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { LicenseGate } from '@/components/license/LicenseGate'
import { OnboardingWizard } from '@/components/onboarding/OnboardingWizard'
import { DashboardPlaceholder } from '@/components/dashboard/DashboardPlaceholder'

function App(): React.JSX.Element {
  const page = useAppStore((s) => s.page)
  const setPage = useAppStore((s) => s.setPage)
  const setVersion = useAppStore((s) => s.setVersion)
  const { checkExisting, status: licenseStatus } = useLicenseStore()
  const { loadState, completed: onboardingCompleted } = useOnboardingStore()

  // Initialize gateway connection
  useGateway()
  useOnlineStatus()

  // Check license and onboarding state on mount
  useEffect(() => {
    async function init(): Promise<void> {
      const version = await window.api.app.getVersion()
      setVersion(version)

      // Check existing license
      const hasLicense = await checkExisting()

      if (hasLicense) {
        // Load onboarding state
        await loadState()
        const state = useOnboardingStore.getState()
        if (state.completed) {
          setPage('dashboard')
        } else {
          setPage('onboarding')
        }
      } else {
        setPage('license')
      }
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleLicenseActivated = async (): Promise<void> => {
    await loadState()
    const state = useOnboardingStore.getState()
    if (state.completed) {
      setPage('dashboard')
    } else {
      setPage('onboarding')
    }
  }

  const handleOnboardingComplete = (): void => {
    setPage('dashboard')
  }

  // Show loading while checking license
  if (licenseStatus === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground" />
          <p className="text-sm text-muted-foreground">Checking license...</p>
        </div>
      </div>
    )
  }

  switch (page) {
    case 'license':
      return <LicenseGate onActivated={handleLicenseActivated} />
    case 'onboarding':
      return <OnboardingWizard onComplete={handleOnboardingComplete} />
    case 'dashboard':
      return <DashboardPlaceholder />
    default:
      return <LicenseGate onActivated={handleLicenseActivated} />
  }
}

export default App
