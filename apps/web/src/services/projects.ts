const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
export type RunResult = {
  id: string; project_id: string; revision_id: string
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  failure_category: string | null; exit_code: number | null
  stdout: string; stderr: string; created_at: string; started_at: string | null; completed_at: string | null
}
export type DebugSession = {
  id: string; project_id: string; run_id: string; hypothesis: string
  expected_output: string; actual_output: string; error_text: string; logs: string
  status: 'OPEN' | 'RESOLVED'; created_at: string; updated_at: string
}
export type DebugHint = { conversation_id: string; summary: string; hint: string; next_question: string }

export type ProjectSummary = {
  id: string
  name: string
  description: string
  draft_version: number
  updated_at: string
}
export type ProjectFile = { path: string; content: string }
export type ProjectRevision = {
  id: string
  revision_number: number
  parent_revision_id: string | null
  source_hash: string
  created_at: string
}
export type ProjectVersion = {
  id: string; project_id: string; version_number: number; source_revision_id: string
  name: string; description: string
  runtime_spec: { language: 'python'; version: '3.12'; dependencies: string[] }
  created_at: string
}
export type ProjectVersionDetails = ProjectVersion & { files: ProjectFile[] }
export type ProjectWorkspace = ProjectSummary & { files: ProjectFile[]; revisions: ProjectRevision[] }
export type RevisionResult = { revision: ProjectRevision; created: boolean }

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/api/v1/projects${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null
    const detail = payload?.detail ?? ''
    if (detail.includes('Draft changed')) throw new Error('초안이 다른 곳에서 변경됐습니다. 최신 초안을 불러와 다시 작업해 주세요.')
    if (detail.includes('safe relative path')) throw new Error('파일 경로는 프로젝트 폴더 안의 상대 경로여야 합니다.')
    if (detail.includes('duplicate file paths')) throw new Error('파일 경로가 중복되었습니다.')
    if (detail.includes('exceed 1 MB')) throw new Error('초안 파일의 전체 크기는 1MB를 넘을 수 없습니다.')
    throw new Error(detail || '프로젝트 요청을 처리하지 못했습니다.')
  }
  return response.json() as Promise<T>
}

export const projectService = {
  list: () => request<ProjectSummary[]>(''),
  create: (data: { name: string; description: string }) => request<ProjectWorkspace>('', 'POST', data),
  get: (projectId: string) => request<ProjectWorkspace>(`/${projectId}`),
  saveDraft: (projectId: string, expectedVersion: number, files: ProjectFile[]) =>
    request<{ project_id: string; draft_version: number; updated_at: string }>(`/${projectId}/draft`, 'PUT', {
      expected_version: expectedVersion,
      files,
    }),
  createRevision: (projectId: string) => request<RevisionResult>(`/${projectId}/revisions`, 'POST'),
  listVersions: (projectId: string) => request<ProjectVersion[]>(`/${projectId}/versions`),
  async saveVersion(projectId: string, revisionId: string, name: string): Promise<ProjectVersion> {
    return request<ProjectVersion>(`/${projectId}/versions`, 'POST', { revision_id: revisionId, name })
  },
  getVersion: (projectId: string, versionId: string) =>
    request<ProjectVersionDetails>(`/${projectId}/versions/${versionId}`),
  async restoreVersion(projectId: string, versionId: string): Promise<{ restored_revision_id: string; restored_revision_number: number; draft_version: number }> {
    return request<{ restored_revision_id: string; restored_revision_number: number; draft_version: number }>(`/${projectId}/versions/${versionId}/restore`, 'POST')
  },
  async run(projectId: string, revisionId: string): Promise<RunResult> {
    const response = await fetch(`${apiBaseUrl}/api/v1/projects/${projectId}/runs`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ revision_id: revisionId }),
    })
    if (!response.ok) throw new Error('실행 요청을 등록하지 못했습니다.')
    return response.json() as Promise<RunResult>
  },
  async getRun(projectId: string, runId: string): Promise<RunResult> {
    const response = await fetch(`${apiBaseUrl}/api/v1/projects/${projectId}/runs/${runId}`, { credentials: 'include' })
    if (!response.ok) throw new Error('실행 결과를 불러오지 못했습니다.')
    return response.json() as Promise<RunResult>
  },
  async saveDebugSession(projectId: string, runId: string, hypothesis: string, expected_output: string): Promise<DebugSession> {
    const response = await fetch(`${apiBaseUrl}/api/v1/projects/${projectId}/runs/${runId}/debug-session`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hypothesis, expected_output }),
    })
    if (!response.ok) throw new Error('디버깅 기록을 저장하지 못했습니다.')
    return response.json() as Promise<DebugSession>
  },
  async requestDebugHint(projectId: string, runId: string, hypothesis: string, expected_output: string): Promise<DebugHint> {
    const response = await fetch(`${apiBaseUrl}/api/v1/projects/${projectId}/runs/${runId}/ai/debug-hint`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hypothesis, expected_output }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { detail?: string } | null
      throw new Error(payload?.detail ?? 'AI 힌트를 가져오지 못했습니다.')
    }
    return response.json() as Promise<DebugHint>
  },
}
