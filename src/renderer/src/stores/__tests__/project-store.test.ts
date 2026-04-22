import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { useProjectStore } from '../project-store'
import { useTaskStore } from '../task-store'
import { installMockApi, cleanupMockApi } from '../../../../../tests/helpers'

describe('project-store', () => {
  beforeEach(() => {
    installMockApi()
    useProjectStore.setState({ projects: [] })
    useTaskStore.setState({
      currentTask: null,
      taskQueue: [],
      localTasks: [],
      taskChatMessages: {},
      isProcessing: false,
      usageLimitReached: false,
      emergencyStoppedAt: null
    })
  })

  afterEach(() => cleanupMockApi())

  it('addProject prepends active project with empty task + file arrays', () => {
    const id = useProjectStore.getState().addProject({ name: 'p', description: 'd' })
    const p = useProjectStore.getState().projects[0]
    expect(p.id).toBe(id)
    expect(p.status).toBe('active')
    expect(p.taskIds).toEqual([])
    expect(p.contextFiles).toEqual([])
  })

  it('updateProject merges fields', () => {
    const id = useProjectStore.getState().addProject({ name: 'p', description: 'd' })
    useProjectStore.getState().updateProject(id, { description: 'new' })
    expect(useProjectStore.getState().projects[0].description).toBe('new')
  })

  it('addTaskToProject updates both stores', () => {
    const pid = useProjectStore.getState().addProject({ name: 'p', description: 'd' })
    const tid = useTaskStore.getState().addLocalTask({ description: 't' })

    useProjectStore.getState().addTaskToProject(pid, tid)

    expect(useProjectStore.getState().projects[0].taskIds).toContain(tid)
    expect(useTaskStore.getState().localTasks[0].projectId).toBe(pid)
  })

  it('addProjectFile appends to the contextFiles array', () => {
    const pid = useProjectStore.getState().addProject({ name: 'p', description: 'd' })
    useProjectStore.getState().addProjectFile(pid, {
      id: 'f1',
      fileName: 'a.md',
      filePath: '/tmp/a.md',
      uploadedAt: 0,
      sizeBytes: 10
    })
    expect(useProjectStore.getState().projects[0].contextFiles).toHaveLength(1)
  })
})
