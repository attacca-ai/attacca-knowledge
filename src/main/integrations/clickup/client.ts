import { net } from 'electron'
import { loadTokens } from '../token-store'

const BASE_URL = 'https://api.clickup.com/api/v2'

function getToken(): string {
  const tokens = loadTokens('clickup')
  if (!tokens?.access_token) throw new Error('ClickUp not connected — add your API token in Settings → Connections')
  return tokens.access_token
}

async function request(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<unknown> {
  const token = getToken()
  const url = `${BASE_URL}${path}`

  console.log(`[clickup] ${method} ${path}`)

  const options: RequestInit = {
    method,
    headers: {
      Authorization: token,
      'Content-Type': 'application/json'
    }
  }
  if (body) options.body = JSON.stringify(body)

  const res = await net.fetch(url, options)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`ClickUp API ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.json()
}

// ── Read operations ─────────────────────────────────────────────

export async function getTeams(): Promise<unknown> {
  const data = (await request('GET', '/team')) as { teams: unknown[] }
  return { teams: data.teams }
}

export async function getSpaces(teamId: string): Promise<unknown> {
  const data = (await request('GET', `/team/${teamId}/space`)) as { spaces: unknown[] }
  return { spaces: data.spaces }
}

export async function getFolders(spaceId: string): Promise<unknown> {
  const data = (await request('GET', `/space/${spaceId}/folder`)) as { folders: unknown[] }
  return { folders: data.folders }
}

export async function getFilteredTeamTasks(
  teamId: string,
  params: Record<string, unknown>
): Promise<unknown> {
  const query = new URLSearchParams()
  if (params.statuses) {
    const statuses = Array.isArray(params.statuses) ? params.statuses : [params.statuses]
    for (const s of statuses) query.append('statuses[]', String(s))
  }
  if (params.include_closed !== undefined) query.set('include_closed', String(params.include_closed))
  if (params.assignees) {
    const assignees = Array.isArray(params.assignees) ? params.assignees : [params.assignees]
    for (const a of assignees) query.append('assignees[]', String(a))
  }
  if (params.page) query.set('page', String(params.page))

  const qs = query.toString()
  const path = `/team/${teamId}/task${qs ? `?${qs}` : ''}`
  const data = (await request('GET', path)) as { tasks: unknown[] }
  return { tasks: data.tasks }
}

// ── Write operations ────────────────────────────────────────────

export async function createTask(
  listId: string,
  params: Record<string, unknown>
): Promise<unknown> {
  return request('POST', `/list/${listId}/task`, params)
}

export async function createChecklist(
  taskId: string,
  name: string
): Promise<unknown> {
  return request('POST', `/task/${taskId}/checklist`, { name })
}

export async function createChecklistItem(
  checklistId: string,
  name: string
): Promise<unknown> {
  return request('POST', `/checklist/${checklistId}/checklist_item`, { name })
}

// ── Detail reads ────────────────────────────────────────────────

export async function getTask(taskId: string): Promise<unknown> {
  return request('GET', `/task/${taskId}?include_subtasks=true`)
}

export async function getTaskComments(taskId: string): Promise<unknown> {
  return request('GET', `/task/${taskId}/comment`)
}

// ── Validation ──────────────────────────────────────────────────

export async function validateToken(token: string): Promise<{
  valid: boolean
  teams: Array<{ id: string; name: string; members: Array<{ user: { id: number; username: string; email: string } }> }>
  userId?: number
}> {
  const res = await net.fetch(`${BASE_URL}/team`, {
    headers: { Authorization: token, 'Content-Type': 'application/json' }
  })
  if (!res.ok) return { valid: false, teams: [] }
  const data = (await res.json()) as {
    teams: Array<{
      id: string
      name: string
      members: Array<{ user: { id: number; username: string; email: string } }>
    }>
  }

  // Get the authorized user — the token owner is in the team members list.
  // The /user endpoint is undocumented but works with personal tokens.
  let userId: number | undefined
  try {
    const userRes = await net.fetch(`${BASE_URL}/user`, {
      headers: { Authorization: token, 'Content-Type': 'application/json' }
    })
    if (userRes.ok) {
      const userData = (await userRes.json()) as { user?: { id: number } }
      userId = userData.user?.id
    }
  } catch { /* fallback below */ }

  // Fallback: first member in first team
  if (!userId && data.teams?.[0]?.members?.[0]) {
    userId = data.teams[0].members[0].user.id
  }

  return { valid: true, teams: data.teams ?? [], userId }
}
