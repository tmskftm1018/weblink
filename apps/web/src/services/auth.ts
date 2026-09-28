const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export type User = { id: string; email: string; display_name: string }

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/api/v1/auth${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(payload?.detail ?? '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const authService = {
  me: () => request<User>('/me'),
  signup: (data: { email: string; password: string; display_name: string }) => request<User>('/signup', data),
  login: (data: { email: string; password: string }) => request<User>('/login', data),
  logout: () => request<void>('/logout', {}),
}
