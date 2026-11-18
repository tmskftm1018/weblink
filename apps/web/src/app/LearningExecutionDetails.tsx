import { createElement, Fragment, ReactNode } from 'react'
import { ExecutionObservation } from '../services/learning'
import { httpResultExplanation } from '../services/learningGuidance'
import { executionSummary } from '../services/learningExecutionSummary'

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
  const summary = executionSummary(report)
  return <>
    <section aria-label="실행 결과 요약"><h5>{summary.title}</h5><p>{summary.detail}</p>{showChecks && summary.failed.length > 0 && <ul className="learning-html-checks">{summary.failed.map(check => <li key={check.id}><strong>확인 필요 · {check.label}</strong><span>{check.message}</span></li>)}</ul>}</section>
    {report.error && <details><summary>오류 원문 보기</summary><pre>{report.error}</pre></details>}
    {report.stderr && <details><summary>학습 서버 오류 자세히 보기</summary><pre>{report.stderr}</pre></details>}
    {report.status === 'UNAVAILABLE' && <p>실행 환경을 사용할 수 없어 학습자 오답으로 판정하지 않았어요.</p>}
    {report.tree !== undefined && <details open><summary>실행한 화면</summary><div className="learning-react-snapshot">{snapshot(report.tree)}</div><p>마지막 실행에서 캡처한 화면이에요.</p></details>}
    {!!report.cases?.length && <><h5>입력을 바꿨을 때 실제로 일어난 일</h5><div className="learning-result-table"><table><thead><tr><th scope="col">넣은 값</th><th scope="col">실제 동작</th><th scope="col">화면의 오류 안내</th></tr></thead><tbody>{report.cases.map((row, index) => <tr key={index}><td><code>{JSON.stringify('title' in row ? row.title : row.input)}</code></td><td>{'calls' in row ? `저장 요청 ${row.calls.length}회` : `목록 ${row.items.length}개 · ${JSON.stringify(row.items)}`}</td><td>{row.error || '없음'}</td></tr>)}</tbody></table></div><details><summary>입력별 실행 원문</summary><pre>{JSON.stringify(report.cases, null, 2)}</pre></details></>}
    {report.database_rows && <details open><summary>SQLite에 저장된 데이터</summary><pre>{JSON.stringify(report.database_rows, null, 2)}</pre><p>실행 검사에서 DB를 직접 읽은 결과예요.</p></details>}
    {report.restarted && <details open><summary>서버 재시작 후 SQLite 행</summary><pre>{JSON.stringify(report.database_after_restart, null, 2)}</pre><p>서버를 다시 시작한 뒤 읽은 DB 결과예요. 저장 전후의 행을 비교하세요.</p></details>}
    {!!report.requests?.length && <div className="learning-http-trace"><p>요청은 API에 보낸 내용, 응답은 서버가 돌려준 결과입니다. 예상한 실패 요청은 입력 검증을 확인하는 사례일 수 있어요.</p>{report.requests.map((row, index) => <details key={index}><summary><code>{row.method} {row.path}</code> · HTTP {row.status}</summary><p>{httpResultExplanation(row.status)}</p><strong>보낸 값 · 요청</strong><pre>{JSON.stringify(row.payload, null, 2) ?? '(요청 본문 없음)'}</pre><strong>돌아온 값 · 응답</strong><pre>{JSON.stringify(row.body, null, 2) ?? '(응답 본문 없음)'}</pre></details>)}</div>}
    {showChecks && !!report.checks?.length && <details><summary>전체 검사 항목 · {summary.passed}/{summary.total} 통과</summary><ul className="learning-html-checks">{report.checks.map(check => <li key={check.id}><strong>{check.passed ? '✓' : '확인 필요'} · {check.label}</strong><span>{check.message}</span></li>)}</ul></details>}
  </>
}
