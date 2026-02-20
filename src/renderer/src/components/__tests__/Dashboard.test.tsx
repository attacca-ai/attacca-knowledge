import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Dashboard } from '../dashboard/Dashboard'
import { useGatewayStore } from '../../stores/gateway-store'
import { useAgentStore } from '../../stores/agent-store'

// Mock child components to isolate Dashboard tests
vi.mock('../dashboard/MorningBriefing', () => ({
  MorningBriefing: () => <div data-testid="morning-briefing">MorningBriefing</div>
}))
vi.mock('../dashboard/NotificationBox', () => ({
  NotificationBox: () => <div data-testid="notification-box">NotificationBox</div>
}))
vi.mock('../dashboard/ActivityFeed', () => ({
  ActivityFeed: () => <div data-testid="activity-feed">ActivityFeed</div>
}))
vi.mock('../dashboard/TaskQueue', () => ({
  TaskQueue: () => <div data-testid="task-queue">TaskQueue</div>
}))
vi.mock('../dashboard/EmergencyStop', () => ({
  EmergencyStop: () => <div data-testid="emergency-stop">EmergencyStop</div>
}))
vi.mock('@/components/permissions/ApprovalDialog', () => ({
  ApprovalDialog: () => <div data-testid="approval-dialog">ApprovalDialog</div>
}))

// Mock gateway client
const mockOn = vi.fn()
const mockOff = vi.fn()

vi.mock('@/lib/gateway-client', () => ({
  gatewayClient: {
    on: (...args: unknown[]) => mockOn(...args),
    off: (...args: unknown[]) => mockOff(...args)
  }
}))

describe('Dashboard', () => {
  beforeEach(() => {
    useGatewayStore.setState({
      connectionState: 'disconnected',
      processState: null,
      health: null
    })
    useAgentStore.setState({
      currentTask: null,
      taskQueue: [],
      activityFeed: [],
      isProcessing: false,
      morningBriefing: null,
      briefingDate: null
    })
    mockOn.mockClear()
    mockOff.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders all 4 quadrant children', () => {
    render(<Dashboard />)
    expect(screen.getByTestId('morning-briefing')).toBeInTheDocument()
    expect(screen.getByTestId('notification-box')).toBeInTheDocument()
    expect(screen.getByTestId('activity-feed')).toBeInTheDocument()
    expect(screen.getByTestId('task-queue')).toBeInTheDocument()
  })

  it('renders EmergencyStop', () => {
    render(<Dashboard />)
    expect(screen.getByTestId('emergency-stop')).toBeInTheDocument()
  })

  it('renders ApprovalDialog', () => {
    render(<Dashboard />)
    expect(screen.getByTestId('approval-dialog')).toBeInTheDocument()
  })

  it('subscribes to gateway wildcard events when connected', () => {
    useGatewayStore.setState({ connectionState: 'connected' })
    render(<Dashboard />)

    expect(mockOn).toHaveBeenCalledWith('*', expect.any(Function))
  })

  it('does not subscribe when disconnected', () => {
    useGatewayStore.setState({ connectionState: 'disconnected' })
    render(<Dashboard />)

    expect(mockOn).not.toHaveBeenCalled()
  })

  it('unsubscribes on unmount', () => {
    useGatewayStore.setState({ connectionState: 'connected' })
    const { unmount } = render(<Dashboard />)

    unmount()
    expect(mockOff).toHaveBeenCalledWith('*', expect.any(Function))
  })

  it('maps agent.turn.start to info activity', () => {
    useGatewayStore.setState({ connectionState: 'connected' })
    render(<Dashboard />)

    const handler = mockOn.mock.calls.find((c: unknown[]) => c[0] === '*')![1] as (event: Record<string, unknown>) => void
    handler({
      jsonrpc: '2.0',
      method: 'agent.turn.start',
      params: {}
    })

    const activity = useAgentStore.getState().activityFeed
    expect(activity.some((a) => a.type === 'info' && a.description.includes('started processing'))).toBe(true)
  })

  it('maps agent.tool.call to tool_call activity', () => {
    useGatewayStore.setState({ connectionState: 'connected' })
    render(<Dashboard />)

    const handler = mockOn.mock.calls.find((c: unknown[]) => c[0] === '*')![1] as (event: Record<string, unknown>) => void
    handler({
      jsonrpc: '2.0',
      method: 'agent.tool.call',
      params: { tool: 'read_file', params: { path: '/tmp/x' } }
    })

    const activity = useAgentStore.getState().activityFeed
    expect(activity.some((a) => a.type === 'tool_call' && a.description.includes('read_file'))).toBe(true)
  })

  it('maps agent.tool.result to tool_result activity', () => {
    useGatewayStore.setState({ connectionState: 'connected' })
    render(<Dashboard />)

    const handler = mockOn.mock.calls.find((c: unknown[]) => c[0] === '*')![1] as (event: Record<string, unknown>) => void
    handler({
      jsonrpc: '2.0',
      method: 'agent.tool.result',
      params: { result: 'file contents' }
    })

    const activity = useAgentStore.getState().activityFeed
    expect(activity.some((a) => a.type === 'tool_result')).toBe(true)
  })

  it('maps agent.message to message activity', () => {
    useGatewayStore.setState({ connectionState: 'connected' })
    render(<Dashboard />)

    const handler = mockOn.mock.calls.find((c: unknown[]) => c[0] === '*')![1] as (event: Record<string, unknown>) => void
    handler({
      jsonrpc: '2.0',
      method: 'agent.message',
      params: { content: 'Hello from agent' }
    })

    const activity = useAgentStore.getState().activityFeed
    expect(activity.some((a) => a.type === 'message' && a.description === 'Hello from agent')).toBe(true)
  })

  it('maps agent.error to error activity', () => {
    useGatewayStore.setState({ connectionState: 'connected' })
    render(<Dashboard />)

    const handler = mockOn.mock.calls.find((c: unknown[]) => c[0] === '*')![1] as (event: Record<string, unknown>) => void
    handler({
      jsonrpc: '2.0',
      method: 'agent.error',
      params: { message: 'Something failed' }
    })

    const activity = useAgentStore.getState().activityFeed
    expect(activity.some((a) => a.type === 'error' && a.description === 'Something failed')).toBe(true)
  })
})
