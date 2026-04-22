import { create } from 'zustand'
import {
  registerSlice,
  schedulePersist,
  loadSnapshot
} from '@/lib/agent-state-persist'

/**
 * Today store — the residual state that used to live in `agent-store.ts`
 * once captures / tasks / projects / activity / vault were broken out.
 *
 * Holds the v0.2 dashboard surface: morning briefing, schedule chat,
 * themes + threads (the "landscape" model), workflow library, transcript
 * history. The Life OS spec (§5.1) marks most of these for deletion
 * alongside the related views — removal happens in a later Phase 0 PR so
 * this split stays scoped to extraction.
 */

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
  archived?: boolean
  archiveNote?: string
  archivedAt?: number
}

export interface AgentThread {
  id: string
  title: string
  holdingNote: string
  createdAt: number
  relatedThemeId?: string
  pendingAction?: { actionType: string; params: unknown }
}

export interface ThreadMessage {
  role: 'agent' | 'user'
  text: string
  ts: number
}

export interface MorningLandscape {
  message: string
  question: string | null
  suggestedActions: Array<{ label: string; actionType: string; payload: unknown }>
  generatedAt: number
}

export interface ScheduleReadCache {
  message: string
  question: string | null
  suggestedActions: Array<{
    label: string
    icon: 'warn' | 'plus' | 'move' | 'send'
    risk: 'low' | 'mid' | 'high'
    prompt: string
  }>
  generatedAt: number
  eventsHash: string
}

export interface TranscriptRecord {
  id: string
  fileName: string
  status: 'processing' | 'completed' | 'failed'
  startedAt: number
  completedAt?: number
  error?: string
}

export interface LibraryEntry {
  id: string
  name: string
  description?: string
  status: 'active' | 'paused'
  runs: number
}

interface TodayStore {
  morningBriefing: string | null
  briefingDate: string | null
  morningLandscape: MorningLandscape | null
  scheduleReadCache: ScheduleReadCache | null
  scheduleChatHistory: ScheduleChatMessage[]
  themes: LandscapeTheme[]
  threads: AgentThread[]
  threadMessages: Record<string, ThreadMessage[]>
  activeThreadId: string | null
  workflowLibrary: LibraryEntry[]
  transcriptHistory: TranscriptRecord[]

  hydrate: () => Promise<void>
  setMorningBriefing: (content: string) => void
  setScheduleChatHistory: (history: ScheduleChatMessage[]) => void
  setScheduleReadCache: (data: ScheduleReadCache) => void
  setMorningLandscape: (data: MorningLandscape) => void
  setThemes: (themes: LandscapeTheme[]) => void
  archiveTheme: (id: string, note?: string) => void
  setThreads: (threads: AgentThread[]) => void
  addThread: (t: Omit<AgentThread, 'id' | 'createdAt'>) => string
  closeThread: (id: string) => void
  updateThreadNote: (id: string, holdingNote: string) => void
  setActiveThreadId: (id: string | null) => void
  addThreadMessage: (threadId: string, message: ThreadMessage) => void
  setWorkflowLibrary: (library: LibraryEntry[]) => void
  addWorkflow: (entry: LibraryEntry) => void
  updateWorkflowRuns: (name: string) => void
  addTranscriptRecord: (
    record: Omit<TranscriptRecord, 'id' | 'startedAt'>
  ) => string
  updateTranscriptRecord: (
    id: string,
    update: Partial<Pick<TranscriptRecord, 'status' | 'completedAt' | 'error'>>
  ) => void
}

const MAX_SCHEDULE_CHAT_ENTRIES = 100
let threadIdCounter = 0

