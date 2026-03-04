import { net } from 'electron'
import { getValidToken, refreshAccessToken } from '../../oauth/oauth-manager'

const BASE_URL = 'https://www.googleapis.com/drive/v3'
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3'

async function apiRequest(
  endpoint: string,
  options: RequestInit = {},
  baseUrl: string = BASE_URL
): Promise<any> {
  const tokens = await getValidToken('google-drive')
  const url = `${baseUrl}${endpoint}`
  const response = await net.fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      ...(options.headers as Record<string, string>)
    }
  })

  if (response.status === 401) {
    const refreshed = await refreshAccessToken('google-drive')
    const retry = await net.fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${refreshed.access_token}`,
        ...(options.headers as Record<string, string>)
      }
    })
    if (!retry.ok) throw new Error(`Google Drive API error: ${retry.status}`)
    return retry.json()
  }

  if (!response.ok) {
    throw new Error(`Google Drive API error (${response.status}): ${await response.text()}`)
  }
  if (response.status === 204) return null
  return response.json()
}

// === READ (Low Risk) ===

export async function listFiles(
  options: {
    q?: string
    pageSize?: number
    pageToken?: string
    fields?: string
    orderBy?: string
  } = {}
): Promise<any> {
  const params = new URLSearchParams()
  if (options.q) params.set('q', options.q)
  params.set('pageSize', String(options.pageSize || 20))
  if (options.pageToken) params.set('pageToken', options.pageToken)
  params.set(
    'fields',
    options.fields ||
      'files(id,name,mimeType,modifiedTime,size,parents,shared),nextPageToken'
  )
  if (options.orderBy) params.set('orderBy', options.orderBy)

  return apiRequest(`/files?${params}`)
}

export async function getFile(fileId: string): Promise<any> {
  return apiRequest(
    `/files/${fileId}?fields=id,name,mimeType,modifiedTime,size,parents,shared,webViewLink`
  )
}

export async function downloadFile(fileId: string): Promise<Buffer> {
  const tokens = await getValidToken('google-drive')
  const response = await net.fetch(`${BASE_URL}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  })
  if (!response.ok) throw new Error(`Download failed: ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

export async function searchFiles(query: string): Promise<any> {
  return listFiles({
    q: `name contains '${query}' and trashed = false`,
    orderBy: 'modifiedTime desc'
  })
}

// === WRITE (Mid Risk) ===

export async function uploadFile(
  name: string,
  content: Buffer | string,
  mimeType: string,
  folderId?: string
): Promise<any> {
  const tokens = await getValidToken('google-drive')
  const metadata: Record<string, unknown> = { name, mimeType }
  if (folderId) metadata.parents = [folderId]

  // Simple upload for small files
  const boundary = 'attacca_boundary'
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    '',
    typeof content === 'string' ? content : content.toString('binary'),
    `--${boundary}--`
  ].join('\r\n')

  const response = await net.fetch(`${UPLOAD_URL}/files?uploadType=multipart`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`
    },
    body
  })

  if (!response.ok) throw new Error(`Upload failed: ${response.status}`)
  return response.json()
}

export async function createFolder(name: string, parentId?: string): Promise<any> {
  const metadata: Record<string, unknown> = {
    name,
    mimeType: 'application/vnd.google-apps.folder'
  }
  if (parentId) metadata.parents = [parentId]

  return apiRequest('/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(metadata)
  })
}

export async function updateFileMetadata(
  fileId: string,
  updates: { name?: string }
): Promise<any> {
  return apiRequest(`/files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  })
}

// === DELETE (High Risk) ===

export async function trashFile(fileId: string): Promise<any> {
  return apiRequest(`/files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true })
  })
}

export async function deleteFile(fileId: string): Promise<void> {
  await apiRequest(`/files/${fileId}`, { method: 'DELETE' })
}
