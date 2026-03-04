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

export interface ScheduleChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
}

export interface LandscapeTheme {
  id: string
  title: string
  description: string
  weight: 'high' | 'mid' | 'low' | 'neutral'
  tags: string[]
  mentionCount: number
  deadline?: string
  quickAction?: { actionType: string; params: unknown; riskTier: string }
}

export interface AgentThread {
  id: string
  title: string
  holdingNote: string
  createdAt: number
  relatedThemeId?: string
}

export interface CaptureEntry {
  id: string
  text: string
  type: 'thought' | 'action' | 'question'
  timestamp: number
  agentNote: string | null
  linkedThemeId?: string
  linkedThreadId?: string
}

export interface MorningLandscape {
  message: string
  question: string | null
  suggestedActions: Array<{ label: string; actionType: string; payload: unknown }>
  generatedAt: number
}

interface AgentStore {
  currentTask: AgentTask | null
  taskQueue: AgentTask[]
  activityFeed: ActivityEntry[]
  scheduleChatHistory: ScheduleChatMessage[]
  morningLandscape: MorningLandscape | null
  themes: LandscapeTheme[]
  threads: AgentThread[]
  rawCaptures: CaptureEntry[]
  rawCapturesCount: number
  isProcessing: boolean
  usageLimitReached: boolean
  morningBriefing: string | null
  briefingDate: string | null
  emergencyStoppedAt: number | null

  hydrate: () => Promise<void>
  addTask: (description: string) => void
  completeTask: (taskId: string, result?: string) => void
  failTask: (taskId: string, error: string) => void
  addActivity: (entry: Omit<ActivityEntry, 'id' | 'timestamp'>) => void
  clearActivity: () => void
  setMorningBriefing: (content: string) => void
  setUsageLimitReached: (reached: boolean) => void
  emergencyStop: () => void
  setScheduleChatHistory: (history: ScheduleChatMessage[]) => void
  setMorningLandscape: (data: MorningLandscape) => void
  setThemes: (themes: LandscapeTheme[]) => void
  addThread: (t: Omit<AgentThread, 'id' | 'createdAt'>) => void
  addRawCapture: (e: Omit<CaptureEntry, 'id' | 'timestamp'>) => void
  updateCaptureNote: (id: string, agentNote: string) => void
}

const MAX_ACTIVITY_ENTRIES = 100
const MAX_SCHEDULE_CHAT_ENTRIES = 100

function persistState(state: {
  morningBriefing: string | null
  briefingDate: string | null
  taskQueue: AgentTask[]
  activityFeed: ActivityEntry[]
  scheduleChatHistory: ScheduleChatMessage[]
}): void {
  window.api.agent.setState({
    morningBriefing: state.morningBriefing,
    briefingDate: state.briefingDate,
    taskQueue: state.taskQueue,
    activityFeed: state.activityFeed.slice(-MAX_ACTIVITY_ENTRIES),
    scheduleChatHistory: state.scheduleChatHistory.slice(-MAX_SCHEDULE_CHAT_ENTRIES)
  })
}

let taskIdCounter = 0
let activityIdCounter = 0
let captureIdCounter = 0
let threadIdCounter = 0

