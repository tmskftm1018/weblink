/** Translate current-course validation failures without exposing submitted values. */
export function learningValidationMessage(path: string, detail: unknown): string | null {
  if (!path.startsWith('/enrollments') || !Array.isArray(detail)) return null
  const issue = detail.find(item => item && typeof item === 'object') as { type?: string; loc?: unknown[]; ctx?: Record<string, unknown> } | undefined
  if (!issue) return '요청한 학습 내용을 확인하지 못했어요. 입력 항목을 확인한 뒤 다시 시도해 주세요.'
  const location = issue.loc ?? []
  const names: Record<string, string> = {
    source: '본 과제 코드', api_source: '본 과제 API 코드',
    baseline_source: '실패 재현 코드', baseline_api_source: '실패 재현 API 코드',
    transfer_source: '응용 코드', transfer_api_source: '응용 API 코드',
    reproduction: '실패 재현 설명', architecture_explanation: '연결 원리 설명',
    concept_answer: '개념 답', subject_ids: '배울 과목', level: '난이도',
  }
  const field = location.filter((part): part is string => typeof part === 'string').reverse().find(part => Object.prototype.hasOwnProperty.call(names, part))
  const label = field ? names[field] : location.includes('answers') ? '답안' : '학습 설정'
  const limit = issue.ctx?.max_length ?? issue.ctx?.min_length
  const amount = typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? `${limit.toLocaleString('ko-KR')}자` : null
  if (issue.type === 'value_error' && location.includes('answers')) return '답안의 길이를 확인해 주세요. 코드는 항목마다 32,000자, 나머지 작성 항목은 각각 4,000자까지 저장할 수 있어요. 작성 내용은 편집기에 유지됩니다.'
  if (issue.type === 'string_too_long') return `${label} 입력이 너무 길어요.${amount ? ` ${amount} 이내로 줄여 주세요.` : ' 입력 길이를 줄여 주세요.'} 작성 내용은 편집기에 유지됩니다.`
  if (issue.type === 'string_too_short') return `${label} 내용을${amount ? ` ${amount} 이상` : ''} 작성해 주세요. 현재 입력은 유지됩니다.`
  if (issue.type === 'missing') return `${label}에 필요한 값이 빠졌어요. 선택하거나 작성한 뒤 다시 확인해 주세요.`
  return `${label}의 입력 형식을 확인해 주세요. 선택 항목은 화면의 보기에서 골라 주세요. 작성 내용은 유지됩니다.`
}
