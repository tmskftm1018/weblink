import { MutableRefObject, useEffect, useRef, useState } from 'react'
import { Curriculum, Enrollment, LearningExecutionSummary, LearningNode, LearningWork, LearningWorkspace, ProjectJump, curriculumService } from '../services/learning'
import './LearningStudio.css'
import HtmlFormExercise from './HtmlFormExercise'
import JavaScriptExercise from './JavaScriptExercise'
import RuntimeCodeExercise from './RuntimeCodeExercise'
import LearningProjectBridge from './LearningProjectBridge'
import LearningProjectUpdate from './LearningProjectUpdate'

const statusLabels: Record<string, string> = { NOT_STARTED: '시작 전', DRAFT: '작성 중', PASSED: '확인 완료', NEEDS_WORK: '다시 살펴보기', STALE: '수정 후 재확인 필요' }
const message = (cause: unknown) => cause instanceof Error ? cause.message : '요청을 처리하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.'
const draftKey = (userId: string, enrollmentId: string, nodeId: string) => `weblink.learning-draft:${userId}:${enrollmentId}:${nodeId}`

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: filename.endsWith('.json') ? 'application/json' : 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function FoundationPractice({ id }: { id: string }) {
  const [value, setValue] = useState(id === 'C01' ? '7' : id === 'C03' ? '첫 글,둘째 글,셋째 글' : '')
  const [result, setResult] = useState<string | null>(null)
  const [fixed, setFixed] = useState(false)
  if (id === 'C01') return <div className="learning-demo"><label>score에 저장할 값<input type="number" min={-10000} max={10000} value={value} onChange={(event) => { setValue(event.target.value); setResult(null) }} /></label><pre>score = {value || '0'}{'\n'}score + 2</pre><button type="button" onClick={() => setResult(String(Number(value) + 2))}>2를 더한 결과 확인</button>{result !== null && <output>결과: {result}</output>}</div>
  if (id === 'C02') return <div className="learning-demo"><label>게시글 제목<input value={value} onChange={(event) => { setValue(event.target.value); setResult(null) }} placeholder="공백만 넣었을 때도 비교해 보세요" /></label><pre>title.trim().length &gt; 0</pre><button type="button" onClick={() => setResult(value.trim() ? `등록 가능한 제목: ${value.trim()}` : '빈 제목은 등록할 수 없어요.')}>입력 검사</button>{result !== null && <output>{result}</output>}</div>
  if (id === 'C03') return <div className="learning-demo"><label>쉼표로 구분한 게시글 제목<input value={value} onChange={(event) => setValue(event.target.value)} maxLength={300} /></label><p>목록의 각 값을 같은 규칙으로 화면에 표시합니다.</p><ol>{value.split(',').map((entry, index) => <li key={index}>{entry.trim() || '(빈 제목)'}</li>)}</ol></div>
  if (id === 'C05') return <div className="learning-demo"><pre>{fixed ? 'const score = 7;\nscore + 2' : 'const score = 7;\nscroe + 2'}</pre><label><input type="checkbox" checked={fixed} onChange={(event) => { setFixed(event.target.checked); setResult(null) }} />변수 이름을 score로 맞추기</label><button type="button" onClick={() => setResult(fixed ? '9 · 같은 이름의 변수를 읽었어요.' : 'ReferenceError: scroe is not defined · score와 scroe를 비교하세요.')}>선택한 예제 결과 확인</button>{result !== null && <output>{result}</output>}<small>정해진 두 예제를 비교하는 실습입니다. 입력한 코드를 실행하지 않아요.</small></div>
  return <div className="learning-demo"><label>{id === 'C04' ? 'greet 함수에 전달할 이름' : '인사말에 사용할 이름'}<input value={value} onChange={(event) => { setValue(event.target.value); setResult(null) }} maxLength={80} /></label>{id === 'C04' && <pre>{'function greet(name) {\n  return `안녕하세요, ${name}님!`;\n}'}</pre>}<button type="button" onClick={() => setResult(value.trim() ? `안녕하세요, ${value.trim()}님!` : '이름을 먼저 입력해 주세요.')}>인사말 만들기</button>{result !== null && <output>{result}</output>}</div>
}

