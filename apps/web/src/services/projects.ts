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
  role: 'OWNER' | 'EDITOR' | 'VIEWER'
}
export type ProjectMember = {
  user_id: string
  email: string
  display_name: string
  role: 'OWNER' | 'EDITOR' | 'VIEWER'
  created_at: string
}
export type ProjectTaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE'
export type ProjectTaskPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
export type ProjectTask = {
  id: string
  project_id: string
  title: string
  description: string
  status: ProjectTaskStatus
  priority: ProjectTaskPriority
  due_date: string | null
  assignee_id: string | null
  created_by: string
  updated_by: string | null
  created_at: string
  updated_at: string
}
export type TaskComment = { id: string; task_id: string; author_id: string | null; author_name: string; body: string; created_at: string }
export type TaskActivity = { id: string; task_id: string; actor_id: string | null; actor_name: string; message: string; created_at: string }
export type ProjectTaskActivity = TaskActivity & { task_title: string }
export type TaskDiscussion = { comments: TaskComment[]; activities: TaskActivity[] }
export type TaskChecklistItem = { id: string; task_id: string; text: string; position: number; completed: boolean; completed_by: string | null; completed_at: string | null; created_by: string; created_at: string }
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
  created_by: string
  created_at: string
}
export type ProjectVersionDetails = ProjectVersion & { files: ProjectFile[] }
export type ProjectWorkspace = ProjectSummary & { files: ProjectFile[]; revisions: ProjectRevision[] }
export type RevisionResult = { revision: ProjectRevision; created: boolean }

