import { create } from 'zustand'
import { useTaskStore } from './task-store'
import {
  registerSlice,
  schedulePersist,
  loadSnapshot
} from '@/lib/agent-state-persist'

export interface ProjectFile {
  id: string
  fileName: string
  filePath: string
  uploadedAt: number
  sizeBytes: number
}

export interface Project {
  id: string
  name: string
  description: string
  createdAt: number
  status: 'active' | 'archived'
  taskIds: string[]
  contextFiles: ProjectFile[]
}

interface ProjectStore {
  projects: Project[]
  hydrate: () => Promise<void>
  addProject: (
    project: Omit<Project, 'id' | 'createdAt' | 'status' | 'taskIds' | 'contextFiles'>
  ) => string
  updateProject: (id: string, update: Partial<Project>) => void
  addTaskToProject: (projectId: string, taskId: string) => void
  addProjectFile: (projectId: string, file: ProjectFile) => void
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],

  hydrate: async () => {
    const snap = await loadSnapshot()
    if (!snap) return
    set({ projects: (snap.projects as Project[] | undefined) ?? [] })
  },

  addProject: (project) => {
    const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const full: Project = {
      ...project,
      id,
      createdAt: Date.now(),
      status: 'active',
      taskIds: [],
      contextFiles: []
    }
    set((s) => ({ projects: [full, ...s.projects] }))
    schedulePersist()
    return id
  },

  updateProject: (id, update) => {
    set((s) => ({
      projects: s.projects.map((p) => (p.id === id ? { ...p, ...update } : p))
    }))
    schedulePersist()
  },

  addTaskToProject: (projectId, taskId) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId && !p.taskIds.includes(taskId)
          ? { ...p, taskIds: [...p.taskIds, taskId] }
          : p
      )
    }))
    // Also set the task's projectId pointer
    useTaskStore.setState((ts) => ({
      localTasks: ts.localTasks.map((t) =>
        t.id === taskId ? { ...t, projectId } : t
      )
    }))
    schedulePersist()
  },

  addProjectFile: (projectId, file) => {
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === projectId ? { ...p, contextFiles: [...p.contextFiles, file] } : p
      )
    }))
    schedulePersist()
  }
}))

registerSlice('project-store', () => ({
  projects: useProjectStore.getState().projects.slice(0, 100)
}))
