import { create } from 'zustand'

export interface ReviewActivity {
  rangeStart: number
  rangeEnd: number
  capturesProcessed: number
  decisionsMade: string[]
  decisionsRevisited: string[]
  areasActive: string[]
  areasNeglected: string[]
  tasksCompleted: number
  tasksMoved: number
  projectsArchived: string[]
  lessonsExtracted: string[]
  patternsDetected: string[]
}

export interface Review {
  id: string
  period: 'week' | 'month'
  generatedAt: number
  rangeStart: number
  rangeEnd: number
  content: string
  highlights: ReviewActivity
  userNotes?: string
  acknowledged: boolean
  vaultPath: string
}

interface ReviewStore {
  reviews: Review[]
  loading: boolean
  generating: boolean
  error: string | null
  hydrate: () => Promise<void>
  generate: (period: 'week' | 'month') => Promise<Review | null>
  acknowledge: (id: string) => Promise<void>
  addNotes: (id: string, notes: string) => Promise<void>
}

export const useReviewStore = create<ReviewStore>((set, get) => ({
  reviews: [],
  loading: false,
  generating: false,
  error: null,

  hydrate: async () => {
    set({ loading: true, error: null })
    try {
      const res = await window.api.review.list()
      if (!res.success) {
        set({ error: res.error ?? 'Failed to load reviews', loading: false })
        return
      }
      set({ reviews: res.reviews, loading: false })
    } catch (err) {
      set({ error: (err as Error).message, loading: false })
    }
  },

  generate: async (period) => {
    set({ generating: true, error: null })
    try {
      const res = await window.api.review.generate(period)
      if (!res.success || !res.review) {
        set({ error: res.error ?? 'Generation failed', generating: false })
        return null
      }
      const review = res.review
      set((s) => {
        const next = s.reviews.filter((r) => r.id !== review.id)
        next.unshift(review)
        return { reviews: next, generating: false }
      })
      return review
    } catch (err) {
      set({ error: (err as Error).message, generating: false })
      return null
    }
  },

  acknowledge: async (id) => {
    const res = await window.api.review.acknowledge(id)
    if (res.success && res.review) {
      const r = res.review
      set((s) => ({ reviews: s.reviews.map((x) => (x.id === id ? r : x)) }))
    }
    void get
  },

  addNotes: async (id, notes) => {
    const res = await window.api.review.addNotes(id, notes)
    if (res.success && res.review) {
      const r = res.review
      set((s) => ({ reviews: s.reviews.map((x) => (x.id === id ? r : x)) }))
    }
  }
}))
