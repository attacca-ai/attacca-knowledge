import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useTaskStore } from '../task-store'
import { useActivityStore } from '../activity-store'
import { installMockApi, cleanupMockApi } from '../../../../../tests/helpers'

describe('task-store', () => {
  beforeEach(() => {
    installMockApi()
    useTaskStore.setState({
      currentTask: null,
      taskQueue: [],
      localTasks: [],
      taskChatMessages: {},
      isProcessing: false,
      usageLimitReached: false,
      emergencyStoppedAt: null
    })
    useActivityStore.setState({ activityFeed: [] })
  })

  afterEach(() => cleanupMockApi())

  it('addTask starts processing when nothing is in flight', () => {
    useTaskStore.getState().addTask('do X')
    const s = useTaskStore.getState()
    expect(s.currentTask?.description).toBe('do X')
    expect(s.currentTask?.status).toBe('in_progress')
    expect(s.isProcessing).toBe(true)
    expect(s.taskQueue).toHaveLength(0)
  })

  it('addTask enqueues while another task is running', () => {
    useTaskStore.getState().addTask('first')
    useTaskStore.getState().addTask('second')
    const s = useTaskStore.getState()
    expect(s.currentTask?.description).toBe('first')
    expect(s.taskQueue).toHaveLength(1)
    expect(s.taskQueue[0].description).toBe('second')
  })

  it('completeTask promotes the next queued task', () => {
    useTaskStore.getState().addTask('a')
    useTaskStore.getState().addTask('b')
    const firstId = useTaskStore.getState().currentTask!.id

    useTaskStore.getState().completeTask(firstId, 'ok')
    const s = useTaskStore.getState()
    expect(s.currentTask?.description).toBe('b')
    expect(s.taskQueue).toHaveLength(0)
  })

  it('failTask promotes the next queued task and emits fallback', () => {
    useTaskStore.getState().addTask('a')
    useTaskStore.getState().addTask('b')
    const firstId = useTaskStore.getState().currentTask!.id

    useTaskStore.getState().failTask(firstId, 'boom')
    const s = useTaskStore.getState()
    expect(s.currentTask?.description).toBe('b')
  })

  it('emergencyStop clears current + queue and records timestamp', () => {
    useTaskStore.getState().addTask('a')
    useTaskStore.getState().addTask('b')

    useTaskStore.getState().emergencyStop()
    const s = useTaskStore.getState()
    expect(s.currentTask).toBeNull()
    expect(s.taskQueue).toHaveLength(0)
    expect(s.isProcessing).toBe(false)
    expect(s.emergencyStoppedAt).not.toBeNull()
  })

  it('addLocalTask prepends and assigns pending status', () => {
    const id = useTaskStore.getState().addLocalTask({ description: 'local' })
    const s = useTaskStore.getState()
    expect(s.localTasks[0].id).toBe(id)
    expect(s.localTasks[0].status).toBe('pending')
  })

  it('addTaskChatMessage appends to the per-task thread', () => {
    useTaskStore.getState().addTaskChatMessage('t1', { role: 'user', text: 'hi', ts: 1 })
    useTaskStore.getState().addTaskChatMessage('t1', { role: 'agent', text: 'yo', ts: 2 })
    expect(useTaskStore.getState().taskChatMessages.t1).toHaveLength(2)
  })

  it('setUsageLimitReached pauses processing and logs activity', () => {
    useTaskStore.setState({ isProcessing: true })
    useTaskStore.getState().setUsageLimitReached(true)
    expect(useTaskStore.getState().isProcessing).toBe(false)
    expect(useTaskStore.getState().usageLimitReached).toBe(true)
    const feed = useActivityStore.getState().activityFeed
    expect(feed.some((e) => e.type === 'error')).toBe(true)
  })
})
