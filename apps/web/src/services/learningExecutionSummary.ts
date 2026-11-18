import type { ExecutionObservation } from './learning'

export function executionSummary(report: ExecutionObservation) {
  const checks = report.checks ?? []
  const failed = checks.filter(check => !check.passed)
  const passed = checks.length - failed.length
  if (['UNAVAILABLE', 'LIMIT_EXCEEDED', 'QUEUED', 'RUNNING'].includes(report.status)) {
    return { title: report.status === 'LIMIT_EXCEEDED' ? '실행 시간이나 자원 한도에 도달했어요' : report.status === 'UNAVAILABLE' ? '지금은 실행 결과를 확인할 수 없어요' : '아직 실행 결과를 기다리고 있어요', detail: '이 상태만으로 코드가 틀렸다고 판단하지 않아요. 실행 상태와 오류 안내를 확인해 주세요.', failed: [], passed: 0, total: 0 }
  }
  if (report.status === 'CODE_ERROR' || report.error) {
    return { title: '코드 실행 중 확인할 문제가 있어요', detail: report.error ? report.error.slice(0, 200) : '아래 실패 항목과 오류 원문을 확인하고 코드로 돌아가세요.', failed, passed, total: checks.length }
  }
  if (!checks.length) return { title: '실행 결과를 받았어요', detail: '저장·제출 여부와 별개예요. 아래 실제 출력과 수업의 성공 조건을 비교하세요.', failed, passed, total: 0 }
  return { title: failed.length ? `${checks.length}개 중 ${failed.length}개 동작을 더 확인해요` : `실행 검사 ${checks.length}개를 모두 통과했어요`, detail: failed.length ? '아래에서 맞지 않은 동작부터 보고 코드로 돌아가세요.' : '이 실행의 검사 결과예요. 수업 완료는 개념 답과 필수 과제를 제출한 뒤 확인합니다.', failed, passed, total: checks.length }
}