async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl}/api/v1/projects${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('WebLink API 요청이 브라우저에서 차단됐거나 서버에 연결하지 못했습니다. 서버 상태와 브라우저 연결 정책을 확인해 주세요.')
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: unknown } | null
    const detail = typeof payload?.detail === 'string'
      ? payload.detail
      : Array.isArray(payload?.detail)
        ? payload.detail.map((item) => item && typeof item === 'object' && 'msg' in item ? String(item.msg) : '').filter(Boolean).join(' ')
        : ''
    if (detail.includes('Draft changed')) throw new Error('초안이 다른 곳에서 변경됐습니다. 최신 초안을 불러온 뒤 내용을 확인하고 다시 시도해 주세요.')
    if (detail.includes('safe relative path')) throw new Error('파일 경로는 프로젝트 폴더 안의 안전한 상대 경로여야 합니다.')
    if (detail.includes('duplicate file paths')) throw new Error('파일 경로가 중복되었습니다.')
    if (detail.includes('exceed 1 MB')) throw new Error('초안 파일 전체 크기는 1MB 이하여야 합니다.')
    if (detail.includes('at most 200000')) throw new Error('각 프로젝트 파일은 200,000자 이하여야 합니다.')
    if (detail.includes('at most 50')) throw new Error('프로젝트 파일은 50개 이하여야 합니다.')
    throw new Error(detail || '프로젝트 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const projectService = {
  list: () => request<ProjectSummary[]>(''),
  create: (data: { name: string; description: string }) => request<ProjectWorkspace>('', 'POST', data),
  update: (projectId: string, data: { name: string; description: string }) => request<ProjectWorkspace>(`/${projectId}`, 'PUT', data),
  get: (projectId: string) => request<ProjectWorkspace>(`/${projectId}`),
  delete: (projectId: string) => request<void>(`/${projectId}`, 'DELETE'),
  listMembers: (projectId: string) => request<ProjectMember[]>(`/${projectId}/members`),
  listTasks: (projectId: string) => request<ProjectTask[]>(`/${projectId}/tasks`),
  createTask: (projectId: string, data: { title: string; description: string; assignee_id: string | null; priority: ProjectTaskPriority; due_date: string | null }) =>
    request<ProjectTask>(`/${projectId}/tasks`, 'POST', data),
  updateTask: (projectId: string, task: ProjectTask, changes: Partial<Pick<ProjectTask, 'title' | 'description' | 'status' | 'assignee_id' | 'priority' | 'due_date'>>) =>
    request<ProjectTask>(`/${projectId}/tasks/${task.id}`, 'PUT', {
      title: changes.title ?? task.title,
      description: changes.description ?? task.description,
      status: changes.status ?? task.status,
      priority: changes.priority ?? task.priority,
      due_date: changes.due_date === undefined ? task.due_date : changes.due_date,
      assignee_id: changes.assignee_id === undefined ? task.assignee_id : changes.assignee_id,
    }),
  deleteTask: (projectId: string, taskId: string) => request<void>(`/${projectId}/tasks/${taskId}`, 'DELETE'),
  listTaskActivity: (projectId: string) => request<ProjectTaskActivity[]>(`/${projectId}/tasks/activity`),
  getTaskDiscussion: (projectId: string, taskId: string) => request<TaskDiscussion>(`/${projectId}/tasks/${taskId}/discussion`),
  addTaskComment: (projectId: string, taskId: string, body: string) => request<TaskComment>(`/${projectId}/tasks/${taskId}/comments`, 'POST', { body }),
  listTaskChecklist: (projectId: string, taskId: string) => request<TaskChecklistItem[]>(`/${projectId}/tasks/${taskId}/checklist`),
  addTaskChecklistItem: (projectId: string, taskId: string, text: string) => request<TaskChecklistItem>(`/${projectId}/tasks/${taskId}/checklist`, 'POST', { text }),
  updateTaskChecklistItem: (projectId: string, taskId: string, itemId: string, completed: boolean) => request<TaskChecklistItem>(`/${projectId}/tasks/${taskId}/checklist/${itemId}`, 'PUT', { completed }),
  deleteTaskChecklistItem: (projectId: string, taskId: string, itemId: string) => request<void>(`/${projectId}/tasks/${taskId}/checklist/${itemId}`, 'DELETE'),
  addMember: (projectId: string, email: string, role: 'EDITOR' | 'VIEWER') =>
    request<ProjectMember>(`/${projectId}/members`, 'POST', { email, role }),
  updateMemberRole: (projectId: string, userId: string, role: 'EDITOR' | 'VIEWER') =>
    request<ProjectMember>(`/${projectId}/members/${userId}`, 'PUT', { role }),
  removeMember: (projectId: string, userId: string) =>
    request<void>(`/${projectId}/members/${userId}`, 'DELETE'),
  async exportArchive(projectId: string, projectName: string): Promise<void> {
    const response = await fetch(`${apiBaseUrl}/api/v1/projects/${projectId}/export`, { credentials: 'include' })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { detail?: string } | null
      throw new Error(payload?.detail ?? '프로젝트 파일을 내려받지 못했습니다.')
    }
    const blob = await response.blob()
    const safeName = projectName.trim()
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 100) || 'WebLink-Project'
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${safeName}.zip`
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
  async importArchive(projectName: string, file: File): Promise<ProjectWorkspace> {
    const response = await fetch(`${apiBaseUrl}/api/v1/projects/import?name=${encodeURIComponent(projectName)}`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/zip' }, body: file,
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { detail?: string } | null
      if (response.status === 413) throw new Error('ZIP 파일은 1.5MB 이하여야 합니다.')
      throw new Error(payload?.detail ?? 'ZIP 파일을 프로젝트로 가져오지 못했습니다.')
    }
    return response.json() as Promise<ProjectWorkspace>
  },
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
  deleteVersion: (projectId: string, versionId: string) =>
    request<void>(`/${projectId}/versions/${versionId}`, 'DELETE'),
  getVersion: (projectId: string, versionId: string) =>
    request<ProjectVersionDetails>(`/${projectId}/versions/${versionId}`),
  async restoreVersion(projectId: string, versionId: string, expectedDraftVersion: number): Promise<{ restored_revision_id: string; restored_revision_number: number; draft_version: number }> {
    return request<{ restored_revision_id: string; restored_revision_number: number; draft_version: number }>(`/${projectId}/versions/${versionId}/restore`, 'POST', { expected_draft_version: expectedDraftVersion })
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
