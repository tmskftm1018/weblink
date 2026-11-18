export const lessonPhaseLabels = {
  baseline: '오류 재현',
  practice: '코드 실습',
  transfer: '응용 실습',
  review: '실습 확인',
} as const

export type LessonPhase = keyof typeof lessonPhaseLabels

export function lessonFieldPhase(id: string, kind?: string): LessonPhase {
  if (id.startsWith('baseline_') || id === 'reproduction') return 'baseline'
  if (id.startsWith('transfer_')) return 'transfer'
  return kind === 'code' ? 'practice' : 'review'
}