export const useTodayStore = create<TodayStore>((set) => ({
  morningBriefing: null,
  briefingDate: null,
  morningLandscape: null,
  scheduleReadCache: null,
  scheduleChatHistory: [],
  themes: [],
  threads: [],
  threadMessages: {},
  activeThreadId: null,
  workflowLibrary: [],
  transcriptHistory: [],

  hydrate: async () => {
    const snap = await loadSnapshot()
    if (!snap) return

    const savedThreads: AgentThread[] =
      (snap.threads as AgentThread[] | undefined) ?? []
    for (const t of savedThreads) {
      const n = parseInt(t.id.replace('thread_', ''))
      if (!isNaN(n) && n > threadIdCounter) threadIdCounter = n
    }

    // Migrate workflow library from localStorage if not yet in the snapshot
    let workflows: LibraryEntry[] =
      (snap.workflowLibrary as LibraryEntry[] | undefined) ?? []
    if (workflows.length === 0) {
      try {
        const ls = localStorage.getItem('attacca:workflows:library')
        if (ls) {
          workflows = JSON.parse(ls) as LibraryEntry[]
          localStorage.removeItem('attacca:workflows:library')
        }
      } catch {
        /* ignore */
      }
    }

    set({
      morningBriefing: (snap.morningBriefing as string | null | undefined) ?? null,
      briefingDate: (snap.briefingDate as string | null | undefined) ?? null,
      morningLandscape:
        (snap.morningLandscape as MorningLandscape | null | undefined) ?? null,
      scheduleReadCache:
        (snap.scheduleReadCache as ScheduleReadCache | null | undefined) ?? null,
      scheduleChatHistory:
        (snap.scheduleChatHistory as ScheduleChatMessage[] | undefined) ?? [],
      themes: (snap.themes as LandscapeTheme[] | undefined) ?? [],
      threads: savedThreads,
      threadMessages:
        (snap.threadMessages as Record<string, ThreadMessage[]> | undefined) ?? {},
      activeThreadId: (snap.activeThreadId as string | null | undefined) ?? null,
      workflowLibrary: workflows,
      transcriptHistory:
        (snap.transcriptHistory as TranscriptRecord[] | undefined) ?? []
    })
  },

  setMorningBriefing: (content) => {
    const briefingDate = new Date().toISOString().split('T')[0]
    set({ morningBriefing: content, briefingDate })
    schedulePersist()
  },

  setScheduleChatHistory: (history) => {
    set({ scheduleChatHistory: history.slice(-MAX_SCHEDULE_CHAT_ENTRIES) })
    schedulePersist()
  },

  setScheduleReadCache: (data) => {
    set({ scheduleReadCache: data })
    schedulePersist()
  },

  setMorningLandscape: (data) => {
    set({ morningLandscape: data })
    schedulePersist()
  },

  setThemes: (themes) => {
    set({ themes })
    schedulePersist()
  },

  archiveTheme: (id, note) => {
    set((s) => ({
      themes: s.themes.map((t) =>
        t.id === id
          ? { ...t, archived: true, archiveNote: note, archivedAt: Date.now() }
          : t
      )
    }))
    schedulePersist()
  },

  setThreads: (threads) => {
    set({ threads })
    schedulePersist()
  },

  addThread: (t) => {
    const thread: AgentThread = {
      ...t,
      id: `thread_${++threadIdCounter}`,
      createdAt: Date.now()
    }
    set((s) => ({ threads: [...s.threads, thread] }))
    schedulePersist()
    return thread.id
  },

  closeThread: (id) => {
    set((s) => {
      const { [id]: _omit, ...rest } = s.threadMessages
      return {
        threads: s.threads.filter((t) => t.id !== id),
        threadMessages: rest,
        activeThreadId: s.activeThreadId === id ? null : s.activeThreadId
      }
    })
    schedulePersist()
  },

  setActiveThreadId: (id) => {
    set({ activeThreadId: id })
    schedulePersist()
  },

  addThreadMessage: (threadId, message) => {
    set((s) => ({
      threadMessages: {
        ...s.threadMessages,
        [threadId]: [...(s.threadMessages[threadId] ?? []), message]
      }
    }))
    schedulePersist()
  },

  updateThreadNote: (id, holdingNote) => {
    set((s) => ({
      threads: s.threads.map((t) => (t.id === id ? { ...t, holdingNote } : t))
    }))
    schedulePersist()
  },

  setWorkflowLibrary: (library) => {
    set({ workflowLibrary: library })
    schedulePersist()
  },

  addWorkflow: (entry) => {
    set((s) => ({ workflowLibrary: [entry, ...s.workflowLibrary] }))
    schedulePersist()
  },

  updateWorkflowRuns: (name) => {
    set((s) => ({
      workflowLibrary: s.workflowLibrary.map((e) =>
        e.name === name ? { ...e, runs: e.runs + 1 } : e
      )
    }))
    schedulePersist()
  },

  addTranscriptRecord: (record) => {
    const id = `transcript_${Date.now()}`
    const full: TranscriptRecord = { ...record, id, startedAt: Date.now() }
    set((s) => ({
      transcriptHistory: [full, ...s.transcriptHistory].slice(0, 50)
    }))
    schedulePersist()
    return id
  },

  updateTranscriptRecord: (id, update) => {
    set((s) => ({
      transcriptHistory: s.transcriptHistory.map((r) =>
        r.id === id ? { ...r, ...update } : r
      )
    }))
    schedulePersist()
  }
}))

registerSlice('today-store', () => {
  const s = useTodayStore.getState()
  return {
    morningBriefing: s.morningBriefing,
    briefingDate: s.briefingDate,
    morningLandscape: s.morningLandscape,
    scheduleReadCache: s.scheduleReadCache,
    scheduleChatHistory: s.scheduleChatHistory.slice(-MAX_SCHEDULE_CHAT_ENTRIES),
    themes: s.themes,
    threads: s.threads.slice(0, 100),
    threadMessages: s.threadMessages,
    activeThreadId: s.activeThreadId,
    workflowLibrary: s.workflowLibrary,
    transcriptHistory: s.transcriptHistory.slice(0, 50)
  }
})
