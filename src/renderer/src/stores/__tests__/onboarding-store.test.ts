import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useOnboardingStore } from '../onboarding-store'
import { installMockApi, cleanupMockApi } from '../../../../../tests/helpers'

describe('onboarding-store', () => {
  beforeEach(() => {
    installMockApi()
    useOnboardingStore.setState({
      currentStep: 0,
      vaultMode: null,
      telemetryOptIn: false,
      completed: false
    })
  })

  afterEach(() => {
    cleanupMockApi()
  })

  it('has correct initial state', () => {
    const state = useOnboardingStore.getState()
    expect(state.currentStep).toBe(0)
    expect(state.vaultMode).toBeNull()
    expect(state.telemetryOptIn).toBe(false)
    expect(state.completed).toBe(false)
  })

  describe('step navigation', () => {
    it('nextStep increments from 0 to 1', () => {
      useOnboardingStore.getState().nextStep()
      expect(useOnboardingStore.getState().currentStep).toBe(1)
    })

    it('nextStep stops at max step (4)', () => {
      useOnboardingStore.setState({ currentStep: 4 })
      useOnboardingStore.getState().nextStep()
      expect(useOnboardingStore.getState().currentStep).toBe(4)
    })

    it('prevStep decrements from 2 to 1', () => {
      useOnboardingStore.setState({ currentStep: 2 })
      useOnboardingStore.getState().prevStep()
      expect(useOnboardingStore.getState().currentStep).toBe(1)
    })

    it('prevStep stops at 0', () => {
      useOnboardingStore.getState().prevStep()
      expect(useOnboardingStore.getState().currentStep).toBe(0)
    })

    it('setStep sets to specific step', () => {
      useOnboardingStore.getState().setStep(3)
      expect(useOnboardingStore.getState().currentStep).toBe(3)
    })

    it('setStep clamps to max (4)', () => {
      useOnboardingStore.getState().setStep(10)
      expect(useOnboardingStore.getState().currentStep).toBe(4)
    })

    it('setStep clamps to min (0)', () => {
      useOnboardingStore.getState().setStep(-5)
      expect(useOnboardingStore.getState().currentStep).toBe(0)
    })

    it('nextStep persists state', () => {
      useOnboardingStore.getState().nextStep()
      expect(window.api.onboarding.saveState).toHaveBeenCalled()
    })

    it('prevStep persists state', () => {
      useOnboardingStore.setState({ currentStep: 2 })
      useOnboardingStore.getState().prevStep()
      expect(window.api.onboarding.saveState).toHaveBeenCalled()
    })

    it('setStep persists state', () => {
      useOnboardingStore.getState().setStep(2)
      expect(window.api.onboarding.saveState).toHaveBeenCalled()
    })
  })

  describe('setVaultMode', () => {
    it('sets managed vault mode', () => {
      useOnboardingStore
        .getState()
        .setVaultMode({ kind: 'managed', path: '/userData/attacca-vault' })
      expect(useOnboardingStore.getState().vaultMode).toEqual({
        kind: 'managed',
        path: '/userData/attacca-vault'
      })
    })

    it('sets external vault mode', () => {
      useOnboardingStore
        .getState()
        .setVaultMode({ kind: 'external', path: '/home/user/obsidian' })
      expect(useOnboardingStore.getState().vaultMode).toEqual({
        kind: 'external',
        path: '/home/user/obsidian'
      })
    })

    it('persists state', () => {
      useOnboardingStore.getState().setVaultMode({ kind: 'managed', path: '/p' })
      expect(window.api.onboarding.saveState).toHaveBeenCalled()
    })
  })

  describe('setTelemetryOptIn', () => {
    it('sets opt-in to true', () => {
      useOnboardingStore.getState().setTelemetryOptIn(true)
      expect(useOnboardingStore.getState().telemetryOptIn).toBe(true)
    })

    it('sets opt-in back to false', () => {
      useOnboardingStore.getState().setTelemetryOptIn(true)
      useOnboardingStore.getState().setTelemetryOptIn(false)
      expect(useOnboardingStore.getState().telemetryOptIn).toBe(false)
    })

    it('persists state', () => {
      useOnboardingStore.getState().setTelemetryOptIn(true)
      expect(window.api.onboarding.saveState).toHaveBeenCalled()
    })
  })

  describe('complete', () => {
    it('sets completed to true and calls IPC', async () => {
      await useOnboardingStore.getState().complete()
      expect(useOnboardingStore.getState().completed).toBe(true)
      expect(window.api.telemetry.setOptIn).toHaveBeenCalledWith(false)
      expect(window.api.onboarding.complete).toHaveBeenCalled()
    })

    it('passes telemetryOptIn value to telemetry.setOptIn', async () => {
      useOnboardingStore.getState().setTelemetryOptIn(true)
      await useOnboardingStore.getState().complete()
      expect(window.api.telemetry.setOptIn).toHaveBeenCalledWith(true)
    })

    it('persists vaultMode via settings.set when present', async () => {
      useOnboardingStore
        .getState()
        .setVaultMode({ kind: 'external', path: '/home/user/obsidian' })
      await useOnboardingStore.getState().complete()
      expect(window.api.settings.set).toHaveBeenCalledWith('vaultMode', {
        kind: 'external',
        path: '/home/user/obsidian'
      })
    })

    it('skips settings.set when vaultMode is null', async () => {
      await useOnboardingStore.getState().complete()
      expect(window.api.settings.set).not.toHaveBeenCalledWith(
        'vaultMode',
        expect.anything()
      )
    })
  })

  describe('loadState', () => {
    it('loads state from IPC', async () => {
      window.api.onboarding.getState = vi.fn().mockResolvedValue({
        currentStep: 3,
        vaultMode: { kind: 'managed', path: '/p' },
        telemetryOptIn: true,
        completed: false
      })

      await useOnboardingStore.getState().loadState()
      const state = useOnboardingStore.getState()

      expect(state.currentStep).toBe(3)
      expect(state.vaultMode).toEqual({ kind: 'managed', path: '/p' })
      expect(state.telemetryOptIn).toBe(true)
    })

    it('does nothing when IPC returns null', async () => {
      window.api.onboarding.getState = vi.fn().mockResolvedValue(null)
      await useOnboardingStore.getState().loadState()
      expect(useOnboardingStore.getState().currentStep).toBe(0)
    })

    it('uses defaults for missing fields', async () => {
      window.api.onboarding.getState = vi.fn().mockResolvedValue({})
      await useOnboardingStore.getState().loadState()

      const state = useOnboardingStore.getState()
      expect(state.currentStep).toBe(0)
      expect(state.telemetryOptIn).toBe(false)
      expect(state.vaultMode).toBeNull()
    })
  })

  describe('persist', () => {
    it('saves current state via IPC', async () => {
      useOnboardingStore.setState({
        currentStep: 2,
        vaultMode: { kind: 'managed', path: '/p' },
        telemetryOptIn: true,
        completed: false
      })

      await useOnboardingStore.getState().persist()
      expect(window.api.onboarding.saveState).toHaveBeenCalledWith({
        currentStep: 2,
        vaultMode: { kind: 'managed', path: '/p' },
        telemetryOptIn: true,
        completed: false
      })
    })
  })

  describe('full flow', () => {
    it('step 0 → 4 → complete', async () => {
      const store = useOnboardingStore.getState()
      expect(store.currentStep).toBe(0)

      useOnboardingStore.getState().nextStep() // 1
      useOnboardingStore.getState().nextStep() // 2
      useOnboardingStore.getState().setVaultMode({ kind: 'managed', path: '/p' })
      useOnboardingStore.getState().nextStep() // 3
      useOnboardingStore.getState().setTelemetryOptIn(true)
      useOnboardingStore.getState().nextStep() // 4

      expect(useOnboardingStore.getState().currentStep).toBe(4)

      await useOnboardingStore.getState().complete()
      expect(useOnboardingStore.getState().completed).toBe(true)
    })
  })
})