function ManualAI({ node, answers }: { node: LearningNode; answers: Record<string, string> }) {
  const [includeAnswers, setIncludeAnswers] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [notice, setNotice] = useState('')
  const raw = `나는 WebLink에서 ${node.title}을 배우고 있어요.\n목표: ${node.objective}\n과제: ${node.task}\n정답을 대신 완성하지 말고 내가 예측하고 관찰할 수 있도록 한 번에 한 질문으로 도와주세요.${includeAnswers ? `\n\n내가 작성한 내용:\n${node.fields.map((field) => `${field.label}: ${answers[field.id] || '(아직 작성하지 않음)'}`).join('\n')}` : ''}`
  const context = raw.replace(/(?:AIza[\w-]{20,}|sk-[\w-]{16,}|gh[pousr]_[\w]{16,})/g, '[비밀값 가림]').replace(/((?:password|api[_ -]?key|token|secret|비밀번호)\s*[:=]\s*)\S+/gi, '$1[비밀값 가림]')
  useEffect(() => { setReviewed(false); setNotice('') }, [context])
  return <details className="learning-help"><summary>선택 · 내 AI 웹사이트나 CLI에서 도움받기</summary><p>본인이 사용하는 AI를 직접 열고 아래 내용을 붙여 넣으세요. WebLink에 AI API 키를 입력할 필요가 없고, AI 없이도 모든 공개 과제를 진행할 수 있어요.</p><label><input type="checkbox" checked={includeAnswers} onChange={(event) => setIncludeAnswers(event.target.checked)} />내 작성 내용도 포함하기</label><textarea aria-label="AI에 전달할 내용 미리보기" value={context} readOnly rows={9} /><p>일부 알려진 비밀값 형식만 가립니다. 개인정보나 비밀번호가 남아 있지 않은지 직접 확인하세요.</p><label><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />전달할 내용을 확인했어요</label><button type="button" disabled={!reviewed} onClick={async () => { try { await navigator.clipboard.writeText(context); setNotice('복사했어요. 원하는 AI에 직접 붙여 넣으세요.') } catch { setNotice('자동 복사가 막혔어요. 위 내용을 선택해 직접 복사해 주세요.') } }}>확인한 내용 복사</button>{notice && <p role="status">{notice}</p>}</details>
}

