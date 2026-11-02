import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { CodeExecutionReport, LearningExecutionSummary } from '../services/learning'
import LearningExecutionDetails from './LearningExecutionDetails'

const Editor = lazy(() => import('./MonacoCodeEditor'))
const statuses: Record<string, string> = { COMPLETED: '실행 기록', CODE_ERROR: '코드·서버 오류', UNAVAILABLE: '실행 보류', LIMIT_EXCEEDED: '시간·자원 한도 초과' }
export default function RuntimeCodeExercise({ value, starter, path, language, scope, integrated, companion = false, revisionTag, savedRevisionTag, history, transferTask, disabled, onChange, onRun, onRestore }: {
  value: string; starter: string; path: string; language: string; scope: string; integrated: boolean; revisionTag: string; transferTask?: string | null
  companion?: boolean; disabled: boolean; onChange: (value: string) => void; onRun: (signal: AbortSignal) => Promise<CodeExecutionReport>
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
    {companion ? <p>이 API는 위 React 코드와 함께 저장·실행됩니다. 실행 버튼과 두 파일의 결과는 위 React 편집기에서 확인하세요.</p> : integrated ? <p>React와 API 두 파일을 같은 저장본으로 실행합니다. React는 import/export 없는 App()에서 React.useState/useEffect와 fetch를 사용하세요. 입력 name과 API 경로는 각 과제 설명에 맞추세요. 실패 재현본과 수정본도 각각 두 파일을 함께 실행합니다. API는 main.py의 app과 /data/learning.db를 사용합니다. {scope}</p> : language === 'jsx' ? <p>React는 실행 환경에 준비되어 있어요. import/export 없이 <code>function App()</code>에 JSX와 <code>React.useState</code>를 작성하세요. 입력 name은 본 과제에서 title, 도서 과제에서 book입니다. form의 onSubmit, 입력의 value/onChange, role="alert", li 목록을 연결하세요. state 배열을 직접 바꾸면 오류로 알려주도록 설정했습니다.</p> : <p>{scope}</p>}
    <div className="learning-html-exercise__editor"><Suspense fallback={<p>코드 편집기를 불러오는 중…</p>}><Editor path={path} value={value} readOnly={disabled || running} onChange={onChange} /></Suspense></div>
    <div className="learning-html-exercise__toolbar"><span>{value.length.toLocaleString()} / 32,000자</span>{!companion && <button type="button" disabled={disabled || running || value.length > 32000} onClick={async () => {
      const active = new AbortController(); controller.current = active
      setRunning(true); setError(''); setResultHidden(false)
      try { const result = await onRun(active.signal); if (!active.signal.aborted) { setReport(result); setRanSource(value); setRanRevision(revisionTag) } }
      catch (cause) { if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : '실행 결과를 받지 못했어요.') }
      finally { if (!active.signal.aborted) setRunning(false) }
    }}>{running ? '저장·실행 결과를 기다리는 중…' : '저장 후 실행 결과 보기'}</button>}<button type="button" onClick={() => {
      const url = URL.createObjectURL(new Blob([value], { type: 'text/plain;charset=utf-8' }))
      const link = document.createElement('a'); link.href = url; link.download = path.split('/').slice(-2).join('-'); link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }}>현재 코드 내려받기</button>{running && <button type="button" onClick={() => { controller.current?.abort(); setRunning(false); setError('결과 기다리기를 중지했어요. 서버 작업은 계속될 수 있으며 저장한 코드는 유지됩니다.') }}>결과 기다리기 중지</button>}</div>
    {!companion && history.length > 0 && <div className="learning-html-exercise__toolbar"><label>저장된 실행 기록<select value={selected?.id ?? ''} disabled={disabled || running} onChange={event => setSelectedJob(event.target.value)}>{history.map(item => <option key={item.id} value={item.id}>v{item.work_version} · {statuses[item.status] ?? item.status} · {item.is_current ? '현재 저장본' : '이전 저장본'} · {new Date(item.created_at).toLocaleString('ko-KR')}</option>)}</select></label><button disabled={disabled || running || !selected} type="button" onClick={async () => {
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
      <LearningExecutionDetails report={report} />
      <p>실행 결과를 확인하고 수업의 필수 항목을 채운 뒤 실습 확인 버튼을 누르세요. 결과를 다시 여는 동작은 실행이나 미션 완료를 새로 만들지 않아요.</p>
    </section>}
    <details><summary>처음 제공한 코드 보기</summary><pre>{starter}</pre></details>
  </details>
}
