import type { LearningNode, LearningWork, LearningWorkspace, WorkFeedback } from './learning'

export type SubmissionGap = { id: string; label: string; message: string }

export function savedExecutionEvidence(work: LearningWork, dirty: boolean) {
  if (dirty || !work.version || !['PASSED', 'NEEDS_WORK'].includes(work.status) || !work.feedback) return []
  const records = [
    { field: 'baseline_source', label: '실패 재현본', report: work.feedback.baseline },
    { field: 'source', label: work.feedback.baseline ? '수정본' : '본 과제', report: work.feedback.execution },
    { field: 'transfer_source', label: '다른 문제에 적용한 과제', report: work.feedback.transfer },
  ]
  return records.flatMap(item => item.report ? [{ ...item, report: item.report }] : [])
}

export function httpResultExplanation(status: number): string {
  if (status === 200) return '서버가 요청을 처리하고 결과를 응답했어요.'
  if (status === 201) return '서버가 자료를 새로 등록했어요.'
  if (status === 400 || status === 422) return '서버가 요청을 거절했어요. 보낸 값과 입력 규칙을 비교해 보세요.'
  if (status === 404) return '요청한 API 경로나 자료를 찾지 못했어요. 주소와 경로를 확인하세요.'
  if (status >= 500) return '서버 처리 중 오류가 났어요. 서버 오류 안내를 함께 확인하세요.'
  return '요청과 응답 값을 비교하고 이 상태 코드가 과제의 예상 결과와 맞는지 확인하세요.'
}

/** Presence checks only. Correctness and completion remain server decisions. */
export function submissionGaps(node: LearningNode, answers: Record<string, string>, work: LearningWork): SubmissionGap[] {
  const transfer = node.assignment.transfer_required || answers.transfer_mode === '전이 과제도 도전하기'
  const gaps: SubmissionGap[] = []
  for (const field of node.fields) {
    if (field.practice_note || (field.optional && !(node.assignment.has_transfer && transfer && field.id.startsWith('transfer_')))) continue
    const value = (answers[field.id] ?? '').trim()
    if (field.kind === 'choice' ? !field.choices?.includes(value) : Array.from(value).length < (field.min_length ?? 1)) {
      gaps.push({ id: field.id, label: field.label, message: field.kind === 'choice' ? '보기에서 하나를 선택해 주세요.' : `${field.min_length ?? 1}자 이상 ${field.kind === 'code' ? '코드를 작성해 주세요.' : '구체적으로 적어 주세요.'}` })
    }
  }
  if (!node.concept_check.choices.includes(answers.concept_answer ?? '')) gaps.push({ id: 'concept_answer', label: '개념 확인', message: '답을 하나 선택해 주세요. 정답 여부는 제출할 때 확인합니다.' })
  if (node.id === 'M01' && !work.reopened) gaps.push({ id: 'reopen', label: '저장본 다시 열기', message: '지금 저장한 설정을 다시 불러온 뒤 실습을 확인해 주세요.' })
  return gaps
}

/** Keep recovery on its original work; otherwise lead to an unfinished, open mission. */
export function continuationId(workspace: LearningWorkspace, currentId: string, recovery: boolean): string {
  if (recovery) return currentId
  const current = workspace.missions.find(item => item.id === currentId)
  const foundation = workspace.foundations.find(item => item.id === currentId)
  if (foundation && foundation.status !== 'PASSED') return foundation.id
  if (current && current.status !== 'PASSED' && current.available && current.unlocked) return current.id
  return workspace.missions.find(item => item.available && item.unlocked && item.status !== 'PASSED')?.id
    ?? workspace.missions.find(item => item.id === 'M10' && item.available && item.unlocked)?.id
    ?? currentId
}

export function aiHelpContext(node: LearningNode, answers: Record<string, string>, includeAnswers: boolean, feedback: WorkFeedback | null): string {
  const guide = node.practice_guide
  const raw = [
    `나는 WebLink에서 ${node.id} · ${node.title} 수업을 진행하고 있어요.`,
    `목표: ${node.objective}`,
    `과제: ${node.task}`,
    `현재 과제 기준: ${node.assignment.title}`,
    ...(guide ? [`완성할 결과: ${guide.outcome}`, `성공 조건: ${guide.expected}`, `먼저 확인할 점: ${guide.troubleshooting}`] : []),
    '완성 코드를 한꺼번에 주기보다, 먼저 어디를 바꿀지와 이유를 짧게 알려 주세요. 필요한 작은 코드 예시와 실행 후 확인할 결과를 함께 제시해 주세요. 예측이나 긴 설명을 반복해서 쓰게 하지 말아 주세요.',
    ...(includeAnswers ? [
      '\n내가 작성한 내용:',
      ...node.fields.filter(field => !field.practice_note && (answers[field.id] ?? '').trim()).map(field => `${field.label}: ${answers[field.id]}`),
      ...(answers.concept_answer ? [`개념 확인에서 선택한 값: ${answers.concept_answer}`] : []),
      ...(feedback && !feedback.passed ? ['\n현재 확인할 문제:', ...Object.entries(feedback.issues).map(([id, issue]) => `${node.fields.find(field => field.id === id)?.label ?? id}: ${issue}`)] : []),
      ...(feedback && !feedback.passed ? (feedback.checks ?? []).filter(check => !check.passed).map(check => `${check.label}: ${check.message}`) : []),
    ] : []),
  ].join('\n')
  return raw.replace(/(?:AIza[\w-]{20,}|sk-[\w-]{16,}|gh[pousr]_[\w]{16,})/g, '[비밀값 가림]')
    .replace(/((?:password|api[_ -]?key|token|secret|비밀번호)\s*[:=]\s*)\S+/gi, '$1[비밀값 가림]')
}
