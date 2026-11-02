import { createElement, Fragment, ReactNode } from 'react'
import { ExecutionObservation } from '../services/learning'
import { httpResultExplanation } from '../services/learningGuidance'

const snapshotTags = new Set(['div', 'p', 'span', 'h1', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'small', 'input', 'textarea', 'button', 'br'])

function snapshot(node: unknown, depth = 0): ReactNode {
  if (depth > 24) return null
  if (typeof node === 'string' || typeof node === 'number') return node
  if (Array.isArray(node)) return node.slice(0, 100).map((child, index) => <Fragment key={index}>{snapshot(child, depth + 1)}</Fragment>)
  if (!node || typeof node !== 'object' || !('type' in node)) return null
  const data = node as { type: string; props?: Record<string, unknown>; children?: unknown[] }
  const type = data.type === 'form' ? 'div' : data.type === 'label' ? 'p' : data.type
  if (!snapshotTags.has(type)) return null
  const props: Record<string, unknown> = {}
  if (type === 'button') { props.type = 'button'; props.disabled = true }
  if (type === 'input' || type === 'textarea') {
    props.readOnly = true
    props.value = typeof data.props?.value === 'string' ? data.props.value : ''
    props['aria-label'] = typeof data.props?.name === 'string' ? data.props.name : '실행된 입력값'
  }
  if (type === 'input' || type === 'br') return createElement(type, props)
  return createElement(type, props, type === 'textarea' ? undefined : (data.children ?? []).slice(0, 100).map((child, index) => <Fragment key={index}>{snapshot(child, depth + 1)}</Fragment>))
}

/** Displays existing evidence only; opening details never requests an execution. */
export default function LearningExecutionDetails({ report, showChecks = true }: { report: ExecutionObservation; showChecks?: boolean }) {
  return <>
    {report.error && <pre>{report.error}</pre>}
    {report.stderr && <details><summary>학습 서버 오류 자세히 보기</summary><pre>{report.stderr}</pre></details>}
    {report.status === 'UNAVAILABLE' && <p>실행 환경을 사용할 수 없어 학습자 오답으로 판정하지 않았어요.</p>}
    {report.tree !== undefined && <details open><summary>React가 렌더링한 마지막 화면 · 읽기 전용 스냅샷</summary><div className="learning-react-snapshot">{snapshot(report.tree)}</div><p>마지막 실행의 정적인 결과예요. 여기서 입력하거나 등록하는 실제 앱 화면은 아닙니다.</p></details>}
    {!!report.cases?.length && <div className="learning-js-cases">{report.cases.map((row, index) => <section key={index}><h5>입력 {index + 1} · <code>{JSON.stringify('title' in row ? row.title : row.input)}</code></h5><p>기본 제출 중단: {row.prevented ? '예' : '아니요'}</p>{'calls' in row ? <><p>저장 호출: <code>{row.calls.length ? JSON.stringify(row.calls) : '없음'}</code></p><p>입력칸의 값: <code>{JSON.stringify(row.input)}</code></p></> : <p>목록: {JSON.stringify(row.items)}</p>}<p>오류 안내: {row.error || '(없음)'}</p></section>)}</div>}
    {report.database_rows && <details open><summary>실제 SQLite에 저장된 행 · ID / 저장한 값</summary><pre>{JSON.stringify(report.database_rows, null, 2)}</pre><p>화면의 목록과 별개로 실행 검사에서 읽은 DB 결과입니다.</p></details>}
    {report.restarted && <details open><summary>서버 재시작 후 SQLite 행</summary><pre>{JSON.stringify(report.database_after_restart, null, 2)}</pre><p>서버를 다시 시작한 뒤 읽은 DB 결과예요. 저장 전후의 행을 비교하세요.</p></details>}
    {!!report.requests?.length && <div className="learning-http-trace"><p>요청은 API에 보낸 내용, 응답은 서버가 돌려준 결과입니다. 예상한 실패 요청은 입력 검증을 확인하는 사례일 수 있어요.</p>{report.requests.map((row, index) => <details key={index}><summary><code>{row.method} {row.path}</code> · HTTP {row.status}</summary><p>{httpResultExplanation(row.status)}</p><strong>보낸 값 · 요청</strong><pre>{JSON.stringify(row.payload, null, 2) ?? '(요청 본문 없음)'}</pre><strong>돌아온 값 · 응답</strong><pre>{JSON.stringify(row.body, null, 2) ?? '(응답 본문 없음)'}</pre></details>)}</div>}
    {showChecks && !!report.checks?.length && <ul className="learning-html-checks">{report.checks.map(check => <li key={check.id}><strong>{check.passed ? '✓' : '확인 필요'} · {check.label}</strong><span>{check.message}</span></li>)}</ul>}
  </>
}
