const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

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

async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/api/v1/learning${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: unknown } | null
    const detail = payload?.detail
    if (typeof detail === 'string') throw new Error(detail)
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

export const learningService = {
  courses: () => request<Course[]>('/courses'),
  lesson: (courseSlug: string, lessonSlug: string) =>
    request<Lesson>(`/courses/${encodeURIComponent(courseSlug)}/lessons/${encodeURIComponent(lessonSlug)}`),
  submit: (lessonId: string, answers: { input: string; process: string; output: string }) =>
    request<AttemptResult>(`/lessons/${lessonId}/attempts`, answers),
}
