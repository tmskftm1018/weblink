export const setupSteps = ['내 목표와 도움 선택', '현재 이해도 확인', '저장하고 다시 열기']

export function setupFieldStep(id: string) {
  if (id.startsWith('diagnostic_')) return 1
  if (['concept_answer', 'reopen'].includes(id)) return 2
  return 0
}
