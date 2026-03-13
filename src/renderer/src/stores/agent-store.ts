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
  pendingAction?: { actionType: string; params: unknown }
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
  addThread: (t: Omit<AgentThread, 'id' | 'createdAt'>) => string
  closeThread: (id: string) => void
  updateThreadNote: (id: string, holdingNote: string) => void
  addRawCapture: (e: Omit<CaptureEntry, 'id' | 'timestamp'>) => void
  updateCaptureNote: (id: string, agentNote: string) => void
}

const MAX_ACTIVITY_ENTRIES = 100
const MAX_SCHEDULE_CHAT_ENTRIES = 100

let taskIdCounter = 0
let activityIdCounter = 0
let captureIdCounter = 0
let threadIdCounter = 0

export const useAgentStore = create<AgentStore>((set, get) => {
  function persist(): void {
    const s = get()
    window.api.agent.setState({
      morningBriefing: s.morningBriefing,
      briefingDate: s.briefingDate,
      morningLandscape: s.morningLandscape,
      themes: s.themes,
      taskQueue: s.taskQueue,
      activityFeed: s.activityFeed.slice(-MAX_ACTIVITY_ENTRIES),
      scheduleChatHistory: s.scheduleChatHistory.slice(-MAX_SCHEDULE_CHAT_ENTRIES),
      rawCaptures: s.rawCaptures.slice(0, 100),
      threads: s.threads.slice(0, 100),
    })
  }

  return {
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
          // Re-seed ID counters to avoid collisions after hydration
          const savedCaptures: CaptureEntry[] = saved.rawCaptures ?? []
          const savedThreads: AgentThread[] = saved.threads ?? []
          for (const c of savedCaptures) {
            const n = parseInt(c.id.replace('cap_', ''))
            if (!isNaN(n) && n > captureIdCounter) captureIdCounter = n
          }
          for (const t of savedThreads) {
            const n = parseInt(t.id.replace('thread_', ''))
            if (!isNaN(n) && n > threadIdCounter) threadIdCounter = n
          }
          set({
            morningBriefing: saved.morningBriefing ?? null,
            briefingDate: saved.briefingDate ?? null,
            morningLandscape: saved.morningLandscape ?? null,
            themes: saved.themes ?? [],
            taskQueue: saved.taskQueue ?? [],
            activityFeed: saved.activityFeed ?? [],
            scheduleChatHistory: saved.scheduleChatHistory ?? [],
            rawCaptures: savedCaptures,
            threads: savedThreads,
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
      persist()
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

        persist()
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

        persist()
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
      persist()
    },

    setMorningBriefing: (content) => {
      const briefingDate = new Date().toISOString().split('T')[0]
      set({ morningBriefing: content, briefingDate })
      persist()
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

      persist()
    },

    setScheduleChatHistory: (history) => {
      set({ scheduleChatHistory: history })
      persist()
    },

    setMorningLandscape: (data) => {
      set({ morningLandscape: data })
      persist()
    },

    setThemes: (themes) => {
      set({ themes })
      persist()
    },

    addThread: (t) => {
      const thread: AgentThread = {
        ...t,
        id: `thread_${++threadIdCounter}`,
        createdAt: Date.now()
      }
      set((s) => ({ threads: [...s.threads, thread] }))
      persist()
      return thread.id
    },

    closeThread: (id) => {
      set((s) => ({ threads: s.threads.filter((t) => t.id !== id) }))
      persist()
    },

    updateThreadNote: (id, holdingNote) => {
      set((s) => ({
        threads: s.threads.map((t) => t.id === id ? { ...t, holdingNote } : t)
      }))
      persist()
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
      persist()
    },

    updateCaptureNote: (id, agentNote) => {
      set((s) => ({
        rawCaptures: s.rawCaptures.map((c) => (c.id === id ? { ...c, agentNote } : c)),
        rawCapturesCount: Math.max(0, s.rawCapturesCount - 1)
      }))
      persist()
    }
  }
})
