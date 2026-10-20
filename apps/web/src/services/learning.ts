import { sessionFetch } from './session'

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''

export type LessonSummary = { id: string; slug: string; title: string; summary: string; status: string }
export type Course = {
  slug: string
  title: string
  description: string
  completed_lessons: number
  total_lessons: number
  lessons: LessonSummary[]
}
export type Concept = { slug: string; name: string; description: string }
export type Lesson = {
  id: string
  slug: string
  title: string
  summary: string
  learning_objective: string
  content: {
    scenario: string
    steps: { label: string; value: string; description: string }[]
    challenge: string
    prompts: { field: 'input' | 'process' | 'output'; label: string; placeholder: string }[]
    block_activity?: {
      instruction: string
      expected_output: string
      blocks: { id: string; label: string; code: string; description: string }[]
    }
  }
  concepts: Concept[]
  status: string
  attempts_count: number
}
export type AttemptResult = {
  completed: boolean
  status: string
  attempts_count: number
  feedback: Record<string, { correct: boolean; message: string }>
}

export class LearningRequestError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'LearningRequestError' }
}

async function request<T>(path: string, body?: unknown, method?: string, signal?: AbortSignal): Promise<T> {
  let response: Response
  try { response = await sessionFetch(`${apiBaseUrl}/api/v1/learning${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    credentials: 'include',
    signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) } catch (cause) {
    if (signal?.aborted) throw cause
    throw new LearningRequestError('WebLink 서버에 연결하지 못했어요. 작성 내용은 유지됩니다. 연결을 확인한 뒤 다시 시도해 주세요.', 0)
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: unknown } | null
    const detail = payload?.detail
    if (response.status === 401) throw new LearningRequestError('로그인이 만료되었어요. 같은 계정으로 다시 로그인한 뒤 저장해 주세요.', 401)
    if (response.status === 409) throw new LearningRequestError(typeof detail === 'string' ? detail : '다른 창에서 답안이 바뀌었어요. 최신 저장본과 비교해 주세요.', 409)
    if (typeof detail === 'string') throw new LearningRequestError(detail, response.status)
    if (Array.isArray(detail)) {
      const issue = detail.find((item) => item && typeof item === 'object') as { type?: string; loc?: unknown[]; msg?: string } | undefined
      if (issue?.type === 'string_too_long' && issue.loc?.includes('process')) {
        throw new Error('완성된 코드가 너무 길어요. 필요하지 않은 블록이 들어갔는지 확인해 주세요.')
      }
      if (issue?.type === 'missing') throw new Error('답안이 비어 있어요. 블록을 조립한 뒤 다시 확인해 주세요.')
      if (issue?.msg) throw new Error(`답안을 확인하지 못했어요: ${issue.msg}`)
    }
    throw new Error('학습 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
  }
  return response.json() as Promise<T>
}

export type Curriculum = {
  course_id: string; title: string; description: string; content_version: string; release_state: string
  units: { id: string; title: string; mission_ids: string[] }[]
  missions: { id: string; title: string; unit_id: string; available: boolean }[]
}
export type Enrollment = { id: string; course_key: string; current_node_id: string | null }
export type LearningLevel = 'BEGINNER' | 'PRACTICED' | 'EXPERIENCED'
export type LearningPath = {
  version: number; level: LearningLevel | null; source: 'SELECTED' | 'M01' | 'UNSET'
  recommended_level: LearningLevel | null; foundation_ids: string[]
  levels: { id: LearningLevel; title: string; description: string }[]
  diagnostic_status: 'NOT_STARTED' | 'PARTIAL' | 'COMPLETE'; diagnostic_version: number
  review: { id: string; label: string; correct: boolean; explanation: string }[]
}
export type WorkFeedback = { passed: boolean; issues: Record<string, string>; scope: string; checks?: { id: string; label: string; passed: boolean; message: string }[]; recommendation: { foundation_ids: string[]; message: string } | null }
export type LearningWork = {
  version: number; answers: Record<string, string>; status: string; feedback: WorkFeedback | null
  updated_at: string | null; reopened: boolean
}
export type LearningNode = {
  id: string; title: string; objective: string; prediction: string; task: string; recovery: string
  practice: { task: string; expected_observation: string }; next_ids: string[]; foundation_ids: string[]; unlocked: boolean
  fields: { id: string; label: string; kind: string; language?: string; filename?: string; run_field?: string; choices?: string[]; placeholder?: string; min_length?: number }[]
  concept_check: { id: string; prompt: string; choices: string[] }; work: LearningWork
  starter_code?: string | null
  starter_transfer_code?: string | null
  starter_files?: Record<string, string>
  runtime?: { language: string; filename: string; scope: string }
  transfer_task?: string | null
}
export type CodeExecutionReport = {
  database_rows?: unknown[][]
  database_after_restart?: unknown[][]
  restarted?: boolean
  status: string; job_id?: string; field?: string; created_at?: string; error?: string; stderr?: string; work_version: number; source_hash: string; scope: string
  checks: { id: string; label: string; passed: boolean; message: string }[]
  cases?: { input: string; prevented: boolean; value: string; items: string[]; error: string }[]
  requests?: { method: string; path: string; payload: unknown; status: number; body: unknown }[]
  tree?: unknown
}

function pauseForExecution(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('취소됨', 'AbortError')); return }
    const abort = () => { window.clearTimeout(timer); reject(new DOMException('취소됨', 'AbortError')) }
    const timer = window.setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, 1000)
    signal?.addEventListener('abort', abort, { once: true })
  })
}
export type JavaScriptReport = {
  status: string; error?: string; work_version: number; source_hash: string; scope: string
  cases: { title: string; prevented: boolean; input: string; error: string; calls: { title: string; content: string }[] }[]
  checks: { id: string; label: string; passed: boolean; message: string }[]
}
export type LearningWorkspace = {
  current_node_id: string | null; completed_ids: string[]
  missions: { id: string; title: string; unit_id: string; available: boolean; unlocked: boolean; status: string }[]
  foundations: { id: string; title: string; status: string }[]
}
export type LearningExecutionSummary = { id: string; field: string; status: string; work_version: number; created_at: string; is_current: boolean }
export type LearningProjectPreview = {
  project_id: string; project_name: string; work_version: number; expected_draft_version: number; expected_project_hash: string; scope: string
  changes: { path: string; state: 'MATCH' | 'KEEP' | 'UPDATE' | 'CONFLICT'; base: string | null; project: string | null; learning: string | null }[]
}
export type ProjectJump = { notice?: string; file_path?: string | null; cursor_line?: number | null }
export type LearningProjectContext = {
  project_id: string | null; project_name?: string; projects: { id: string; name: string }[]; active_bridge_id: string | null
  file_path?: string | null; cursor_line?: number | null
  latest: { revision_id: string; source_hash: string; files: { path: string; content: string }[] } | null
  origin: { revision_id: string; source_hash: string; files: { path: string; content: string }[] } | null
  bridges: { id: string; title: string; objective: string; concepts: string[]; observation: string; foundation_ids: string[] }[]
}
async function waitForCodeReport(initial: CodeExecutionReport, signal?: AbortSignal): Promise<CodeExecutionReport> {
  let report = initial
  for (let attempt = 0; ['QUEUED', 'RUNNING'].includes(report.status) && report.job_id && attempt < 65; attempt += 1) {
    await pauseForExecution(signal)
    report = await request<CodeExecutionReport>(`/executions/${encodeURIComponent(report.job_id)}`, undefined, undefined, signal)
  }
  if (['QUEUED', 'RUNNING'].includes(report.status)) throw new Error('아직 실행 결과를 받지 못했어요. 저장한 실행 기록에서 결과를 다시 열 수 있어요.')
  return report
}
const nodePath = (enrollmentId: string, nodeId: string) => `/enrollments/${encodeURIComponent(enrollmentId)}/nodes/${encodeURIComponent(nodeId)}`
export const curriculumService = {
  path: (id: string) => request<LearningPath>(`/enrollments/${encodeURIComponent(id)}/path`),
  savePath: (id: string, version: number, level: LearningLevel | null) => request<LearningPath>(`/enrollments/${encodeURIComponent(id)}/path`, { expected_version: version, level }, 'PUT'),
  list: () => request<Curriculum[]>('/curricula'),
  enroll: (courseKey: string) => request<Enrollment>('/enrollments', { course_key: courseKey }),
  executionHistory: (id: string, nodeId: string) => request<LearningExecutionSummary[]>(`${nodePath(id, nodeId)}/executions`),
  restoreExecution: async (jobId: string, signal?: AbortSignal) => waitForCodeReport(await request<CodeExecutionReport>(`/executions/${encodeURIComponent(jobId)}`, undefined, undefined, signal), signal),
  previewProject: (id: string, nodeId: string, expectedVersion: number, field: string) => request<LearningProjectPreview>(`${nodePath(id, nodeId)}/project/preview`, { expected_version: expectedVersion, field }),
  syncProject: (id: string, nodeId: string, expectedVersion: number, field: string, preview: LearningProjectPreview, resolutions: Record<string, 'KEEP_PROJECT' | 'USE_LEARNING'>) => request<{ project_id: string; changed: boolean; draft_version: number; message: string }>(`${nodePath(id, nodeId)}/project`, { expected_version: expectedVersion, field, expected_draft_version: preview.expected_draft_version, expected_project_hash: preview.expected_project_hash, resolutions }, 'PUT'),
  handoff: (id: string, nodeId: string, expectedVersion: number, field: string) => request<{ project_id: string; created: boolean; source_changed: boolean; message: string }>(`${nodePath(id, nodeId)}/project`, { expected_version: expectedVersion, field }),
  linkProject: (id: string, projectId: string) => request<LearningProjectContext>(`/enrollments/${id}/project-context`, { project_id: projectId }, 'PUT'),
  projectContext: (id: string) => request<LearningProjectContext>(`/enrollments/${id}/project-context`),
  bridge: (id: string, payload: { action: 'ENTER' | 'RETURN'; bridge_id?: string; revision_id?: string; file_path?: string; cursor_line?: number }) => request<LearningProjectContext>(`/enrollments/${id}/bridge`, payload),
  portfolio: (id: string) => request<Record<string, unknown>>(`/enrollments/${id}/portfolio`),
  workspace: (id: string) => request<LearningWorkspace>(`/enrollments/${id}/workspace`),
  node: (id: string, nodeId: string) => request<LearningNode>(nodePath(id, nodeId)),
  save: (id: string, nodeId: string, expectedVersion: number, answers: Record<string, string>) => request<LearningWork>(`${nodePath(id, nodeId)}/work`, { expected_version: expectedVersion, answers }, 'PUT'),
  submit: (id: string, nodeId: string, expectedVersion: number) => request<LearningWork>(`${nodePath(id, nodeId)}/submit`, { expected_version: expectedVersion }),
  hint: (id: string, nodeId: string, level: number) => request<{ level: number; text: string; recovery: string }>(`${nodePath(id, nodeId)}/hint?level=${level}`),
  run: (id: string, nodeId: string, version: number) => request<JavaScriptReport>(`${nodePath(id, nodeId)}/run`, { expected_version: version }),
  runCode: async (id: string, nodeId: string, version: number, field: string, signal?: AbortSignal): Promise<CodeExecutionReport> => {
    const report = await request<CodeExecutionReport>(`${nodePath(id, nodeId)}/run`, { expected_version: version, field }, undefined, signal)
    return waitForCodeReport(report, signal)
  },
  journey: (id: string, nodeId: string) => request<Enrollment>(`/enrollments/${id}/journey`, { current_node_id: nodeId }, 'PUT'),
}

export const learningService = {
  courses: () => request<Course[]>('/courses'),
  lesson: (courseSlug: string, lessonSlug: string) =>
    request<Lesson>(`/courses/${encodeURIComponent(courseSlug)}/lessons/${encodeURIComponent(lessonSlug)}`),
  submit: (lessonId: string, answers: { input: string; process: string; output: string }) =>
    request<AttemptResult>(`/lessons/${lessonId}/attempts`, answers),
}
