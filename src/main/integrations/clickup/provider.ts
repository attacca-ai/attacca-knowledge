import type { IntegrationProvider, DirectConnection } from '../types'
import { saveTokens, loadTokens, clearTokens, hasTokens } from '../token-store'
import * as client from './client'

let cachedUserId: number | null = null
let userIdLoaded = false

async function ensureUserId(): Promise<void> {
  if (cachedUserId || userIdLoaded) return
  userIdLoaded = true
  const tokens = loadTokens('clickup')
  if (!tokens?.access_token) return
  try {
    const { userId } = await client.validateToken(tokens.access_token)
    if (userId) cachedUserId = userId
    console.log(`[clickup] Loaded userId on startup: ${cachedUserId}`)
  } catch {
    // Non-fatal — tasks will show unfiltered
  }
}

const ACTION_MAP: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
  CLICKUP_AUTHORIZATION_GET_WORK_SPACE_LIST: () => client.getTeams(),
  CLICKUP_GET_SPACES: (p) => client.getSpaces(String(p.team_id)),
  CLICKUP_GET_FOLDERS: (p) => client.getFolders(String(p.space_id)),
  CLICKUP_GET_FILTERED_TEAM_TASKS: (p) => {
    const teamId = String(p.team_id)
    const rest = { ...p }
    delete rest.team_id
    // Auto-filter to current user's tasks unless assignees explicitly provided
    if (!rest.assignees && cachedUserId) {
      rest.assignees = [cachedUserId]
    }
    return client.getFilteredTeamTasks(teamId, rest)
  },
  CLICKUP_CREATE_TASK: (p) => {
    const listId = String(p.list_id)
    const rest = { ...p }
    delete rest.list_id
    return client.createTask(listId, rest)
  },
  CLICKUP_CREATE_CHECKLIST: (p) => client.createChecklist(String(p.task_id), String(p.name)),
  CLICKUP_CREATE_CHECKLIST_ITEM: (p) =>
    client.createChecklistItem(String(p.checklist_id), String(p.name)),
  CLICKUP_GET_TASK: (p) => client.getTask(String(p.task_id)),
  CLICKUP_GET_TASK_COMMENTS: (p) => client.getTaskComments(String(p.task_id))
}

let cachedWorkspaceName: string | null = null

export const clickupProvider: IntegrationProvider = {
  slug: 'clickup',

  async hasConnections(): Promise<boolean> {
    if (!hasTokens('clickup')) return false
    await ensureUserId()
    return true
  },

  async getConnections(): Promise<DirectConnection[]> {
    if (!hasTokens('clickup')) return []
    return [
      {
        connectionId: 'direct:clickup:default',
        toolkit: 'clickup',
        status: 'active',
        meta: cachedWorkspaceName ? { workspace: cachedWorkspaceName } : undefined
      }
    ]
  },

  async executeAction(
    actionName: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const handler = ACTION_MAP[actionName]
    if (!handler) {
      throw new Error(`Unknown ClickUp action: ${actionName}`)
    }
    return handler(params)
  },

  async disconnect(): Promise<void> {
    clearTokens('clickup')
    cachedWorkspaceName = null
    cachedUserId = null
    userIdLoaded = false
    console.log('[clickup] Disconnected')
  }
}

export async function connectClickUp(
  token: string
): Promise<{ success: boolean; workspaceName?: string; error?: string }> {
  try {
    const { valid, teams, userId } = await client.validateToken(token)
    if (!valid) {
      return { success: false, error: 'Invalid API token — check your ClickUp settings' }
    }
    saveTokens('clickup', { access_token: token })
    cachedWorkspaceName = teams[0]?.name ?? null
    cachedUserId = userId ?? null
    console.log(`[clickup] Connected to workspace: ${cachedWorkspaceName}, userId: ${cachedUserId}`)
    return { success: true, workspaceName: cachedWorkspaceName ?? undefined }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to connect'
    }
  }
}

export function getClickUpStatus(): {
  connected: boolean
  workspaceName: string | null
} {
  const tokens = loadTokens('clickup')
  return {
    connected: !!tokens?.access_token,
    workspaceName: cachedWorkspaceName
  }
}
