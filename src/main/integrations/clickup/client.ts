import { net } from 'electron'
import { getValidToken } from '../../oauth/oauth-manager'

const BASE_URL = 'https://api.clickup.com/api/v2'

async function apiRequest(endpoint: string, options: RequestInit = {}): Promise<any> {
  const tokens = await getValidToken('clickup')
  const url = `${BASE_URL}${endpoint}`
  // ClickUp uses Authorization: {token} (no "Bearer" prefix)
  const response = await net.fetch(url, {
    ...options,
    headers: {
      Authorization: tokens.access_token,
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>)
    }
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`ClickUp API error (${response.status}): ${text}`)
  }
  if (response.status === 204) return null
  return response.json()
}

// === READ (Low Risk) ===

export async function getWorkspaces(): Promise<any> {
  return apiRequest('/team')
}

export async function getSpaces(teamId: string): Promise<any> {
  return apiRequest(`/team/${teamId}/space`)
}

export async function getFolders(spaceId: string): Promise<any> {
  return apiRequest(`/space/${spaceId}/folder`)
}

export async function getLists(folderId: string): Promise<any> {
  return apiRequest(`/folder/${folderId}/list`)
}

export async function getTasks(
  listId: string,
  options: {
    statuses?: string[]
    assignees?: string[]
    page?: number
  } = {}
): Promise<any> {
  const params = new URLSearchParams()
  if (options.page) params.set('page', String(options.page))
  return apiRequest(`/list/${listId}/task?${params}`)
}

export async function getTask(taskId: string): Promise<any> {
  return apiRequest(`/task/${taskId}`)
}

// === WRITE (Mid Risk) ===

export async function createTask(
  listId: string,
  task: {
    name: string
    description?: string
    status?: string
    priority?: number // 1=urgent, 2=high, 3=normal, 4=low
    due_date?: number // Unix ms
    assignees?: number[]
    tags?: string[]
  }
): Promise<any> {
  return apiRequest(`/list/${listId}/task`, {
    method: 'POST',
    body: JSON.stringify(task)
  })
}

export async function updateTask(
  taskId: string,
  updates: {
    name?: string
    description?: string
    status?: string
    priority?: number
    due_date?: number
  }
): Promise<any> {
  return apiRequest(`/task/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify(updates)
  })
}

// === DELETE (High Risk) ===

export async function deleteTask(taskId: string): Promise<void> {
  await apiRequest(`/task/${taskId}`, { method: 'DELETE' })
}

// === CONVENIENCE ===

export async function getMyTasks(teamId: string): Promise<any> {
  return apiRequest(`/team/${teamId}/task?assignees[]=me&order_by=due_date`)
}