export const useAgentStore = create<AgentStore>((set, get) => ({
  currentTask: null,
  taskQueue: [],
  activityFeed: [],
  scheduleChatHistory: [],
  morningLandscape: null,
  themes: [],
  threads: [],
  rawCaptures: [],
  rawCapturesCount: 0,
  isProcessing: false,
  usageLimitReached: false,
  morningBriefing: null,
  briefingDate: null,
  emergencyStoppedAt: null,

  hydrate: async () => {
    try {
      const saved = await window.api.agent.getState()
      if (saved) {
        set({
          morningBriefing: saved.morningBriefing ?? null,
          briefingDate: saved.briefingDate ?? null,
          taskQueue: saved.taskQueue ?? [],
          activityFeed: saved.activityFeed ?? [],
          scheduleChatHistory: saved.scheduleChatHistory ?? []
        })
      }
    } catch {
      // Use defaults if file is missing or corrupt
    }
  },

  setUsageLimitReached: (reached) => {
    set({ usageLimitReached: reached })
    if (reached) {
      get().addActivity({
        type: 'error',
        description: 'Usage limit reached — agent paused. Enable BYOK in Settings to continue.'
      })
      set({ isProcessing: false })
    }
  },

  addTask: (description) => {
    const { usageLimitReached, emergencyStoppedAt } = get()
    if (usageLimitReached) {
      get().addActivity({
        type: 'error',
        description: `Cannot start task: usage limit reached`
      })
      return
    }

    // Emit resumed event if resuming after emergency stop
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

    get().addActivity({ type: 'info', description: `Task added: ${description}` })

    const s = get()
    persistState({ morningBriefing: s.morningBriefing, briefingDate: s.briefingDate, taskQueue: s.taskQueue, activityFeed: s.activityFeed, scheduleChatHistory: s.scheduleChatHistory })
  },

  completeTask: (taskId, result) => {
    const { currentTask, taskQueue } = get()

    if (currentTask?.id === taskId) {
      const completedTask = { ...currentTask, status: 'completed' as const, completedAt: Date.now(), result }
      const durationMs = completedTask.startedAt ? Date.now() - completedTask.startedAt : 0

      get().addActivity({
        type: 'info',
        description: `Task completed: ${completedTask.description}`,
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

      const s = get()
      persistState({ morningBriefing: s.morningBriefing, briefingDate: s.briefingDate, taskQueue: s.taskQueue, activityFeed: s.activityFeed, scheduleChatHistory: s.scheduleChatHistory })
    }
  },

  failTask: (taskId, error) => {
    const { currentTask, taskQueue } = get()

    if (currentTask?.id === taskId) {
      const durationMs = currentTask.startedAt ? Date.now() - currentTask.startedAt : 0

      get().addActivity({
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

      const s = get()
      persistState({ morningBriefing: s.morningBriefing, briefingDate: s.briefingDate, taskQueue: s.taskQueue, activityFeed: s.activityFeed, scheduleChatHistory: s.scheduleChatHistory })
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

  clearActivity: () => {
    set({ activityFeed: [] })
    const s = get()
    persistState({ morningBriefing: s.morningBriefing, briefingDate: s.briefingDate, taskQueue: s.taskQueue, activityFeed: [], scheduleChatHistory: s.scheduleChatHistory })
  },

  setMorningBriefing: (content) => {
    const briefingDate = new Date().toISOString().split('T')[0]
    set({ morningBriefing: content, briefingDate })
    const s = get()
    persistState({ morningBriefing: content, briefingDate, taskQueue: s.taskQueue, activityFeed: s.activityFeed, scheduleChatHistory: s.scheduleChatHistory })
  },

  emergencyStop: () => {
    get().addActivity({
      type: 'error',
      description: 'Emergency stop activated — all agent activity halted'
    })

    set({
      currentTask: null,
      taskQueue: [],
      isProcessing: false,
      emergencyStoppedAt: Date.now()
    })

    const s = get()
    persistState({ morningBriefing: s.morningBriefing, briefingDate: s.briefingDate, taskQueue: [], activityFeed: s.activityFeed, scheduleChatHistory: s.scheduleChatHistory })
  },

  setScheduleChatHistory: (history) => {
    set({ scheduleChatHistory: history })
    const s = get()
    persistState({ morningBriefing: s.morningBriefing, briefingDate: s.briefingDate, taskQueue: s.taskQueue, activityFeed: s.activityFeed, scheduleChatHistory: history })
  },

  setMorningLandscape: (data) => {
    set({ morningLandscape: data })
  },

  setThemes: (themes) => {
    set({ themes })
  },

  addThread: (t) => {
    const thread: AgentThread = {
      ...t,
      id: `thread_${++threadIdCounter}`,
      createdAt: Date.now()
    }
    set((s) => ({ threads: [...s.threads, thread] }))
  },

  addRawCapture: (e) => {
    const entry: CaptureEntry = {
      ...e,
      id: `cap_${++captureIdCounter}`,
      timestamp: Date.now()
    }
    set((s) => ({
      rawCaptures: [entry, ...s.rawCaptures].slice(0, 200),
      rawCapturesCount: s.rawCapturesCount + (e.agentNote === null ? 1 : 0)
    }))
  },

  updateCaptureNote: (id, agentNote) => {
    set((s) => ({
      rawCaptures: s.rawCaptures.map((c) => (c.id === id ? { ...c, agentNote } : c)),
      rawCapturesCount: Math.max(0, s.rawCapturesCount - 1)
    }))
  }
}))
