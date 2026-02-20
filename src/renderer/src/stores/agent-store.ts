import { create } from 'zustand'

export interface AgentTask {
  id: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  createdAt: number
  startedAt?: number
  completedAt?: number
  result?: string
  error?: string
}

export interface ActivityEntry {
  id: string
  timestamp: number
  type: 'info' | 'action' | 'tool_call' | 'tool_result' | 'error' | 'message'
  description: string
  details?: string
  expanded?: boolean
}

interface AgentStore {
  currentTask: AgentTask | null
  taskQueue: AgentTask[]
  activityFeed: ActivityEntry[]
  isProcessing: boolean
  morningBriefing: string | null
  briefingDate: string | null

  addTask: (description: string) => void
  completeTask: (taskId: string, result?: string) => void
  failTask: (taskId: string, error: string) => void
  addActivity: (entry: Omit<ActivityEntry, 'id' | 'timestamp'>) => void
  clearActivity: () => void
  setMorningBriefing: (content: string) => void
  emergencyStop: () => void
}

let taskIdCounter = 0
let activityIdCounter = 0

export const useAgentStore = create<AgentStore>((set, get) => ({
  currentTask: null,
  taskQueue: [],
  activityFeed: [],
  isProcessing: false,
  morningBriefing: null,
  briefingDate: null,

  addTask: (description) => {
    const task: AgentTask = {
      id: `task_${++taskIdCounter}`,
      description,
      status: 'pending',
      createdAt: Date.now()
    }

    const { currentTask } = get()
    if (!currentTask) {
      // Start immediately if no current task
      set({
        currentTask: { ...task, status: 'in_progress', startedAt: Date.now() },
        isProcessing: true
      })
    } else {
      set({ taskQueue: [...get().taskQueue, task] })
    }

    get().addActivity({ type: 'info', description: `Task added: ${description}` })
  },

  completeTask: (taskId, result) => {
    const { currentTask, taskQueue } = get()

    if (currentTask?.id === taskId) {
      const completedTask = { ...currentTask, status: 'completed' as const, completedAt: Date.now(), result }

      get().addActivity({
        type: 'info',
        description: `Task completed: ${completedTask.description}`,
        details: result
      })

      // Move to next task
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
    }
  },

  failTask: (taskId, error) => {
    const { currentTask, taskQueue } = get()

    if (currentTask?.id === taskId) {
      get().addActivity({
        type: 'error',
        description: `Task failed: ${currentTask.description}`,
        details: error
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
    }
  },

  addActivity: (entry) => {
    const fullEntry: ActivityEntry = {
      ...entry,
      id: `act_${++activityIdCounter}`,
      timestamp: Date.now()
    }
    set({ activityFeed: [...get().activityFeed, fullEntry] })
  },

  clearActivity: () => set({ activityFeed: [] }),

  setMorningBriefing: (content) => {
    set({
      morningBriefing: content,
      briefingDate: new Date().toISOString().split('T')[0]
    })
  },

  emergencyStop: () => {
    get().addActivity({
      type: 'error',
      description: 'Emergency stop activated — all agent activity halted'
    })

    set({
      currentTask: null,
      taskQueue: [],
      isProcessing: false
    })
  }
}))
