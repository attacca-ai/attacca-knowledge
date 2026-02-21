import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App from '../../App'
import { useAppStore } from '../../stores/app-store'
import { useLicenseStore } from '../../stores/license-store'
import { useOnboardingStore } from '../../stores/onboarding-store'
import { installMockApi, cleanupMockApi } from '../../../../../tests/helpers'

// Mock hooks
vi.mock('@/hooks/useGateway', () => ({
  useGateway: vi.fn()
}))
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: vi.fn().mockReturnValue(true)
}))

// Mock child page components to isolate App tests
vi.mock('@/components/license/LicenseGate', () => ({
  LicenseGate: ({ onActivated }: { onActivated: () => void }) => (
    <div data-testid="license-gate">
      <button onClick={onActivated}>Activate</button>
    </div>
  )
}))
vi.mock('@/components/onboarding/OnboardingWizard', () => ({
  OnboardingWizard: ({ onComplete }: { onComplete: () => void }) => (
    <div data-testid="onboarding-wizard">
      <button onClick={onComplete}>Complete</button>
    </div>
  )
}))
vi.mock('@/components/layout/AppShell', () => ({
  AppShell: () => <div data-testid="app-shell">AppShell</div>
}))

describe('App', () => {
  beforeEach(() => {
    installMockApi()
    useAppStore.setState({
      page: 'license',
      version: null,
      isOnline: true
    })
    useLicenseStore.setState({
      status: 'unchecked',
      plan: null,
      error: null,
      lastValidated: null
    })
    useOnboardingStore.setState({
      currentStep: 0,
      connectedTools: [],
      selectedUseCases: [],
      telemetryOptIn: false,
      completed: false
    })
  })

  afterEach(() => {
    cleanupMockApi()
  })

  it('shows spinner while license status is checking', () => {
    useLicenseStore.setState({ status: 'checking' })
    render(<App />)

    expect(screen.getByText('Checking license...')).toBeInTheDocument()
  })

  it('shows LicenseGate when page is license', () => {
    useAppStore.setState({ page: 'license' })
    useLicenseStore.setState({ status: 'unchecked' })
    render(<App />)

    expect(screen.getByTestId('license-gate')).toBeInTheDocument()
  })

  it('shows OnboardingWizard when page is onboarding', () => {
    useAppStore.setState({ page: 'onboarding' })
    useLicenseStore.setState({ status: 'valid' })
    render(<App />)

    expect(screen.getByTestId('onboarding-wizard')).toBeInTheDocument()
  })

  it('shows AppShell when page is dashboard', () => {
    useAppStore.setState({ page: 'dashboard' })
    useLicenseStore.setState({ status: 'valid' })
    render(<App />)

    expect(screen.getByTestId('app-shell')).toBeInTheDocument()
  })

  it('fetches and sets app version on mount', async () => {
    window.api.app.getVersion = vi.fn().mockResolvedValue('2.0.0')
    window.api.license.checkExisting = vi.fn().mockResolvedValue({ exists: false, valid: false })

    render(<App />)

    await waitFor(() => {
      expect(window.api.app.getVersion).toHaveBeenCalled()
      expect(useAppStore.getState().version).toBe('2.0.0')
    })
  })

  it('navigates to dashboard when license exists and onboarding complete', async () => {
    window.api.license.checkExisting = vi.fn().mockResolvedValue({
      exists: true,
      valid: true,
      plan: 'monthly'
    })
    window.api.onboarding.getState = vi.fn().mockResolvedValue({
      currentStep: 4,
      completed: true,
      connectedTools: [],
      selectedUseCases: [],
      telemetryOptIn: false
    })

    render(<App />)

    await waitFor(() => {
      expect(useAppStore.getState().page).toBe('dashboard')
    })
  })

  it('navigates to onboarding when license valid but onboarding not complete', async () => {
    window.api.license.checkExisting = vi.fn().mockResolvedValue({
      exists: true,
      valid: true,
      plan: 'monthly'
    })
    window.api.onboarding.getState = vi.fn().mockResolvedValue({
      currentStep: 1,
      completed: false,
      connectedTools: [],
      selectedUseCases: [],
      telemetryOptIn: false
    })

    render(<App />)

    await waitFor(() => {
      expect(useAppStore.getState().page).toBe('onboarding')
    })
  })

  it('stays on license page when no existing license', async () => {
    window.api.license.checkExisting = vi.fn().mockResolvedValue({
      exists: false,
      valid: false
    })

    render(<App />)

    await waitFor(() => {
      expect(useAppStore.getState().page).toBe('license')
    })
  })
})
