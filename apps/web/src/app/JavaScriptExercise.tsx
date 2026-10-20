import { Suspense, lazy, useState } from 'react'
import { JavaScriptReport } from '../services/learning'

const Editor = lazy(() => import('./MonacoCodeEditor'))
const states: Record<string, string> = { COMPLETED: '실행 완료', CODE_ERROR: '코드 오류', LIMIT_EXCEEDED: '실행 한도 초과', UNAVAILABLE: '실행기 사용 불가' }

export default function JavaScriptExercise({ value, starter, path, disabled, onChange, onRun }: {
  value: string; starter: string; path: string; disabled: boolean; onChange: (value: string) => void
  onRun: () => Promise<JavaScriptReport>
}) {
  const [report, setReport] = useState<JavaScriptReport | null>(null)
  const [executedSource, setExecutedSource] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  return <div className="learning-js-exercise">
    <p>제공된 동기 폼 이벤트 환경에서 코드를 실행합니다. <code>submit</code>을 처리하고, 제목을 <code>trim()</code>으로 정리한 뒤 빈 값은 거부하세요. 정상 입력만 <code>savePost({'{ title, content }'})</code>로 전달합니다.</p>
    <details><summary>이 연습의 폼과 지원 API</summary><pre>{'<form id="post-form">\n  <input id="title" name="title">\n  <textarea id="content" name="content"></textarea>\n  <p id="error"></p>\n  <button type="submit">등록</button>\n</form>'}</pre><p><code>document.querySelector</code>, <code>getElementById</code>, <code>form.addEventListener('submit', 함수)</code>, 입력의 <code>value</code>, 오류의 <code>textContent</code>, <code>event.preventDefault()</code>를 사용할 수 있어요.</p><p>실행기는 이 폼 인터페이스를 제공하며 브라우저 DOM 전체를 구현하지 않습니다. 외부 통신·파일 접근·실제 DB 저장·비동기 요청은 제공하지 않아요. savePost 호출은 관찰할 기록으로 남습니다.</p></details>
    <div className="learning-html-exercise__editor"><Suspense fallback={<p>JavaScript 편집기를 불러오는 중…</p>}><Editor path={path} value={value} readOnly={disabled || running} onChange={onChange} /></Suspense></div>
    <div className="learning-html-exercise__toolbar"><span>{value.length.toLocaleString()} / 32,000자</span><button type="button" disabled={disabled || running || value.length > 32000} onClick={async () => {
      setRunning(true); setError('')
      try { const result = await onRun(); setReport(result); setExecutedSource(value) }
      catch (cause) { setError(cause instanceof Error ? cause.message : '실행하지 못했어요. 입력은 그대로 남아 있습니다.') }
      finally { setRunning(false) }
    }}>{running ? '저장한 코드를 실행하고 있어요…' : '저장 후 6가지 입력 실행'}</button><button type="button" onClick={() => {
      const url = URL.createObjectURL(new Blob([value], { type: 'text/javascript;charset=utf-8' }))
      const link = document.createElement('a'); link.href = url; link.download = 'WebLink-M04-main.js'; link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }}>JavaScript 파일 내려받기</button></div>
    {error && <p role="alert">{error}</p>}
    {report && value !== executedSource && <p role="status">실행 후 코드가 바뀌었어요. 아래 결과는 이전 코드의 결과입니다. 다시 실행해 비교하세요.</p>}
    {report && <section className="learning-js-report" aria-live="polite"><h4>{states[report.status] ?? report.status} · 저장본 v{report.work_version}</h4><p>{report.scope}</p>{report.error && <pre>{report.error}</pre>}{report.status === 'UNAVAILABLE' && <p>오답으로 판정하지 않았어요. 실행기를 사용할 수 있을 때 다시 시도하세요.</p>}{report.cases?.length > 0 && <div className="learning-js-cases">{report.cases.map((row, index) => <section key={index}><h5>입력 {index + 1} · <code>{JSON.stringify(row.title)}</code></h5><dl><dt>기본 제출 중단</dt><dd>{row.prevented ? '예' : '아니요'}</dd><dt>저장 호출</dt><dd><code>{row.calls.length ? JSON.stringify(row.calls) : '없음'}</code></dd><dt>오류 안내</dt><dd>{row.error || '(없음)'}</dd><dt>입력칸의 값</dt><dd><code>{JSON.stringify(row.input)}</code></dd></dl></section>)}</div>}<p>실행과 미션 제출은 별개예요. 결과를 관찰해 설명을 작성한 뒤 아래에서 저장·제출하세요.</p></section>}
    <details><summary>처음 제공한 코드 보기</summary><pre>{starter}</pre></details>
  </div>
}
