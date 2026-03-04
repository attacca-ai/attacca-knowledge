import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { LicenseGate } from '../license/LicenseGate'
import { useLicenseStore } from '../../stores/license-store'
import { installMockApi, cleanupMockApi } from '../../../../../tests/helpers'

describe('LicenseGate', () => {
  const mockOnActivated = vi.fn()

  beforeEach(() => {
    installMockApi()
    useLicenseStore.setState({
      status: 'unchecked',
      plan: null,
      error: null,
      lastValidated: null
    })
    mockOnActivated.mockClear()
  })

  afterEach(() => {
    cleanupMockApi()
  })

  it('renders input field and Activate button', () => {
    render(<LicenseGate onActivated={mockOnActivated} />)
    expect(screen.getByPlaceholderText(/XXXX/i)).toBeInTheDocument()
    expect(screen.getByText('Activate')).toBeInTheDocument()
  })

  it('button disabled when input is empty', () => {
    render(<LicenseGate onActivated={mockOnActivated} />)
    const button = screen.getByText('Activate')
    expect(button).toBeDisabled()
  })

  it('button enabled when input has text', () => {
    render(<LicenseGate onActivated={mockOnActivated} />)
    fireEvent.change(screen.getByPlaceholderText(/XXXX/i), {
      target: { value: 'test-key' }
    })
    const button = screen.getByText('Activate')
    expect(button).not.toBeDisabled()
  })

  it('calls validate on button click with trimmed key', async () => {
    window.api.license.validate = vi.fn().mockResolvedValue({ success: true })

    render(<LicenseGate onActivated={mockOnActivated} />)
    fireEvent.change(screen.getByPlaceholderText(/XXXX/i), {
      target: { value: '  my-key  ' }
    })
    fireEvent.click(screen.getByText('Activate'))

    await waitFor(() => {
      expect(window.api.license.validate).toHaveBeenCalledWith('my-key')
    })
  })

  it('calls validate on Enter key press', async () => {
    window.api.license.validate = vi.fn().mockResolvedValue({ success: true })

    render(<LicenseGate onActivated={mockOnActivated} />)
    const input = screen.getByPlaceholderText(/XXXX/i)
    fireEvent.change(input, { target: { value: 'enter-key' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => {
      expect(window.api.license.validate).toHaveBeenCalledWith('enter-key')
    })
  })

  it('shows spinner and "Verifying..." during checking', () => {
    useLicenseStore.setState({ status: 'checking' })
    render(<LicenseGate onActivated={mockOnActivated} />)

    expect(screen.getByText('Verifying...')).toBeInTheDocument()
  })

  it('shows error message on validation failure', () => {
    useLicenseStore.setState({ status: 'invalid', error: 'Key expired' })
    render(<LicenseGate onActivated={mockOnActivated} />)

    expect(screen.getByText('Key expired')).toBeInTheDocument()
  })

  it('shows expiration message when status is expired', () => {
    useLicenseStore.setState({ status: 'expired' })
    render(<LicenseGate onActivated={mockOnActivated} />)

    expect(screen.getByText(/license has expired/i)).toBeInTheDocument()
  })

  it('calls onActivated callback on success', async () => {
    window.api.license.validate = vi.fn().mockResolvedValue({
      success: true,
      plan: 'monthly'
    })

    render(<LicenseGate onActivated={mockOnActivated} />)
    fireEvent.change(screen.getByPlaceholderText(/XXXX/i), {
      target: { value: 'valid-key' }
    })
    fireEvent.click(screen.getByText('Activate'))

    await waitFor(() => {
      expect(mockOnActivated).toHaveBeenCalled()
    })
  })
})
