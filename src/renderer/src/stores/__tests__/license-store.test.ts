import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useLicenseStore } from '../license-store'
import { installMockApi, cleanupMockApi } from '../../../../../tests/helpers'

describe('license-store', () => {
  beforeEach(() => {
    installMockApi()
    useLicenseStore.setState({
      status: 'unchecked',
      plan: null,
      error: null,
      lastValidated: null
    })
  })

  afterEach(() => {
    cleanupMockApi()
  })

  it('has correct initial state', () => {
    const state = useLicenseStore.getState()
    expect(state.status).toBe('unchecked')
    expect(state.plan).toBeNull()
    expect(state.error).toBeNull()
    expect(state.lastValidated).toBeNull()
  })

  describe('validate', () => {
    it('sets status to checking during validation', async () => {
      let resolveValidation!: (value: unknown) => void
      window.api.license.validate = vi.fn(
        () => new Promise((resolve) => { resolveValidation = resolve })
      )

      const promise = useLicenseStore.getState().validate('test-key')
      expect(useLicenseStore.getState().status).toBe('checking')
      expect(useLicenseStore.getState().error).toBeNull()

      resolveValidation({ success: true, plan: 'yearly' })
      await promise
    })

    it('sets status to valid on success', async () => {
      window.api.license.validate = vi.fn().mockResolvedValue({
        success: true,
        plan: 'yearly'
      })

      const result = await useLicenseStore.getState().validate('valid-key')
      const state = useLicenseStore.getState()

      expect(result).toBe(true)
      expect(state.status).toBe('valid')
      expect(state.plan).toBe('yearly')
      expect(state.error).toBeNull()
      expect(state.lastValidated).toBeGreaterThan(0)
    })

    it('sets status to invalid on failure', async () => {
      window.api.license.validate = vi.fn().mockResolvedValue({
        success: false,
        error: 'Key not found'
      })

      const result = await useLicenseStore.getState().validate('bad-key')
      const state = useLicenseStore.getState()

      expect(result).toBe(false)
      expect(state.status).toBe('invalid')
      expect(state.error).toBe('Key not found')
    })

    it('uses default error message when none provided', async () => {
      window.api.license.validate = vi.fn().mockResolvedValue({
        success: false
      })

      await useLicenseStore.getState().validate('bad-key')
      expect(useLicenseStore.getState().error).toBe('Invalid license key')
    })

    it('handles IPC error', async () => {
      window.api.license.validate = vi.fn().mockRejectedValue(
        new Error('Network error')
      )

      const result = await useLicenseStore.getState().validate('key')
      const state = useLicenseStore.getState()

      expect(result).toBe(false)
      expect(state.status).toBe('invalid')
      expect(state.error).toBe('Network error')
    })

    it('handles non-Error rejection', async () => {
      window.api.license.validate = vi.fn().mockRejectedValue('string error')

      const result = await useLicenseStore.getState().validate('key')
      expect(result).toBe(false)
      expect(useLicenseStore.getState().error).toBe('Failed to validate license')
    })

    it('clears previous error on new validation', async () => {
      useLicenseStore.setState({ error: 'Old error' })
      window.api.license.validate = vi.fn().mockResolvedValue({
        success: true,
        plan: 'monthly'
      })

      await useLicenseStore.getState().validate('key')
      expect(useLicenseStore.getState().error).toBeNull()
    })

    it('plan defaults to null when not provided on success', async () => {
      window.api.license.validate = vi.fn().mockResolvedValue({
        success: true
      })

      await useLicenseStore.getState().validate('key')
      expect(useLicenseStore.getState().plan).toBeNull()
    })
  })

  describe('checkExisting', () => {
    it('returns true and sets valid when existing license found', async () => {
      window.api.license.checkExisting = vi.fn().mockResolvedValue({
        exists: true,
        valid: true,
        plan: 'lifetime'
      })

      const result = await useLicenseStore.getState().checkExisting()
      const state = useLicenseStore.getState()

      expect(result).toBe(true)
      expect(state.status).toBe('valid')
      expect(state.plan).toBe('lifetime')
    })

    it('returns false and sets unchecked when not found', async () => {
      window.api.license.checkExisting = vi.fn().mockResolvedValue({
        exists: false,
        valid: false
      })

      const result = await useLicenseStore.getState().checkExisting()
      expect(result).toBe(false)
      expect(useLicenseStore.getState().status).toBe('unchecked')
    })

    it('returns false when exists but not valid', async () => {
      window.api.license.checkExisting = vi.fn().mockResolvedValue({
        exists: true,
        valid: false
      })

      const result = await useLicenseStore.getState().checkExisting()
      expect(result).toBe(false)
      expect(useLicenseStore.getState().status).toBe('unchecked')
    })

    it('sets status to checking during check', async () => {
      let resolveCheck!: (value: unknown) => void
      window.api.license.checkExisting = vi.fn(
        () => new Promise((resolve) => { resolveCheck = resolve })
      )

      const promise = useLicenseStore.getState().checkExisting()
      expect(useLicenseStore.getState().status).toBe('checking')

      resolveCheck({ exists: false, valid: false })
      await promise
    })

    it('handles IPC error gracefully', async () => {
      window.api.license.checkExisting = vi.fn().mockRejectedValue(
        new Error('IPC failed')
      )

      const result = await useLicenseStore.getState().checkExisting()
      expect(result).toBe(false)
      expect(useLicenseStore.getState().status).toBe('unchecked')
    })

    it('plan defaults to null when not provided', async () => {
      window.api.license.checkExisting = vi.fn().mockResolvedValue({
        exists: true,
        valid: true
      })

      await useLicenseStore.getState().checkExisting()
      expect(useLicenseStore.getState().plan).toBeNull()
    })
  })

  describe('status transitions', () => {
    it('unchecked → checking → valid', async () => {
      expect(useLicenseStore.getState().status).toBe('unchecked')

      window.api.license.validate = vi.fn().mockResolvedValue({ success: true })
      await useLicenseStore.getState().validate('key')

      expect(useLicenseStore.getState().status).toBe('valid')
    })

    it('unchecked → checking → invalid', async () => {
      window.api.license.validate = vi.fn().mockResolvedValue({
        success: false,
        error: 'Invalid'
      })
      await useLicenseStore.getState().validate('key')

      expect(useLicenseStore.getState().status).toBe('invalid')
    })
  })
})
