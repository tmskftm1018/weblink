import { Suspense, lazy, useRef, useState } from 'react'
import { JavaScriptReport } from '../services/learning'
import LearningExecutionDetails from './LearningExecutionDetails'

const Editor = lazy(() => import('./MonacoCodeEditor'))
const states: Record<string, string> = { COMPLETED: '실행 완료', CODE_ERROR: '코드 오류', LIMIT_EXCEEDED: '실행 한도 초과', UNAVAILABLE: '실행기 사용 불가' }

export default function JavaScriptExercise({ value, starter, path, disabled, onChange, onRun }: {
  value: string; starter: string; path: string; disabled: boolean; onChange: (value: string) => void
  onRun: () => Promise<JavaScriptReport>
}) {
  const editorRoot = useRef<HTMLDivElement>(null)
  const [report, setReport] = useState<JavaScriptReport | null>(null)
  const [executedSource, setExecutedSource] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [resultHidden, setResultHidden] = useState(false)
  return <div className="learning-js-exercise">
    <div className="journal-editor">
      <div className="journal-editor__bar"><span className="journal-editor__file">{path.split('/').pop()}</span><button className="learning-studio__primary" type="button" disabled={disabled || running || value.length > 32000} onClick={async () => {
      setRunning(true); setError(''); setResultHidden(false)
      try { const result = await onRun(); setReport(result); setExecutedSource(value) }
      catch (cause) { setError(cause instanceof Error ? cause.message : '실행하지 못했어요. 입력은 그대로 남아 있습니다.') }
      finally { setRunning(false) }
    }}>{running ? '저장한 코드를 실행하고 있어요…' : '실행하기'}</button></div>
    <div className="learning-html-exercise__editor" ref={editorRoot} tabIndex={-1}><Suspense fallback={<p>JavaScript 편집기를 불러오는 중…</p>}><Editor path={path} value={value} readOnly={disabled || running} onChange={onChange} /></Suspense></div>
    </div>
    {!report && <section className="journal-result-placeholder"><strong>실행 결과</strong><span>제목을 바꿔 여섯 가지 입력을 검사해요.</span></section>}
    {error && <p role="alert">{error}</p>}
    {report && !resultHidden && value !== executedSource && <p role="status">실행 후 코드가 바뀌었어요. 아래 결과는 이전 코드의 결과입니다. 다시 실행해 비교하세요.</p>}
    {report && resultHidden && <button type="button" onClick={() => setResultHidden(false)}>마지막 실행 결과 다시 펼치기 · 새 실행 없음</button>}{report && !resultHidden && <section className="learning-js-report" aria-live="polite"><button type="button" className="learning-result-close" onClick={() => setResultHidden(true)}>실행 결과 닫기</button><h4>{states[report.status] ?? report.status} · v{report.work_version}</h4><details><summary>실행 범위와 제한</summary><p>{report.scope}</p></details><LearningExecutionDetails report={report} /><button type="button" onClick={() => (editorRoot.current?.querySelector<HTMLElement>('[role="textbox"]') ?? editorRoot.current)?.focus()}>코드로 돌아가기</button></section>}
    <details className="journal-editor__more"><summary>코드 안내 및 내려받기</summary>
    <details><summary>이 연습의 폼과 지원 API</summary><pre>{'<form id="post-form">\n  <input id="title" name="title">\n  <textarea id="content" name="content"></textarea>\n  <p id="error"></p>\n  <button type="submit">등록</button>\n</form>'}</pre><p><code>document.querySelector</code>, <code>getElementById</code>, <code>form.addEventListener('submit', 함수)</code>, 입력의 <code>value</code>, 오류의 <code>textContent</code>, <code>event.preventDefault()</code>를 사용할 수 있어요.</p><p>실행기는 이 폼 인터페이스를 제공하며 브라우저 DOM 전체를 구현하지 않습니다. 외부 통신·파일 접근·실제 DB 저장·비동기 요청은 제공하지 않아요. savePost 호출은 관찰할 기록으로 남습니다.</p></details>

      <button type="button" onClick={() => {
      const url = URL.createObjectURL(new Blob([value], { type: 'text/javascript;charset=utf-8' }))
      const link = document.createElement('a'); link.href = url; link.download = '우리들의 개발일지-M04-main.js'; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }}>JavaScript 파일 내려받기</button>
    <details><summary>처음 제공한 코드 보기</summary><pre>{starter}</pre></details>
    </details>
  </div>
}
