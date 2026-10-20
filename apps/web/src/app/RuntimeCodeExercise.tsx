import { createElement, Fragment, lazy, ReactNode, Suspense, useEffect, useRef, useState } from 'react'
import { CodeExecutionReport, LearningExecutionSummary } from '../services/learning'

const Editor = lazy(() => import('./MonacoCodeEditor'))
const statuses: Record<string, string> = { COMPLETED: '실행 기록', CODE_ERROR: '코드·서버 오류', UNAVAILABLE: '실행 보류', LIMIT_EXCEEDED: '시간·자원 한도 초과' }
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

export default function RuntimeCodeExercise({ value, starter, path, language, scope, integrated, revisionTag, savedRevisionTag, history, transferTask, disabled, onChange, onRun, onRestore }: {
  value: string; starter: string; path: string; language: string; scope: string; integrated: boolean; revisionTag: string; transferTask?: string | null
  disabled: boolean; onChange: (value: string) => void; onRun: (signal: AbortSignal) => Promise<CodeExecutionReport>
  savedRevisionTag: string; history: LearningExecutionSummary[]; onRestore: (id: string, signal: AbortSignal) => Promise<CodeExecutionReport>
}) {
  const [report, setReport] = useState<CodeExecutionReport | null>(null)
  const [ranSource, setRanSource] = useState('')
  const [ranRevision, setRanRevision] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [selectedJob, setSelectedJob] = useState('')
  const [resultHidden, setResultHidden] = useState(false)
  const selected = history.find(item => item.id === selectedJob) ?? history[0]
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  return <details className="learning-js-exercise" open={!transferTask}>
    <summary>{transferTask ? '전이 과제 · 코드와 실행 결과 펼치기' : '코드 편집·실행'}</summary>
    {transferTask && <p className="learning-studio__notice">{transferTask}</p>}
    {integrated ? <p>React와 API 두 파일을 같은 저장본으로 실행합니다. React는 import/export 없는 App()에서 React.useState/useEffect와 fetch를 사용하세요. 입력 name과 API 경로는 각 과제 설명에 맞추세요. 실패 재현본과 수정본도 각각 두 파일을 함께 실행합니다. API는 main.py의 app과 /data/learning.db를 사용합니다.{scope}</p> : language === 'jsx' ? <p>React는 실행 환경에 준비되어 있어요. import/export 없이 <code>function App()</code>에 JSX와 <code>React.useState</code>를 작성하세요. 입력 name은 본 과제에서 title, 도서 과제에서 book입니다. form의 onSubmit, 입력의 value/onChange, role="alert", li 목록을 연결하세요. state 배열을 직접 바꾸면 오류로 알려주도록 설정했습니다.</p> : <p>{scope} Python 코드와 실행 결과는 저장되며, 연습용 DB와 서버의 데이터는 전체 실행이 끝나면 정리됩니다.</p>}
    <div className="learning-html-exercise__editor"><Suspense fallback={<p>코드 편집기를 불러오는 중…</p>}><Editor path={path} value={value} readOnly={disabled || running} onChange={onChange} /></Suspense></div>
    <div className="learning-html-exercise__toolbar"><span>{value.length.toLocaleString()} / 32,000자</span><button type="button" disabled={disabled || running || value.length > 32000} onClick={async () => {
      const active = new AbortController(); controller.current = active
      setRunning(true); setError(''); setResultHidden(false)
      try { const result = await onRun(active.signal); if (!active.signal.aborted) { setReport(result); setRanSource(value); setRanRevision(revisionTag) } }
      catch (cause) { if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : '실행 결과를 받지 못했어요.') }
      finally { if (!active.signal.aborted) setRunning(false) }
    }}>{running ? '저장·실행 결과를 기다리는 중…' : '저장 후 실행 결과 보기'}</button><button type="button" onClick={() => {
      const url = URL.createObjectURL(new Blob([value], { type: 'text/plain;charset=utf-8' }))
      const link = document.createElement('a'); link.href = url; link.download = path.split('/').slice(-2).join('-'); link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }}>현재 코드 내려받기</button>{running && <button type="button" onClick={() => { controller.current?.abort(); setRunning(false); setError('결과 기다리기를 중지했어요. 서버 작업은 계속될 수 있으며 저장한 코드는 유지됩니다.') }}>결과 기다리기 중지</button>}</div>
    {history.length > 0 && <div className="learning-html-exercise__toolbar"><label>저장된 실행 기록<select value={selected?.id ?? ''} disabled={disabled || running} onChange={event => setSelectedJob(event.target.value)}>{history.map(item => <option key={item.id} value={item.id}>v{item.work_version} · {statuses[item.status] ?? item.status} · {item.is_current ? '현재 저장본' : '이전 저장본'} · {new Date(item.created_at).toLocaleString('ko-KR')}</option>)}</select></label><button disabled={disabled || running || !selected} type="button" onClick={async () => {
      if (!selected) return
      const active = new AbortController(); controller.current = active
      setRunning(true); setError(''); setResultHidden(false)
      try { const result = await onRestore(selected.id, active.signal); if (!active.signal.aborted) { setReport(result); setRanRevision(selected.is_current ? savedRevisionTag : ''); setRanSource(selected.is_current && savedRevisionTag === revisionTag ? value : '') } }
      catch (cause) { if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : '실행 기록을 읽지 못했어요.') }
      finally { if (!active.signal.aborted) setRunning(false) }
    }}>선택한 결과 다시 열기 · 새 실행 없음</button></div>}
    {error && <p role="alert">{error}</p>}
    {report && resultHidden && <button type="button" onClick={() => setResultHidden(false)}>마지막 실행 결과 다시 펼치기 · 새 실행 없음</button>}
    {report && !resultHidden && <section className="learning-js-report" aria-live="polite">
      <button type="button" className="learning-result-close" onClick={() => setResultHidden(true)}>실행 결과 닫기</button>
      <h4>{statuses[report.status] ?? report.status} · 저장본 v{report.work_version}</h4>
      <p>{report.scope}</p>
      {(value !== ranSource || ranRevision !== revisionTag) && <p>코드 또는 함께 저장하는 답안이 바뀌었어요. 아래는 이전 저장본의 결과이며 다시 실행해 확인할 수 있어요.</p>}
      <button type="button" onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' }))
        const link = document.createElement('a'); link.href = url; link.download = `WebLink-실행-v${report.work_version}.json`; link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      }}>이 실행 결과 내려받기</button>
      {report.error && <pre>{report.error}</pre>}
      {report.stderr && <details><summary>학습 서버 오류 자세히 보기</summary><pre>{report.stderr}</pre></details>}
      {report.status === 'UNAVAILABLE' && <p>학습자 오답으로 판정하지 않았습니다.</p>}
      {report.tree !== undefined && <details open><summary>React가 렌더링한 마지막 화면 · 읽기 전용 스냅샷</summary><div className="learning-react-snapshot">{snapshot(report.tree)}</div></details>}
      {report.cases && <div className="learning-js-cases">{report.cases.map((row, index) => <section key={index}><h5>입력 {JSON.stringify(row.input)}</h5><p>기본 제출 중단: {row.prevented ? '예' : '아니요'}</p><p>목록: {JSON.stringify(row.items)}</p><p>오류: {row.error || '(없음)'}</p></section>)}</div>}
      {report.database_rows && <details open><summary>별도 검사기가 읽은 실제 SQLite 행 · ID / 저장한 값</summary><pre>{JSON.stringify(report.database_rows, null, 2)}</pre></details>}
      {report.restarted && <details open><summary>서버 재시작 완료 · 재시작 후 SQLite 행</summary><pre>{JSON.stringify(report.database_after_restart, null, 2)}</pre><p>마지막 GET 요청은 서버 재시작 후의 응답입니다.</p></details>}
      {report.requests && <div className="learning-http-trace">{report.requests.map((row, index) => <details key={index}><summary><code>{row.method} {row.path}</code> · HTTP {row.status}</summary><pre>{JSON.stringify({ request: row.payload, response: row.body }, null, 2)}</pre></details>)}</div>}
      {report.checks.length > 0 && <ul className="learning-html-checks">{report.checks.map(check => <li key={check.id}><strong>{check.passed ? '✓' : '확인 필요'} · {check.label}</strong><span>{check.message}</span></li>)}</ul>}
      <p>실행 결과를 관찰해 설명을 작성한 뒤 저장·제출하세요. 결과를 다시 여는 동작은 실행이나 미션 완료를 새로 만들지 않아요.</p>
    </section>}
    <details><summary>처음 제공한 코드 보기</summary><pre>{starter}</pre></details>
  </details>
}
