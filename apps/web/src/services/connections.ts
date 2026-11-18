import { sessionFetch } from './session'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''

export type GitHubConnectionStatus = {
  configured: boolean
  connected: boolean
  account_name: string | null
  connected_at: string | null
}

async function request<T>(path: string, method = 'GET'): Promise<T> {
  const response = await sessionFetch(`${apiBaseUrl}/api/v1/connections${path}`, { method, credentials: 'include' })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(payload?.detail ?? '연결 요청을 처리하지 못했습니다.')
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const connectionService = {
  githubStatus: () => request<GitHubConnectionStatus>('/github'),
  connectGitHub: (token: string) => sessionFetch(`${apiBaseUrl}/api/v1/connections/github/token`, {
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

}
