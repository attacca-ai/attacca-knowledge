import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { EmergencyStop } from '../dashboard/EmergencyStop'
import { useAgentStore } from '../../stores/agent-store'
import { installMockApi, cleanupMockApi } from '../../../../../tests/helpers'

describe('EmergencyStop', () => {
  beforeEach(() => {
    installMockApi()
    vi.useFakeTimers()
    useAgentStore.setState({
      currentTask: null,
      taskQueue: [],
      activityFeed: [],
      isProcessing: false,
      usageLimitReached: false,
      morningBriefing: null,
      briefingDate: null
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanupMockApi()
  })

  it('shows "Emergency Stop" text initially', () => {
    render(<EmergencyStop />)
    expect(screen.getByText('Emergency Stop')).toBeInTheDocument()
  })

  it('first click shows CONFIRM text', () => {
    render(<EmergencyStop />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText(/CONFIRM/i)).toBeInTheDocument()
  })

  it('second click executes emergencyStop and calls agent.stop', async () => {
    render(<EmergencyStop />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))

    expect(useAgentStore.getState().currentTask).toBeNull()
    expect(useAgentStore.getState().isProcessing).toBe(false)
    expect(window.api.agent.stop).toHaveBeenCalledWith('main')
  })

  it('auto-resets confirmation after 3 seconds', () => {
    render(<EmergencyStop />)
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText(/CONFIRM/i)).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(3001)
    })

    expect(screen.getByText('Emergency Stop')).toBeInTheDocument()
  })

  it('calls agent.stop on second click', () => {
    render(<EmergencyStop />)

    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))

    expect(window.api.agent.stop).toHaveBeenCalledWith('main')
  })

  it('resets confirming state after executing stop', () => {
    render(<EmergencyStop />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Emergency Stop')).toBeInTheDocument()
  })
})
