const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export type GoogleConnectionStatus = {
  configured: boolean
  connected: boolean
  account_email: string | null
  scopes: string[]
  connected_at: string | null
  drive_picker_configured: boolean
}

export type GitHubConnectionStatus = {
  configured: boolean
  connected: boolean
  account_name: string | null
  connected_at: string | null
}

export type GoogleDrivePickerConfig = { access_token: string; api_key: string; app_id: string }
export type GoogleDriveFile = { file_name: string; file_path: string; content: string; mime_type: string }

export type GoogleSheetValues = {
  range: string
  majorDimension: string
  values: Array<Array<string | number | boolean>>
}

async function request<T>(path: string, method = 'GET'): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/api/v1/connections${path}`, { method, credentials: 'include' })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(payload?.detail ?? '연결 요청을 처리하지 못했습니다.')
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const connectionService = {
  githubStatus: () => request<GitHubConnectionStatus>('/github'),
  connectGitHub: (token: string) => fetch(`${apiBaseUrl}/api/v1/connections/github/token`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  }).then(async (response) => {
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { detail?: string } | null
      throw new Error(payload?.detail ?? 'GitHub 연결을 저장하지 못했습니다.')
    }
    return response.json() as Promise<GitHubConnectionStatus>
  }),
  disconnectGitHub: () => request<void>('/github', 'DELETE'),
  googleStatus: () => request<GoogleConnectionStatus>('/google'),
  startGoogle: () => request<{ authorization_url: string }>('/google/oauth/start', 'POST'),
  disconnectGoogle: () => request<void>('/google', 'DELETE'),
  googleDrivePickerConfig: () => request<GoogleDrivePickerConfig>('/google/drive/picker'),
  importGoogleDriveFile: (fileId: string) => request<GoogleDriveFile>(`/google/drive/files/${encodeURIComponent(fileId)}`),
  readGoogleSheet: (spreadsheetId: string, range: string) => {
    const encodedId = encodeURIComponent(spreadsheetId.trim())
    const encodedRange = encodeURIComponent(range.trim())
    return request<GoogleSheetValues>(`/google/sheets/${encodedId}/values/${encodedRange}`)
  },
}