export default function LearningStudio({ userId, onLegacy, beforeLeaveRef, onOpenProject }: { userId: string; onLegacy: () => void; onOpenProject: (id: string, jump?: ProjectJump) => Promise<void>; beforeLeaveRef: MutableRefObject<(() => Promise<boolean>) | null> }) {
  const [catalogue, setCatalogue] = useState<Curriculum | null>(null)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [workspace, setWorkspace] = useState<LearningWorkspace | null>(null)
  const [node, setNode] = useState<LearningNode | null>(null)
  const [work, setWork] = useState<LearningWork | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [returnNode, setReturnNode] = useState('M01')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [hintLevel, setHintLevel] = useState(0)
  const [hintText, setHintText] = useState('')
  const [retry, setRetry] = useState(0)
  const [recovery, setRecovery] = useState<{ version: number; answers: Record<string, string> } | null>(null)
  const [executionHistory, setExecutionHistory] = useState<LearningExecutionSummary[]>([])
  const [historyError, setHistoryError] = useState('')
  const [historyRetry, setHistoryRetry] = useState(0)
  const [bridgeActive, setBridgeActive] = useState(false)
  const [bridgeReload, setBridgeReload] = useState(0)
  const inFlight = useRef(false)
  const dirty = Boolean(work && JSON.stringify(answers) !== JSON.stringify(work.answers))

  function applyNode(details: LearningNode, enrollmentId: string) {
    const shuffle = (items: string[]) => {
      const result = [...items]
      for (let index = result.length - 1; index > 0; index -= 1) {
        const target = Math.floor(Math.random() * (index + 1))
        ;[result[index], result[target]] = [result[target], result[index]]
      }
      return result
    }
    setNode({ ...details, fields: details.fields.map((field) => ({ ...field, choices: field.choices && (field.id.startsWith('diagnostic_') || field.id.endsWith('_role')) ? shuffle(field.choices) : field.choices })), concept_check: { ...details.concept_check, choices: shuffle(details.concept_check.choices) } }); setWork(details.work); setAnswers(details.starter_code && !details.work.version ? { ...details.work.answers, ...details.starter_files, source: details.starter_code, ...(details.starter_transfer_code ? { transfer_source: details.starter_transfer_code } : {}) } : details.work.answers)
    setHintLevel(0); setHintText(''); setRecovery(null)
    try {
      const raw = window.sessionStorage.getItem(draftKey(userId, enrollmentId, details.id))
      if (raw) {
        const saved = JSON.parse(raw) as { version: number; answers: Record<string, string> }
        if (typeof saved.version === 'number' && saved.answers && Object.values(saved.answers).every((value) => typeof value === 'string')) setRecovery(saved)
      }
    } catch { /* Server work remains the authoritative copy. */ }
  }

  useEffect(() => {
    let active = true
    setBusy(true); setError('')
    void (async () => {
      try {
        const courses = await curriculumService.list()
        if (!active) return
        const selected = courses.find((course) => course.course_id === 'WEB-FS-01') ?? courses[0]
        if (!selected) { setCatalogue(null); return }
        setCatalogue(selected)
        const registered = await curriculumService.enroll(selected.course_id)
        const state = await curriculumService.workspace(registered.id)
        const current = state.missions.find((mission) => mission.id === registered.current_node_id && mission.available && mission.unlocked)?.id ?? state.missions.find((mission) => mission.available && mission.unlocked)?.id
        if (!current) throw new Error('지금 시작할 수 있는 미션이 없어요.')
        const details = await curriculumService.node(registered.id, current)
        if (!active) return
        setEnrollment(registered); setWorkspace(state); setReturnNode(current); applyNode(details, registered.id)
      } catch (cause) { if (active) setError(message(cause)) }
      finally { if (active) setBusy(false) }
    })()
    return () => { active = false }
  }, [userId, retry])

  useEffect(() => {
    let active = true
    setExecutionHistory([]); setHistoryError('')
    if (enrollment && node && !node.id.startsWith('C')) {
      void curriculumService.executionHistory(enrollment.id, node.id).then(items => { if (active) setExecutionHistory(items) }).catch(cause => { if (active) setHistoryError(message(cause)) })
    }
    return () => { active = false }
  }, [enrollment?.id, node?.id, work?.version, busy, historyRetry])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  function edit(field: string, value: string) {
    const next = { ...answers, [field]: value }
    setAnswers(next); setNotice('')
    if (enrollment && node && work) {
      try { window.sessionStorage.setItem(draftKey(userId, enrollment.id, node.id), JSON.stringify({ version: work.version, answers: next })) }
      catch { setNotice('이 창의 임시 복구 저장을 사용할 수 없어요. 서버에 초안을 저장해 주세요.') }
    }
  }

  async function persist() {
    if (!node || !enrollment || !work) throw new Error('학습 정보를 먼저 불러와 주세요.')
    if (!dirty && work.version > 0) return work
    const saved = await curriculumService.save(enrollment.id, node.id, work.version, answers)
    setWork(saved)
    try { window.sessionStorage.removeItem(draftKey(userId, enrollment.id, node.id)) } catch { /* Optional recovery cache. */ }
    return saved
  }

  async function action(task: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    try { await task() } catch (cause) { setError(message(cause)) }
    finally { inFlight.current = false; setBusy(false) }
  }

  async function openNode(id: string) {
    if (!enrollment || !node || id === node.id) return
    if (bridgeActive) { setNotice('기초 설명에서 원래 코드로 돌아온 뒤 미션을 이동해 주세요.'); return }
    await action(async () => {
      if (dirty) await persist()
      const details = await curriculumService.node(enrollment.id, id)
      if (id.startsWith('M')) {
        await curriculumService.journey(enrollment.id, id)
        setReturnNode(id)
      }
      applyNode(details, enrollment.id)
      setWorkspace(await curriculumService.workspace(enrollment.id))
    })
  }

  async function runSavedJavaScript() {
    if (!enrollment || !node || busy || inFlight.current) throw new Error('현재 요청을 마친 뒤 실행해 주세요.')
    inFlight.current = true; setBusy(true); setError('')
    try {
      const saved = await persist()
      return await curriculumService.run(enrollment.id, node.id, saved.version)
    } catch (cause) { setError(message(cause)); throw cause }
    finally { inFlight.current = false; setBusy(false) }
  }

  async function runSavedRuntime(field: string, signal?: AbortSignal) {
    if (!enrollment || !node || busy || inFlight.current) throw new Error('현재 요청을 마친 뒤 실행해 주세요.')
    inFlight.current = true; setBusy(true); setError('')
    try {
      const saved = await persist()
      return await curriculumService.runCode(enrollment.id, node.id, saved.version, field, signal)
    } catch (cause) { if (!signal?.aborted) setError(message(cause)); throw cause }
    finally { inFlight.current = false; setBusy(false) }
  }

  function exportDraft() {
    if (!node) return
    const content = `# ${node.id} · ${node.title}\n\n${node.fields.map((field) => `## ${field.label}\n\n${answers[field.id] || '(작성 전)'}`).join('\n\n')}\n\n## 개념 확인\n\n${node.concept_check.prompt}\n\n${answers.concept_answer || '(작성 전)'}\n`
    downloadText(`WebLink-${node.id}-학습기록.md`, content)
  }

  useEffect(() => {
    beforeLeaveRef.current = async () => {
      if (inFlight.current || busy) return false
      if (!dirty) return true
      inFlight.current = true; setBusy(true); setError('')
      try { await persist(); return true }
      catch (cause) { setError(message(cause)); return false }
      finally { inFlight.current = false; setBusy(false) }
    }
    function shortcut(event: KeyboardEvent) {
      if (!(event.target instanceof HTMLElement) || !event.target.closest('.learning-studio')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!busy) void action(async () => { await persist(); setNotice('서버에 초안을 저장했어요.') })
      }
    }
    window.addEventListener('keydown', shortcut, true)
    return () => { beforeLeaveRef.current = null; window.removeEventListener('keydown', shortcut, true) }
  })

  if (!node || !catalogue || !enrollment || !workspace || !work) return <main className="learning-studio"><h1>나의 학습</h1>{busy ? <p role="status">저장된 학습을 불러오고 있어요…</p> : <><p role={error ? 'alert' : undefined}>{error || '아직 공개된 새 과정이 없어요.'}</p><button onClick={() => setRetry((value) => value + 1)}>다시 불러오기</button><button onClick={onLegacy}>기존 수업과 기록 보기</button></>}</main>

  const next = node.next_ids.find((id) => workspace.missions.some((mission) => mission.id === id && mission.available && mission.unlocked))
  const availableCount = workspace.missions.filter((mission) => mission.available).length
  const feedback = !dirty && work.status !== 'STALE' ? work.feedback : null
  const isFoundation = node.id.startsWith('C')
  return <main className="learning-studio" aria-busy={busy}>
    <header className="learning-studio__heading"><div><p className="learning-studio__kicker">만들며 배우는 웹 개발 · {catalogue.content_version}</p><h1>{catalogue.title}</h1><p>{catalogue.description}</p></div><button disabled={busy} onClick={() => void action(async () => { if (dirty) await persist(); onLegacy() })}>기존 수업 기록</button></header>
    <div className="learning-studio__release"><span>12개 미션 · 검증 진행 중</span><p>M01~M12와 기초 연습 6개를 사용할 수 있어요. M11에서는 실패 재현과 수정 결과를 비교하고, M12에서는 메모장과 할 일 목록에 같은 원리를 적용합니다. 전체 과정의 브라우저 완주 검증은 별도로 진행합니다.</p><strong>공개 미션 {workspace.completed_ids.length}/{availableCount} 확인</strong></div>
    <div className="learning-studio__layout">
      <aside className="learning-studio__rail" aria-label="학습 경로">
        {catalogue.units.map((unit) => <section key={unit.id}><h2>{unit.title}</h2><ol>{workspace.missions.filter((mission) => mission.unit_id === unit.id).map((mission) => <li key={mission.id}><button aria-current={node.id === mission.id ? 'step' : undefined} disabled={busy || !mission.available || !mission.unlocked} onClick={() => void openNode(mission.id)}><span>{mission.id} · {mission.title}</span><small>{!mission.available ? '준비 중' : !mission.unlocked ? '선수 미션 확인 필요' : statusLabels[mission.status] ?? mission.status}</small></button></li>)}</ol></section>)}
        <details><summary>필요할 때 · 기초 연습</summary>{workspace.foundations.map((foundation) => <button key={foundation.id} disabled={busy} onClick={() => void openNode(foundation.id)} aria-current={node.id === foundation.id ? 'step' : undefined}>{foundation.id} · {foundation.title}<small>{statusLabels[foundation.status]}</small></button>)}</details>
      </aside>
      <article className="learning-studio__lesson" key={node.id}>
        <header><p className="learning-studio__kicker">{isFoundation ? '선택 기초 연습 · 미션 진도와 별도' : `${node.id} · 직접 작성하는 미션`}</p><h2>{node.title}</h2><p>{node.objective}</p>{isFoundation && <button disabled={busy} onClick={() => void openNode(returnNode)}>← {returnNode} 미션으로 돌아가기</button>}</header>
        {error && <div className="learning-studio__error" role="alert"><strong>요청을 완료하지 못했어요</strong><p>{error}</p><p>지금 입력한 내용은 화면에 남아 있어요. 저장본을 다시 열기 전에 내려받을 수 있습니다.</p><button onClick={exportDraft}>현재 작성 내용 내려받기</button></div>}
        {recovery && <section className="learning-studio__notice"><p>이 창에 서버 저장 전의 작성 내용이 남아 있어요.{recovery.version !== work.version && ' 다른 저장본이 있으므로 자동으로 덮어쓰지 않습니다.'}</p><button disabled={busy || recovery.version !== work.version} onClick={() => { setAnswers(recovery.answers); setRecovery(null); setNotice('임시 작성 내용을 복구했어요. 서버 초안을 저장해 주세요.') }}>임시 작성 내용 복구</button><button disabled={busy} onClick={() => { downloadText(`WebLink-${node.id}-복구본.json`, JSON.stringify(recovery.answers, null, 2)) }}>복구본 내려받기</button><button disabled={busy} onClick={() => { try { window.sessionStorage.removeItem(draftKey(userId, enrollment.id, node.id)); setRecovery(null) } catch { setError('임시 저장소를 지우지 못했어요. 현재 서버 저장본은 그대로 사용할 수 있습니다.') } }}>서버 저장본 사용</button></section>}
        <section className="learning-studio__section"><h3>1. 예측하고 살펴보기</h3><p>{node.prediction}</p><p>{node.task}</p>{isFoundation ? <FoundationPractice key={node.id} id={node.id} /> : node.id === 'M01' ? <div className="learning-studio__flow"><span>내 목표 정하기</span><span>→</span><span>서버에 저장</span><span>→</span><span>다시 열고 확인</span></div> : node.id === 'M03' ? <div className="learning-studio__flow"><span>label · 화면의 이름</span><span>→ for / id 연결</span><span>input · 입력 받기</span></div> : node.id === 'M04' ? <div className="learning-studio__flow"><span>submit</span><span>→ trim · 검증</span><span>→ 오류 안내 / 저장 호출</span></div> : node.id === 'M05' ? <div className="learning-studio__flow"><span>입력</span><span>→ 새 state 배열</span><span>→ React 목록</span></div> : (node.id === 'M06' || node.id === 'M07') ? <div className="learning-studio__flow"><span>HTTP 요청</span><span>→ FastAPI</span><span>→ 메모리 목록</span><span>→ JSON 응답</span></div> : <><div className="learning-studio__flow"><span>화면 UI</span><span>→ 요청</span><span>API · 검증</span><span>↔</span><span>DB · 저장</span></div><p>UI는 요청을 보내고, API는 입력을 검사한 뒤 DB를 다룹니다. API의 응답을 받은 UI가 결과를 보여 줍니다.</p></>}<details><summary>관찰할 내용</summary><p>{node.practice.expected_observation}</p></details></section>
        <form onSubmit={(event) => { event.preventDefault(); void action(async () => { await persist(); setNotice('서버에 초안을 저장했어요. 저장은 제출·완료와 별개입니다.'); setWorkspace(await curriculumService.workspace(enrollment.id)) }) }}>
          <section className="learning-studio__section"><h3>2. {node.fields.some((field) => field.kind === 'code') ? '코드를 작성하고 관찰하기' : '내 생각을 작성하기'}</h3><p>진단은 설명을 추천하기 위한 것이며, AI 사용이나 힌트 횟수는 감점하지 않아요.</p>{node.fields.map((field) => <div className="learning-studio__field" key={field.id}>{field.kind === 'code' ? <strong>{field.label}</strong> : <label htmlFor={`learning-${field.id}`}>{field.label}</label>}{field.kind === 'code' && node.runtime?.language ? <RuntimeCodeExercise value={answers[field.id] ?? ''} starter={(node.starter_files?.[field.id] ?? (field.id === 'transfer_source' ? node.starter_transfer_code : node.starter_code)) ?? ''} language={field.language ?? node.runtime.language} integrated={['M10', 'M11', 'M12'].includes(node.id)} revisionTag={JSON.stringify(answers)} savedRevisionTag={JSON.stringify(work.answers)} history={executionHistory.filter(item => item.field === (field.run_field ?? field.id))} onRestore={curriculumService.restoreExecution} scope={node.runtime.scope} path={`learning/${enrollment.id}/${node.id}/${field.id}/${field.filename ?? node.runtime.filename}`} transferTask={field.id.startsWith('transfer_') ? node.transfer_task : undefined} disabled={busy} onChange={(value) => edit(field.id, value)} onRun={(signal) => runSavedRuntime(field.run_field ?? field.id, signal)} /> : field.kind === 'code' && node.id === 'M04' ? <JavaScriptExercise value={answers[field.id] ?? ''} starter={node.starter_code ?? ''} path={`learning/${enrollment.id}/${node.id}/main.js`} disabled={busy} onChange={(value) => edit(field.id, value)} onRun={runSavedJavaScript} /> : field.kind === 'code' ? <HtmlFormExercise value={answers[field.id] ?? ''} starter={node.starter_code ?? ''} path={`learning/${enrollment.id}/${node.id}/index.html`} disabled={busy} onChange={(value) => edit(field.id, value)} /> : field.kind === 'choice' ? <select id={`learning-${field.id}`} value={answers[field.id] ?? ''} disabled={busy} onChange={(event) => edit(field.id, event.target.value)}><option value="">선택해 주세요</option>{field.choices?.map((choice) => <option key={choice}>{choice}</option>)}</select> : <textarea id={`learning-${field.id}`} value={answers[field.id] ?? ''} disabled={busy} onChange={(event) => edit(field.id, event.target.value)} placeholder={field.placeholder} maxLength={4000} rows={3} aria-describedby={feedback?.issues[field.id] ? `issue-${field.id}` : undefined} />}{feedback?.issues[field.id] && <small className="learning-studio__issue" id={`issue-${field.id}`}>{feedback.issues[field.id]}</small>}</div>)}</section>
          <section className="learning-studio__section"><h3>3. 개념 확인</h3><fieldset disabled={busy}><legend>{node.concept_check.prompt}</legend>{node.concept_check.choices.map((choice) => <label className="learning-studio__choice" key={choice}><input type="radio" name="concept_answer" value={choice} checked={answers.concept_answer === choice} onChange={() => edit('concept_answer', choice)} />{choice}</label>)}</fieldset>{feedback?.issues.concept_answer && <p className="learning-studio__issue">{feedback.issues.concept_answer}</p>}</section>
          <div className="learning-studio__actions"><span>{dirty ? '저장 전 변경 있음' : work.version ? `서버 저장본 v${work.version}${work.updated_at ? ` · ${new Date(work.updated_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : ''}` : '아직 저장하지 않았어요'}</span><div><button type="submit" disabled={busy}>{busy ? '처리 중…' : '초안 저장'}</button><button type="button" disabled={busy || !work.version || dirty} onClick={() => void action(async () => { applyNode(await curriculumService.node(enrollment.id, node.id), enrollment.id); setNotice('서버 저장본을 다시 불러왔어요.') })}>저장본 다시 열기</button><button className="learning-studio__primary" type="button" disabled={busy || dirty || !work.version || !node.unlocked} onClick={() => void action(async () => { const saved = await persist(); if (['M06', 'M07', 'M08', 'M09', 'M10', 'M11', 'M12'].includes(node.id)) { if (node.id === 'M11') await curriculumService.runCode(enrollment.id, node.id, saved.version, 'baseline_source'); await curriculumService.runCode(enrollment.id, node.id, saved.version, 'source'); if (['M07', 'M10', 'M12'].includes(node.id) && (answers.transfer_source ?? '').trim().length >= 20) await curriculumService.runCode(enrollment.id, node.id, saved.version, 'transfer_source') } const result = await curriculumService.submit(enrollment.id, node.id, saved.version); setWork(result); setWorkspace(await curriculumService.workspace(enrollment.id)); setNotice(result.feedback?.passed ? '작성 항목과 개념 확인을 마쳤어요.' : '아래 안내에 따라 다시 살펴보세요.') })}>저장한 답안 제출</button></div></div>
          <p className="learning-studio__muted">Ctrl+S / ⌘S로 초안 저장{(dirty || !work.version) && ' · 제출하려면 먼저 저장해 주세요.'}</p>
        </form>
        {notice && <p className="learning-studio__notice" role="status">{notice}</p>}
        {work.status === 'STALE' && <p className="learning-studio__notice">답안이나 선수 미션이 바뀌었어요. 이전 확인 기록은 남아 있으며 현재 저장본을 다시 제출해야 합니다.</p>}
        {feedback && <section className="learning-studio__feedback" aria-live="polite"><h3>{feedback.passed ? '확인 완료' : '조금 더 살펴보기'}</h3>{Object.entries(feedback.issues).map(([key, issue]) => <p key={key}>{issue}</p>)}<p>{feedback.scope}</p>{feedback.checks && feedback.checks.length > 0 && <ul className="learning-html-checks">{feedback.checks.map((check) => <li key={check.id}><strong>{check.passed ? '✓' : '확인 필요'} · {check.label}</strong><span>{check.message}</span></li>)}</ul>}{feedback.recommendation && <><p>{feedback.recommendation.message}</p>{feedback.recommendation.foundation_ids.map((id) => <button key={id} disabled={busy} onClick={() => void openNode(id)}>{id} 설명 보기</button>)}</>}{feedback.passed && next && <button className="learning-studio__primary" disabled={busy} onClick={() => void openNode(next)}>다음 미션 · {next}</button>}{feedback.passed && !isFoundation && !next && <p>{workspace.completed_ids.length === 12 ? '12개 미션의 현재 저장본을 모두 확인했어요. 학습 기록과 코드를 내려받아 다음 프로젝트에 참고하세요.' : '현재 저장본과 선수 미션의 확인 상태를 학습 경로에서 살펴보세요.'}</p>}</section>}
        <details className="learning-help"><summary>막혔을 때 · 단계별 힌트</summary><p>힌트를 사용해도 감점하지 않아요.</p>{hintText && <p role="status"><strong>H{hintLevel}</strong> · {hintText}</p>}<button disabled={busy || hintLevel >= 4} onClick={() => void action(async () => { const result = await curriculumService.hint(enrollment.id, node.id, hintLevel + 1); setHintLevel(result.level); setHintText(result.text) })}>{hintLevel >= 4 ? '모든 힌트를 확인했어요' : `H${hintLevel + 1} 힌트 보기`}</button><p>{node.recovery}</p>{node.foundation_ids.map((id) => <button key={id} disabled={busy} onClick={() => void openNode(id)}>{id} 기초 설명 보기</button>)}</details>
        {['M10', 'M12'].includes(node.id) && <section className="learning-studio__section"><h3>개인 프로젝트로 이어 만들기</h3><p>현재 저장본의 과제·전이·개념 확인을 마친 뒤 React·API 코드와 Docker 실행 구성을 개인 프로젝트에 보관합니다. 같은 과제에서 다시 누르면 기존 프로젝트를 열며 자동으로 덮어쓰거나 사본을 추가하지 않습니다.</p>{['source', 'transfer_source'].map(field => <button key={field} disabled={busy || dirty || !work.version || bridgeActive} onClick={() => void action(async () => { const result = await curriculumService.handoff(enrollment.id, node.id, work.version, field); setNotice(result.message + (result.source_changed ? ' 학습 답안은 프로젝트 생성 이후 변경됐습니다. 새 코드는 학습 기록에서 따로 내려받을 수 있어요.' : '')); setBridgeReload(value => value + 1); await onOpenProject(result.project_id, { notice: result.message + (result.source_changed ? ' 학습 답안은 프로젝트 생성 뒤 바뀌었습니다. 기존 프로젝트는 그대로 두고 학습 기록에서 새 코드를 내려받아 반영해 주세요.' : '') }) })}>{field === 'source' ? '본 과제로 만든 프로젝트 열기·만들기' : '전이 과제로 만든 프로젝트 열기·만들기'}</button>)}</section>}
        {['M10', 'M12'].includes(node.id) && <LearningProjectUpdate key={`${enrollment.id}/${node.id}`} enrollmentId={enrollment.id} nodeId={node.id} version={work.version} disabled={busy || dirty || bridgeActive} onApplied={() => { setBridgeReload(value => value + 1); setNotice('프로젝트에 반영한 뒤 새 버전과 출처를 기록했어요. 프로젝트에서 앱을 다시 실행해 주세요.') }} />}
        {historyError && <section className="learning-studio__notice"><p>저장한 실행 기록을 읽지 못했어요. 현재 작성 내용은 유지됩니다. {historyError}</p><button disabled={busy} onClick={() => setHistoryRetry(value => value + 1)}>실행 기록 다시 읽기</button></section>}
        <LearningProjectBridge key={`${enrollment.id}/${node.id}/${bridgeReload}`} enrollmentId={enrollment.id} disabled={busy} onActive={setBridgeActive} renderFoundation={id => <FoundationPractice id={id} />} onOpen={async (id, jump) => { await action(async () => { if (dirty) await persist(); await onOpenProject(id, jump) }) }} />
        <ManualAI key={node.id} node={node} answers={answers} />
        <footer className="learning-studio__footer"><button disabled={busy} onClick={() => void action(async () => { if (dirty) await persist(); const data = await curriculumService.portfolio(enrollment.id); downloadText('WebLink-전체학습기록.json', JSON.stringify(data, null, 2)); setNotice('서버에 저장된 12개 미션의 작성 내용과 현재 저장본 실행 기록을 내려받았어요.'); })}>전체 학습 기록·코드 내려받기</button><button onClick={exportDraft}>현재 작성 내용을 Markdown으로 내려받기</button><p>이 계정의 학습 기록은 서버에 저장됩니다. 다운로드한 파일은 본인 컴퓨터에 보관해요.</p></footer>
      </article>
    </div>
  </main>
}
