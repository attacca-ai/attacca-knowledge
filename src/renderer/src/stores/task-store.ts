import { create } from 'zustand'
import { useActivityStore } from './activity-store'
import {
  registerSlice,
  schedulePersist,
  loadSnapshot
} from '@/lib/agent-state-persist'

export interface AgentTask {
  id: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  createdAt: number
  startedAt?: number
  completedAt?: number
  result?: string
  error?: string
  projectId?: string
  sourceType?: 'capture' | 'theme' | 'thread' | 'manual' | 'clickup'
  sourceId?: string
}

export interface TaskChatMessage {
  role: 'user' | 'agent'
  text: string
  ts: number
}

interface TaskStore {
  currentTask: AgentTask | null
  taskQueue: AgentTask[]
  localTasks: AgentTask[]
  taskChatMessages: Record<string, TaskChatMessage[]>
  isProcessing: boolean
  usageLimitReached: boolean
  emergencyStoppedAt: number | null
  hydrate: () => Promise<void>
  addTask: (description: string) => void
  completeTask: (taskId: string, result?: string) => void
  failTask: (taskId: string, error: string) => void
  setUsageLimitReached: (reached: boolean) => void
  emergencyStop: () => void
  addLocalTask: (task: Omit<AgentTask, 'id' | 'createdAt' | 'status'>) => string
  updateLocalTask: (id: string, update: Partial<AgentTask>) => void
  addTaskChatMessage: (taskId: string, message: TaskChatMessage) => void
}

let taskIdCounter = 0

export const useTaskStore = create<TaskStore>((set, get) => ({
  currentTask: null,
  taskQueue: [],
  localTasks: [],
  taskChatMessages: {},
  isProcessing: false,
  usageLimitReached: false,
  emergencyStoppedAt: null,

  hydrate: async () => {
    const snap = await loadSnapshot()
    if (!snap) return
    set({
      taskQueue: (snap.taskQueue as AgentTask[] | undefined) ?? [],
      localTasks: (snap.localTasks as AgentTask[] | undefined) ?? [],
      taskChatMessages:
        (snap.taskChatMessages as Record<string, TaskChatMessage[]> | undefined) ?? {}
    })
  },

  setUsageLimitReached: (reached) => {
    set({ usageLimitReached: reached })
    if (reached) {
      useActivityStore.getState().addActivity({
        type: 'error',
        description:
          'Usage limit reached — agent paused. Enable BYOK in Settings to continue.'
      })
      set({ isProcessing: false })
    }
  },

  addTask: (description) => {
    const { usageLimitReached, emergencyStoppedAt } = get()
    if (usageLimitReached) {
      useActivityStore.getState().addActivity({
        type: 'error',
        description: `Cannot start task: usage limit reached`
      })
      return
    }

    if (emergencyStoppedAt !== null) {
      window.api.telemetry.emit('trust.kill_switch.resumed', {
        timeSinceActivationMs: Date.now() - emergencyStoppedAt
      })
      set({ emergencyStoppedAt: null })
    }

    const task: AgentTask = {
      id: `task_${++taskIdCounter}`,
      description,
      status: 'pending',
      createdAt: Date.now()
    }

    const { currentTask } = get()
    if (!currentTask) {
      set({
        currentTask: { ...task, status: 'in_progress', startedAt: Date.now() },
        isProcessing: true
      })
    } else {
      set({ taskQueue: [...get().taskQueue, task] })
    }

    useActivityStore
      .getState()
      .addActivity({ type: 'info', description: `Task added: ${description}` })
    schedulePersist()
  },

  completeTask: (taskId, result) => {
    const { currentTask, taskQueue } = get()
    if (currentTask?.id !== taskId) return

    const completed = {
      ...currentTask,
      status: 'completed' as const,
      completedAt: Date.now(),
      result
    }
    const durationMs = completed.startedAt ? Date.now() - completed.startedAt : 0

    useActivityStore.getState().addActivity({
      type: 'info',
      description: `Task completed: ${completed.description}`,
      details: result
    })

    window.api.telemetry.emit('agent.task.completed', {
      durationMs,
      hadFallback: false
    })

    if (taskQueue.length > 0) {
      const [nextTask, ...remaining] = taskQueue
      set({
        currentTask: { ...nextTask, status: 'in_progress', startedAt: Date.now() },
        taskQueue: remaining,
        isProcessing: true
      })
    } else {
      set({ currentTask: null, isProcessing: false })
    }

    schedulePersist()
  },

  failTask: (taskId, error) => {
    const { currentTask, taskQueue } = get()
    if (currentTask?.id !== taskId) return

    const durationMs = currentTask.startedAt ? Date.now() - currentTask.startedAt : 0

    useActivityStore.getState().addActivity({
      type: 'error',
      description: `Task failed: ${currentTask.description}`,
      details: error
    })

    window.api.telemetry.emit('agent.task.failed', {
      durationMs,
      errorCategory: 'unknown'
    })

    if (taskQueue.length > 0) {
      window.api.telemetry.emit('agent.task.fallback_created', {
        failedTaskId: taskId,
        nextTaskDescription: taskQueue[0].description
      })
      const [nextTask, ...remaining] = taskQueue
      set({
        currentTask: { ...nextTask, status: 'in_progress', startedAt: Date.now() },
        taskQueue: remaining,
        isProcessing: true
      })
    } else {
      set({ currentTask: null, isProcessing: false })
    }

    schedulePersist()
  },

  emergencyStop: () => {
    useActivityStore.getState().addActivity({
      type: 'error',
      description: 'Emergency stop activated — all agent activity halted'
    })

    set({
      currentTask: null,
      taskQueue: [],
      isProcessing: false,
      emergencyStoppedAt: Date.now()
    })

    schedulePersist()
  },

  addLocalTask: (task) => {
    const id = `ltask_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const full: AgentTask = { ...task, id, status: 'pending', createdAt: Date.now() }
    set((s) => ({ localTasks: [full, ...s.localTasks] }))
    schedulePersist()
    return id
  },

  updateLocalTask: (id, update) => {
    set((s) => ({
      localTasks: s.localTasks.map((t) => (t.id === id ? { ...t, ...update } : t))
    }))
    schedulePersist()
  },

  addTaskChatMessage: (taskId, message) => {
    set((s) => ({
      taskChatMessages: {
        ...s.taskChatMessages,
        [taskId]: [...(s.taskChatMessages[taskId] ?? []), message]
      }
    }))
    schedulePersist()
  }
}))

registerSlice('task-store', () => {
  const s = useTaskStore.getState()
  return {
    taskQueue: s.taskQueue,
    localTasks: s.localTasks.slice(0, 200),
    taskChatMessages: s.taskChatMessages
  }
})
