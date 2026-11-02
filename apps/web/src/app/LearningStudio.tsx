import { MutableRefObject, useEffect, useRef, useState } from 'react'
import { Curriculum, Enrollment, LearningExecutionSummary, LearningLevel, LearningSubjectId, LearningPath, LearningNode, LearningRequestError, LearningWork, LearningWorkspace, ProjectJump, curriculumService } from '../services/learning'
import { LearningDraft, clearLearningDraft, learningDraftKey as draftKey, learningSnapshot, matchesLearningWork, readLearningDraft, writeLearningDraft } from '../services/learningDrafts'
import { sameAnswers } from '../services/answerRecovery'
import { aiHelpContext, savedExecutionEvidence, submissionGaps } from '../services/learningGuidance'
import LearningExecutionDetails from './LearningExecutionDetails'
import './LearningStudio.css'
import LearningWorkFields from './LearningWorkFields'
import LearningProjectBridge from './LearningProjectBridge'
import LearningProjectUpdate from './LearningProjectUpdate'
import LearningDraftRecovery from './LearningDraftRecovery'
import LearningHome, { LearningHomePage, learningStatusLabels as statusLabels } from './LearningHome'

const message = (cause: unknown) => cause instanceof Error ? cause.message : '요청을 처리하지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.'
const initialAnswers = (details: LearningNode) => details.starter_code && !details.work.version
  ? { ...details.work.answers, ...details.starter_files, source: details.starter_code, ...(details.starter_transfer_code ? { transfer_source: details.starter_transfer_code } : {}), ...(details.assignment.has_transfer && !details.assignment.transfer_required ? { transfer_mode: '본 과제부터 마치기' } : {}) }
  : details.work.answers

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

function LearningFlow({ nodeId }: { nodeId: string }) {
  const flows: Record<string, string[]> = {
    M01: ['내 목표 정하기', '→', '서버에 저장', '→', '다시 열고 확인'],
    M03: ['label · 화면의 이름', '→ for / id 연결', 'input · 입력 받기'],
    M04: ['submit', '→ trim · 검증', '→ 오류 안내 / 저장 호출'],
    M05: ['입력', '→ 새 state 배열', '→ React 목록'],
    M06: ['HTTP 요청', '→ FastAPI', '→ 메모리 목록', '→ JSON 응답'],
    M07: ['HTTP 요청', '→ FastAPI', '→ 메모리 목록', '→ JSON 응답'],
    M08: ['Python 코드', '→ INSERT · 저장', '↔ SQLite', '→ SELECT · 조회'],
    M09: ['HTTP 요청', '→ FastAPI', '↔ SQLite', '→ JSON 응답'],
  }
  const common = ['화면 UI', '→ 요청', 'API · 검증', '↔', 'DB · 저장']
  const explanation = nodeId === 'M08' ? 'Python 스크립트에서 SQL을 실행하고 DB에 저장된 행을 조회합니다.'
    : nodeId === 'M09' ? 'API가 SQLite에 저장하고, DB에서 읽은 결과를 JSON으로 응답합니다.'
    : !flows[nodeId] ? 'UI는 요청을 보내고, API는 입력을 검사한 뒤 DB를 다룹니다. API의 응답을 받은 UI가 결과를 보여 줍니다.' : ''
  return <><div className="learning-studio__flow">{(flows[nodeId] ?? common).map((text, index) => <span key={index}>{text}</span>)}</div>{explanation && <p>{explanation}</p>}</>
}

function ManualAI({ node, answers, feedback }: { node: LearningNode; answers: Record<string, string>; feedback: LearningWork['feedback'] }) {
  const [includeAnswers, setIncludeAnswers] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [notice, setNotice] = useState('')
  const context = aiHelpContext(node, answers, includeAnswers, feedback)
  useEffect(() => { setReviewed(false); setNotice('') }, [context])
  return <details className="learning-help"><summary>선택 · 내 AI 웹사이트나 CLI에서 도움받기</summary><p>본인이 사용하는 AI를 직접 열고 아래 내용을 붙여 넣으세요. WebLink에 AI API 키를 입력할 필요가 없고, AI 없이도 모든 공개 과제를 진행할 수 있어요.</p><label><input type="checkbox" checked={includeAnswers} onChange={(event) => setIncludeAnswers(event.target.checked)} />내 작성 내용도 포함하기</label><textarea aria-label="AI에 전달할 내용 미리보기" value={context} readOnly rows={9} /><p>일부 알려진 비밀값 형식만 가립니다. 개인정보나 비밀번호가 남아 있지 않은지 직접 확인하세요.</p><label><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />전달할 내용을 확인했어요</label><button type="button" disabled={!reviewed} onClick={async () => { try { await navigator.clipboard.writeText(context); setNotice('복사했어요. 원하는 AI에 직접 붙여 넣으세요.') } catch { setNotice('자동 복사가 막혔어요. 위 내용을 선택해 직접 복사해 주세요.') } }}>확인한 내용 복사</button>{notice && <p role="status">{notice}</p>}</details>
}

export default function LearningStudio({ userId, onLegacy, beforeLeaveRef, onOpenProject, initialPage = 'home' }: { userId: string; onLegacy: (courseSlug?: string, lessonSlug?: string) => void; initialPage?: LearningHomePage; onOpenProject: (id: string, jump?: ProjectJump) => Promise<void>; beforeLeaveRef: MutableRefObject<(() => Promise<boolean>) | null> }) {
  const [page, setPage] = useState<LearningHomePage | 'mission'>(initialPage)
  const [pathProfile, setPathProfile] = useState<LearningPath | null>(null)
  const [pathError, setPathError] = useState('')
  const [pathRetry, setPathRetry] = useState(0)
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
  const [attemptedCheck, setAttemptedCheck] = useState(false)
  const [checkStage, setCheckStage] = useState('')
  const [hintText, setHintText] = useState('')
  const [retry, setRetry] = useState(0)
  const [recovery, setRecovery] = useState<LearningDraft | null>(null)
  const [saveConflict, setSaveConflict] = useState(false)
  const [offline, setOffline] = useState(!navigator.onLine)
  const [executionHistory, setExecutionHistory] = useState<LearningExecutionSummary[]>([])
  const [historyError, setHistoryError] = useState('')
  const [historyRetry, setHistoryRetry] = useState(0)
  const [bridgeActive, setBridgeActive] = useState(false)
  const [bridgeReload, setBridgeReload] = useState(0)
  const [handoffBusy, setHandoffBusy] = useState(false)
  const [handoffError, setHandoffError] = useState('')
  const inFlight = useRef(false)
  const lastFocusCheck = useRef(0)
  const dirty = Boolean(work && !sameAnswers(answers, work.answers))

  useEffect(() => {
    if (!enrollment || !node || !work || !['M10', 'M12'].includes(node.id)) return
    let active = true
    setHandoffBusy(true); setHandoffError('')
    void curriculumService.node(enrollment.id, node.id).then(details => {
      if (!active) return
      if (details.work.version !== work.version) {
        setHandoffError('서버의 학습 저장본이 바뀌었어요. 저장본을 다시 연 뒤 프로젝트 상태를 확인하세요.')
        return
      }
      setNode(previous => previous?.id === details.id ? { ...previous, project_handoffs: details.project_handoffs } : previous)
    }).catch(cause => { if (active) setHandoffError(message(cause)) })
      .finally(() => { if (active) setHandoffBusy(false) })
    return () => { active = false }
  }, [enrollment?.id, node?.id, work?.version, work?.status, bridgeReload])

  useEffect(() => {
    if (!enrollment) return
    let active = true
    setPathError(''); setPathProfile(null)
    void curriculumService.path(enrollment.id).then(profile => { if (active) setPathProfile(profile) }).catch(cause => { if (active) setPathError(message(cause)) })
    return () => { active = false }
  }, [enrollment?.id, pathRetry])

  async function savePath(level: LearningLevel | null, subjectIds: LearningSubjectId[]) {
    if (!enrollment || !pathProfile) return
    await action(async () => {
      setPathError('')
      try {
        setPathProfile(await curriculumService.savePath(enrollment.id, pathProfile.version, level, subjectIds))
        if (node && !recovery) applyNode(await curriculumService.node(enrollment.id, node.id), enrollment.id)
        setNotice('배울 과목과 난이도를 저장했어요. 선택한 과목의 수업을 모아 볼 수 있으며, 이미 저장한 답안과 과제 기준은 유지됩니다.')
      } catch (cause) { setPathError(message(cause)) }
    })
  }

  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  function applyNode(details: LearningNode, enrollmentId: string) {
    const shuffle = (items: string[]) => {
      const result = [...items]
      for (let index = result.length - 1; index > 0; index -= 1) {
        const target = Math.floor(Math.random() * (index + 1))
        ;[result[index], result[target]] = [result[target], result[index]]
      }
      return result
    }
    setNode({ ...details, fields: details.fields.map((field) => ({ ...field, choices: field.choices && field.kind === 'choice' ? shuffle(field.choices) : field.choices })), concept_check: { ...details.concept_check, choices: shuffle(details.concept_check.choices) } }); setWork(details.work); setAnswers(initialAnswers(details))
    setHintLevel(0); setHintText(''); setSaveConflict(false); setAttemptedCheck(false)
    const saved = readLearningDraft(draftKey(userId, enrollmentId, details.id))
    if (saved && matchesLearningWork(saved, details.work, details.assignment.key)) clearLearningDraft(draftKey(userId, enrollmentId, details.id), saved)
    setRecovery(saved && !matchesLearningWork(saved, details.work, details.assignment.key) ? saved : null)
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
    if (!enrollment || !node || !work || page !== 'mission' || busy || recovery) return
    let active = true
    let checking = false
    const check = async () => {
      if (document.visibilityState !== 'visible' || inFlight.current || checking || !navigator.onLine || Date.now() - lastFocusCheck.current < 1500) return
      checking = true; lastFocusCheck.current = Date.now()
      try {
        const latest = await curriculumService.workspace(enrollment.id)
        if (!active) return
        setWorkspace(latest)
        const current = [...latest.missions, ...latest.foundations].find(item => item.id === node.id)
        if (current && current.work_version !== work.version) setSaveConflict(true)
        else if (current) setWork(previous => previous && previous.version === current.work_version ? { ...previous, status: current.status } : previous)
      } catch { /* Saving still checks the latest server version. */ }
      finally { checking = false }
    }
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => { active = false; window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check) }
  }, [enrollment?.id, node?.id, work?.version, page, busy, recovery])

  useEffect(() => {
    if (!(page === 'mission' && dirty) && !recovery) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, recovery, page])

  function edit(field: string, value: string) {
    if (recovery || busy) return
    const next = { ...answers, [field]: value }
    setAnswers(next); setNotice('')
    if (enrollment && node && work) {
      const protection = writeLearningDraft(draftKey(userId, enrollment.id, node.id), learningSnapshot(work, next, node.assignment.key))
      if (protection === 'unavailable') setNotice('브라우저 임시 보관을 사용할 수 없어요. 새로고침 전에 서버에 저장하거나 작성 내용을 내려받아 주세요.')
      else if (protection === 'session') setNotice('임시 보관이 이 창에서만 가능해요. 창을 닫기 전에 서버에 저장하거나 작성 내용을 내려받아 주세요.')
    }
  }

  async function persist() {
    if (!node || !enrollment || !work) throw new Error('학습 정보를 먼저 불러와 주세요.')
    if (recovery) throw new Error('남아 있는 복구본을 먼저 확인해 주세요. 편집기로 가져오거나 서버 답안을 선택할 수 있어요.')
    if (saveConflict) throw new Error('최신 서버 답안과 비교한 뒤 다시 저장해 주세요.')
    if (!dirty && work.version > 0) return work
    let saved: LearningWork
    try { saved = await curriculumService.save(enrollment.id, node.id, work.version, answers, node.assignment.key) }
    catch (cause) { if (cause instanceof LearningRequestError && cause.status === 409) setSaveConflict(true); throw cause }
    setWork(saved)
    if (saved.assignment) setNode(previous => previous ? { ...previous, assignment: saved.assignment! } : previous)
    clearLearningDraft(draftKey(userId, enrollment.id, node.id), learningSnapshot(work, answers, node.assignment.key))
    return saved
  }

  function goToAnswer(id: string) {
    const target = document.getElementById(`learning-field-${id}`)
    if (!target) return
    let parent = target.parentElement
    while (parent) {
      if (parent instanceof HTMLDetailsElement) parent.open = true
      parent = parent.parentElement
    }
    target.scrollIntoView({ block: 'center' })
    const control = target.matches('button') ? target : target.querySelector<HTMLElement>('select, textarea, input, [role="textbox"]')
    ;(control ?? target).focus({ preventScroll: true })
  }

  async function openHandoff(field: string) {
    if (!node || !enrollment) return
    await action(async () => {
      const saved = await persist()
      const result = await curriculumService.handoff(enrollment.id, node.id, saved.version, field)
      const notice = result.message + (result.source_changed ? ' 학습 답안은 프로젝트 생성 뒤 바뀌었습니다. 새 코드는 학습 화면에서 비교한 뒤 반영할 수 있어요.' : '')
      setNotice(notice); setBridgeReload(value => value + 1)
      await onOpenProject(result.project_id, { notice })
    })
  }

  async function checkPractice() {
    if (!node || !enrollment) return
    await action(async () => {
      try {
        setCheckStage('초안을 저장하고 필수 항목을 확인하고 있어요…')
        const saved = await persist()
        setAttemptedCheck(true)
        if (submissionGaps(node, answers, saved).length) {
          setWorkspace(await curriculumService.workspace(enrollment.id))
          return
        }
        if (node.id === 'M04') {
          setCheckStage('저장한 코드로 입력 검사를 실행하고 있어요…')
          await curriculumService.run(enrollment.id, node.id, saved.version)
        }
        if (['M05', 'M06', 'M07', 'M08', 'M09', 'M10', 'M11', 'M12'].includes(node.id)) {
          if (node.id === 'M11') {
            setCheckStage('실패 재현본의 실행 결과를 확인하고 있어요…')
            await curriculumService.runCode(enrollment.id, node.id, saved.version, 'baseline_source')
          }
          setCheckStage(node.id === 'M11' ? '수정본을 실행해 이전 오류와 정상 동작을 확인하고 있어요…' : '본 과제의 실행 결과를 확인하고 있어요…')
          await curriculumService.runCode(enrollment.id, node.id, saved.version, 'source')
          if ((node.assignment.transfer_required || answers.transfer_mode === '전이 과제도 도전하기') && ['M05', 'M07', 'M10', 'M12'].includes(node.id)) {
            setCheckStage('다른 문제에 적용한 코드의 실행 결과를 확인하고 있어요…')
            await curriculumService.runCode(enrollment.id, node.id, saved.version, 'transfer_source')
          }
        }
        setCheckStage('실행 결과와 개념 답을 제출하고 있어요…')
        const result = await curriculumService.submit(enrollment.id, node.id, saved.version)
        setWork(result)
        setWorkspace(await curriculumService.workspace(enrollment.id))
        setNotice(result.feedback?.passed ? '현재 저장본의 실습과 개념 확인을 마쳤어요.' : '아래 안내에 따라 다시 살펴보세요.')
      } finally { setCheckStage('') }
    })
  }

  async function compareLatest() {
    if (!enrollment || !node || !work) return
    const local = learningSnapshot(work, answers, node.assignment.key)
    const latest = await curriculumService.node(enrollment.id, node.id)
    const protection = writeLearningDraft(draftKey(userId, enrollment.id, node.id), local)
    applyNode(latest, enrollment.id)
    setRecovery(local)
    setNotice(protection === 'unavailable' ? '복구본을 브라우저에 보관하지 못했어요. 창을 닫기 전에 내려받아 주세요.' : '서로 다른 항목의 변경은 합치고, 같은 항목만 선택해 주세요.')
  }

  async function action(task: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    try { await task() } catch (cause) { setError(message(cause)) }
    finally { inFlight.current = false; setBusy(false) }
  }

  async function openNode(id: string) {
    if (!enrollment || !node) return
    if (id === node.id && (page === 'mission' || recovery)) { setPage('mission'); return }
    if (busy || recovery) return
    if (bridgeActive) { setNotice('기초 설명에서 원래 코드로 돌아온 뒤 미션을 이동해 주세요.'); return }
    await action(async () => {
      if (page === 'mission' && dirty) await persist()
      const details = await curriculumService.node(enrollment.id, id)
      if (id.startsWith('M')) {
        await curriculumService.journey(enrollment.id, id)
        setReturnNode(id)
      }
      applyNode(details, enrollment.id)
      setWorkspace(await curriculumService.workspace(enrollment.id))
      setPage('mission')
    })
  }

  async function openHome(target: LearningHomePage) {
    await action(async () => {
      if (page === 'mission' && dirty && !recovery) await persist()
      if (enrollment) setWorkspace(await curriculumService.workspace(enrollment.id))
      if (enrollment) {
        try { setPathProfile(await curriculumService.path(enrollment.id)); setPathError('') }
        catch (cause) { setPathError(message(cause)) }
      }
      setPage(target)
    })
  }

  async function downloadPortfolio() {
    if (!enrollment) return
    await action(async () => {
      if (page === 'mission' && dirty) await persist()
      const data = await curriculumService.portfolio(enrollment.id)
      downloadText('WebLink-현재과정-학습기록.json', JSON.stringify(data, null, 2))
      setNotice('현재 과정의 저장된 답안과 실행 기록을 내려받았어요. 이전 수업 기록은 보관함에서 확인하세요.')
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
      if (page !== 'mission' || !dirty) return true
      inFlight.current = true; setBusy(true); setError('')
      try { await persist(); return true }
      catch (cause) { setError(message(cause)); return false }
      finally { inFlight.current = false; setBusy(false) }
    }
    function shortcut(event: KeyboardEvent) {
      if (!(event.target instanceof HTMLElement) || !event.target.closest('.learning-studio')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!busy && page === 'mission') void action(async () => { await persist(); setNotice('서버에 초안을 저장했어요.') })
      }
    }
    window.addEventListener('keydown', shortcut, true)
    return () => { beforeLeaveRef.current = null; window.removeEventListener('keydown', shortcut, true) }
  })

  if (!node || !catalogue || !enrollment || !workspace || !work) return <main className="learning-studio"><h1>나의 학습</h1>{busy ? <p role="status">저장된 학습을 불러오고 있어요…</p> : <><p role={error ? 'alert' : undefined}>{error || '아직 공개된 과정이 없어요.'}</p><button onClick={() => setRetry((value) => value + 1)}>다시 불러오기</button><button onClick={() => onLegacy()}>이전 수업 보관함 열기</button></>}</main>

  const next = node.next_ids.find((id) => workspace.missions.some((mission) => mission.id === id && mission.available && mission.unlocked))
  const availableCount = workspace.missions.filter((mission) => mission.available).length
  const feedback = !dirty && work.status !== 'STALE' ? work.feedback : null
  const executionEvidence = savedExecutionEvidence(work, dirty)
  const isFoundation = node.id.startsWith('C')
  const editingBlocked = busy || Boolean(recovery)
  const gaps = attemptedCheck ? submissionGaps(node, answers, work) : []
  const validationIssues = Object.fromEntries(gaps.map(item => [item.id, item.message]))
  const assignment = work.assignment ?? node.assignment
  const transferActive = assignment.transfer_required || answers.transfer_mode === '전이 과제도 도전하기'
  const visibleFields = node.fields.filter(field => !field.optional || transferActive || (field.practice_note && !field.id.startsWith('transfer_')))
  const nextFoundation = isFoundation ? pathProfile?.foundation_ids.find((id, index, ids) => index > ids.indexOf(node.id) && workspace.foundations.some(item => item.id === id && item.status !== 'PASSED')) : undefined
  if (page !== 'mission') return <main className="learning-studio" aria-busy={busy}>
    {offline && <p className="learning-studio__notice" role="status">인터넷 연결이 끊긴 것으로 감지했어요. 수업을 열거나 기록을 내려받으려면 서버 연결이 필요해요.</p>}
    {error && <p className="learning-studio__error" role="alert">{error}</p>}
    {notice && <p className="learning-studio__notice" role="status">{notice}</p>}
    <LearningHome page={page} catalogue={catalogue} workspace={workspace} currentId={node.id} busy={busy} recovery={Boolean(recovery)} pathProfile={pathProfile} pathError={pathError} onPathReload={() => setPathRetry(value => value + 1)} onPathSave={(level, subjects) => void savePath(level, subjects)} onPage={target => void openHome(target)} onOpen={id => void openNode(id)} onLegacy={onLegacy} onDownload={() => void downloadPortfolio()} />
  </main>
  return <main className="learning-studio" aria-busy={busy}>
    {offline && <aside className="learning-studio__notice" role="status">인터넷 연결이 끊긴 것으로 감지했어요. 편집은 계속할 수 있지만 서버 저장·실행은 연결 후 다시 시도해 주세요. 현재 작성 내용을 내려받아 보관할 수 있어요.</aside>}
    <nav className="learning-home__nav" aria-label="학습 공간"><button disabled={busy} onClick={() => void openHome('home')}>← 학습 홈</button><button disabled={busy} onClick={() => void openHome('records')}>학습 기록</button></nav>
    {!isFoundation && <section className="learning-path__mode" aria-label="현재 미션 과제 기준"><strong>{assignment.title}</strong><p>{assignment.summary}</p>{assignment.has_transfer && <p>다른 문제에 적용하기: {assignment.transfer_required ? '필수' : '선택 · 본 과제만으로 제출 가능'}</p>}{assignment.steps.length > 0 && <ol>{assignment.steps.map(step => <li key={step}>{step}</li>)}</ol>}{assignment.pinned && pathProfile?.level && assignment.level !== pathProfile.level && !['M01', 'M02'].includes(node.id) && <p role="status">학습 홈의 현재 선택은 {pathProfile.levels.find(level => level.id === pathProfile.level)?.title}입니다. 이 미션은 처음 저장한 {assignment.title} 기준으로 이어가며, 난이도를 바꿔도 기존 답안과 완료 기준은 바뀌지 않습니다.</p>}<small>{assignment.pinned ? '이 미션에 저장된 과제 기준입니다. 학습 경로를 바꿔도 그대로 이어갑니다.' : '첫 초안 저장 시 이 과제 기준으로 고정됩니다. 다른 경로는 학습 홈에서 선택하세요.'}</small></section>}
    <header className="learning-studio__heading"><div><p className="learning-studio__kicker">만들며 배우는 웹 개발</p><h1>{catalogue.title}</h1><p>{isFoundation ? '필요한 개념을 연습한 뒤 미션으로 돌아가세요.' : `미션 ${workspace.completed_ids.length}/${availableCount}개 확인 완료 · 목표 확인 → 구현 → 실행 → 결과 확인`}</p></div></header>
    <div className="learning-studio__layout">
      <aside className="learning-studio__rail" aria-label="학습 경로">
        {catalogue.units.map((unit) => <section key={unit.id}><h2>{unit.title}</h2><ol>{workspace.missions.filter((mission) => mission.unit_id === unit.id).map((mission) => <li key={mission.id}><button aria-current={node.id === mission.id ? 'step' : undefined} disabled={editingBlocked || !mission.available || !mission.unlocked} onClick={() => void openNode(mission.id)}><span>{mission.id} · {mission.title}</span><small>{!mission.available ? '준비 중' : !mission.unlocked ? '선수 미션 확인 필요' : statusLabels[mission.status] ?? mission.status}</small></button></li>)}</ol></section>)}
        <details><summary>필요할 때 · 기초 연습</summary>{workspace.foundations.map((foundation) => <button key={foundation.id} disabled={editingBlocked} onClick={() => void openNode(foundation.id)} aria-current={node.id === foundation.id ? 'step' : undefined}>{foundation.id} · {foundation.title}<small>{statusLabels[foundation.status]}</small></button>)}</details>
      </aside>
      <article className="learning-studio__lesson" key={node.id}>
        <header><p className="learning-studio__kicker">{isFoundation ? '선택 기초 연습 · 미션 진도와 별도' : `${node.id} · 만들고 확인하는 미션`}</p><h2>{node.title}</h2><p>{node.objective}</p><p>{node.task}</p>{isFoundation && <><button disabled={editingBlocked} onClick={() => void openNode(returnNode)}>← {returnNode} 미션으로 돌아가기</button>{nextFoundation && <button disabled={editingBlocked} onClick={() => void openNode(nextFoundation)}>다음 추천 기초 · {nextFoundation}</button>}</>}</header>
        {node.practice_guide && <section className="learning-studio__section"><h3>이번에 만들 결과 · {node.practice_guide.outcome}</h3><ol>{node.practice_guide.steps.map(step => <li key={step}>{step}</li>)}</ol><p><strong>이렇게 나오면 돼요: </strong>{node.practice_guide.expected}</p><details><summary>결과가 다르면 먼저 확인할 것</summary><p>{node.practice_guide.troubleshooting}</p></details></section>}
        {!isFoundation && assignment.version !== 'practice-v2' && work.version > 0 && work.status !== 'PASSED' && <aside className="learning-studio__notice"><p>반복 서술을 선택 메모로 줄인 실습 방식이 있어요. 코드와 작성 내용은 보존하고, 제출 기준을 전환한 뒤 다시 확인합니다. 완료를 자동으로 인정하지 않습니다.</p><button type="button" disabled={editingBlocked} onClick={() => void action(async () => { const saved = await persist(); const details = await curriculumService.upgradePractice(enrollment.id, node.id, saved.version); const draft = readLearningDraft(draftKey(userId, enrollment.id, node.id)); if (draft) clearLearningDraft(draftKey(userId, enrollment.id, node.id), draft); applyNode(details, enrollment.id); setWorkspace(await curriculumService.workspace(enrollment.id)); setNotice('작성한 코드를 유지하고 실습 방식으로 전환했어요. 목표와 실행 결과를 확인해 주세요.') })}>작성 내용 유지하고 실습 방식으로 전환</button></aside>}
        {error && <div className="learning-studio__error" role="alert"><strong>요청을 완료하지 못했어요</strong><p>{error}</p><p>지금 입력한 내용은 화면에 남아 있어요. 저장본을 다시 열기 전에 내려받을 수 있습니다.</p><button onClick={exportDraft}>현재 작성 내용 내려받기</button>{saveConflict && <button disabled={editingBlocked} onClick={() => void action(compareLatest)}>작성 내용 보관하고 최신 서버 답안과 비교</button>}</div>}
        {saveConflict && !error && !recovery && <aside className="learning-studio__notice" role="status"><strong>다른 창에서 이 답안을 저장했어요.</strong><p>현재 작성 내용은 유지됩니다. 최신 서버 답안과 비교한 뒤 저장을 이어가세요.</p><button disabled={busy} onClick={() => void action(compareLatest)}>작성 내용 보관하고 최신 서버 답안과 비교</button><button onClick={exportDraft}>현재 작성 내용 내려받기</button></aside>}
        {recovery && <LearningDraftRecovery key={`${node.id}:${work.version}:${recovery.updatedAt ?? ''}`} draft={recovery} work={work} node={node} busy={busy} onRestore={(merged) => {
          clearLearningDraft(draftKey(userId, enrollment.id, node.id), recovery)
          setAnswers(merged); setRecovery(null); setError(''); setSaveConflict(false)
          writeLearningDraft(draftKey(userId, enrollment.id, node.id), learningSnapshot(work, merged, node.assignment.key))
          setNotice('선택한 내용을 편집기로 가져왔어요. 확인한 뒤 초안을 저장해 주세요.')
        }} onDownload={() => downloadText(`WebLink-${node.id}-복구본.json`, JSON.stringify({ node_id: node.id, ...recovery }, null, 2))} onDiscard={() => {
          clearLearningDraft(draftKey(userId, enrollment.id, node.id), recovery)
          setRecovery(null); setAnswers(initialAnswers({ ...node, work })); setError(''); setSaveConflict(false); setNotice('서버 답안을 사용합니다.')
        }} />}
        <details key={`${node.id}:${assignment.key}`} className="learning-studio__section learning-path__guidance" open={isFoundation || assignment.level !== 'EXPERIENCED'}><summary>1. 동작 원리 살펴보기</summary><p>{node.prediction}</p>{isFoundation ? <FoundationPractice key={node.id} id={node.id} /> : <LearningFlow nodeId={node.id} />}<details><summary>관찰할 내용</summary><p>{node.practice.expected_observation}</p></details></details>
        <form onSubmit={(event) => { event.preventDefault(); void action(async () => { await persist(); setNotice('서버에 초안을 저장했어요. 저장은 제출·완료와 별개입니다.'); setWorkspace(await curriculumService.workspace(enrollment.id)) }) }}>
          <LearningWorkFields node={node} enrollmentId={enrollment.id} answers={answers} work={work} fields={visibleFields} history={executionHistory} feedback={feedback} validationIssues={validationIssues} disabled={editingBlocked} transferRequired={assignment.transfer_required} onEdit={edit} onRuntime={(field, signal) => runSavedRuntime(field, signal)} onJavaScript={runSavedJavaScript} />
          <section className="learning-studio__section" id="learning-field-concept_answer" tabIndex={-1}><h3>{assignment.has_transfer ? 4 : 3}. 개념 확인</h3><fieldset disabled={editingBlocked}><legend>{node.concept_check.prompt}</legend>{node.concept_check.choices.map((choice) => <label className="learning-studio__choice" key={choice}><input type="radio" name="concept_answer" value={choice} checked={answers.concept_answer === choice} onChange={() => edit('concept_answer', choice)} />{choice}</label>)}</fieldset>{(validationIssues.concept_answer || feedback?.issues.concept_answer) && <p className="learning-studio__issue">{validationIssues.concept_answer || feedback?.issues.concept_answer}</p>}</section>
          <div className="learning-studio__actions"><span>{dirty ? '저장 전 변경 있음' : work.version ? `서버 저장본 v${work.version}${work.updated_at ? ` · ${new Date(work.updated_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : ''}` : '아직 저장하지 않았어요'}</span><div><button type="submit" disabled={editingBlocked}>{busy ? '처리 중…' : '초안 저장'}</button><button id="learning-field-reopen" type="button" disabled={editingBlocked || !work.version || dirty} onClick={() => void action(async () => { applyNode(await curriculumService.node(enrollment.id, node.id), enrollment.id); setNotice('서버 저장본을 다시 불러왔어요.') })}>저장본 다시 열기</button><button className="learning-studio__primary" type="button" disabled={editingBlocked || !node.unlocked} onClick={() => void checkPractice()}>저장하고 실습 확인하기</button></div></div>
          {checkStage && <p className="learning-studio__notice" role="status">{checkStage}</p>}
          {gaps.length > 0 && <aside className="learning-studio__notice" role="alert"><strong>실습 확인 전에 {gaps.length}개 항목을 살펴보세요</strong><ul>{gaps.map(item => <li key={item.id}><p>{item.label} · {item.message}</p><button type="button" disabled={editingBlocked} onClick={() => goToAnswer(item.id)}>항목으로 이동 · {item.label}</button></li>)}</ul><p>검사 요청 시점의 초안은 저장했어요. 추가 수정은 다시 저장해 주세요. 아직 실행·제출하지 않았으며 정답을 판정한 결과는 아닙니다.</p></aside>}
          <p className="learning-studio__muted">Ctrl+S / ⌘S로 초안 저장 · 실습 확인 버튼은 현재 내용을 저장한 뒤 검사합니다.</p>
        </form>
        {notice && <p className="learning-studio__notice" role="status">{notice}</p>}
        {work.status === 'STALE' && <p className="learning-studio__notice">답안이나 앞 수업의 확인 내용이 바뀌었어요. 이전 기록과 작성 코드는 남아 있어요. 아래에서 재확인이 필요한 이유를 확인하세요. 선수 수업이 미완료면 먼저 확인하고, 이미 완료됐다면 현재 실습을 다시 확인하세요.</p>}
        {!!node.prerequisite_rechecks?.length && <aside className="learning-studio__notice"><strong>다시 확인할 내용</strong><ul>{node.prerequisite_rechecks.map(item => <li key={item.id}><p>{item.id} · {item.title} — {item.reason === 'CHANGED' ? '앞 수업의 내용이 바뀌었어요. 현재 코드를 검토하고 ‘저장하고 실습 확인하기’를 눌러 주세요.' : '이 수업의 현재 답안을 먼저 확인해야 해요.'}</p><button type="button" disabled={editingBlocked || !item.can_open} onClick={() => void openNode(item.id)}>{item.can_open ? item.reason === 'CHANGED' ? `${item.id} 변경된 내용 보기` : `${item.id} 확인하러 가기` : '더 앞의 선수 수업 확인 필요'}</button></li>)}</ul><p>작성한 코드를 지우거나 처음부터 다시 만들 필요는 없어요. 앞 수업 확인 후 돌아와 저장한 실습을 다시 확인하세요.</p></aside>}
        {feedback && <section className="learning-studio__feedback" aria-live="polite"><h3>{feedback.passed ? '확인 완료' : '조금 더 살펴보기'}</h3>{Object.keys(feedback.issues).filter(id => node.fields.some(field => field.id === id) || ['concept_answer', 'reopen'].includes(id)).map(id => <button key={id} type="button" disabled={editingBlocked} onClick={() => goToAnswer(id)}>항목으로 이동 · {node.fields.find(field => field.id === id)?.label ?? (id === 'concept_answer' ? '개념 확인' : '저장본 다시 열기')}</button>)}{Object.entries(feedback.issues).map(([key, issue]) => <p key={key}><strong>{node.fields.find(field => field.id === key)?.label ?? (key === 'concept_answer' ? '개념 확인' : key === 'source' ? '본 과제 실행' : '확인할 내용')}: </strong>{issue}</p>)}<p>{feedback.scope}</p>{feedback.checks && feedback.checks.length > 0 && <ul className="learning-html-checks">{feedback.checks.map((check) => <li key={check.id}><strong>{check.passed ? '✓' : '확인 필요'} · {check.label}</strong><span>{check.message}</span></li>)}</ul>}{executionEvidence.length > 0 && <details><summary>저장본 v{work.version}의 실행 근거 보기 · 새 실행 없음</summary><p>실습 확인 때 서버에 보관한 실행 결과입니다. 다시 펼쳐도 코드 실행이나 완료 기록을 추가하지 않습니다.</p>{executionEvidence.map(item => <details key={item.field}><summary>{item.label} · 실행에서 확인한 내용</summary>{item.field === 'baseline_source' && <p>실패 재현본은 기능 오류를 관찰하는 단계예요. 아래 실패 항목과 수정본의 결과를 비교하세요. 실행 환경 장애는 기능 오류 재현과 구분합니다.</p>}<LearningExecutionDetails report={item.report} showChecks={item.field !== 'source' || !feedback.checks?.length} /></details>)}</details>}{feedback.recommendation && <><p>{feedback.recommendation.message}</p>{feedback.recommendation.foundation_ids.map((id) => <button key={id} disabled={editingBlocked} onClick={() => void openNode(id)}>{id} 설명 보기</button>)}</>}{feedback.passed && next && <button className="learning-studio__primary" disabled={editingBlocked} onClick={() => void openNode(next)}>다음 미션 · {next}</button>}{feedback.passed && !isFoundation && !next && <p>{workspace.completed_ids.length === 12 ? '12개 미션의 현재 저장본을 모두 확인했어요. 학습 기록과 코드를 내려받아 다음 프로젝트에 참고하세요.' : '현재 저장본과 선수 미션의 확인 상태를 학습 경로에서 살펴보세요.'}</p>}</section>}
        <details className="learning-help"><summary>막혔을 때 · 단계별 힌트</summary><p>힌트를 사용해도 감점하지 않아요.</p>{hintText && <p role="status"><strong>H{hintLevel}</strong> · {hintText}</p>}<button disabled={editingBlocked || hintLevel >= 4} onClick={() => void action(async () => { const result = await curriculumService.hint(enrollment.id, node.id, hintLevel + 1); setHintLevel(result.level); setHintText(result.text) })}>{hintLevel >= 4 ? '모든 힌트를 확인했어요' : `H${hintLevel + 1} 힌트 보기`}</button><p>{node.recovery}</p>{node.foundation_ids.map((id) => <button key={id} disabled={editingBlocked} onClick={() => void openNode(id)}>{id} 기초 설명 보기</button>)}</details>
        {['M10', 'M12'].includes(node.id) && <section className="learning-studio__section"><h3>개인 프로젝트로 이어 만들기</h3><p>처음에는 확인한 코드와 로컬 실행 구성을 개인 프로젝트에 보관합니다. 이미 만든 프로젝트는 그대로 열며 자동으로 덮어쓰거나 사본을 추가하지 않습니다.</p>
          {handoffBusy && <p role="status">프로젝트 연결 상태를 확인하고 있어요…</p>}
          {handoffError && <p role="alert">{handoffError}<button disabled={editingBlocked || handoffBusy} onClick={() => setBridgeReload(value => value + 1)}>프로젝트 상태 다시 확인</button></p>}
          {(node.project_handoffs ?? []).map(item => <div key={item.field}><p><strong>{item.field === 'source' ? '본 과제' : '다른 문제에 적용한 과제'}</strong> · {item.reason}</p>
            {item.source_changed && <p>학습 코드가 프로젝트를 만든 뒤 바뀌었어요. 열기만 하면 프로젝트 파일은 그대로 유지됩니다. 아래 비교 기능에서 변경을 반영할 수 있어요.</p>}
            {!item.can_open && dirty && <p>수정한 내용을 저장하고 실습 확인을 마친 뒤 프로젝트를 만들 수 있어요.</p>}
            <button type="button" disabled={editingBlocked || bridgeActive || handoffBusy || Boolean(handoffError) || !work.version || (!item.can_open && (!item.can_create || dirty || work.status !== 'PASSED'))} onClick={() => void openHandoff(item.field)}>{item.can_open ? `프로젝트 열기 · ${item.project_name}` : item.field === 'source' ? '본 과제 프로젝트 만들기' : '다른 문제에 적용한 프로젝트 만들기'}</button>
          </div>)}
        </section>}
        {['M10', 'M12'].includes(node.id) && node.project_handoffs?.some(item => item.can_open) && <LearningProjectUpdate key={`${enrollment.id}/${node.id}`} enrollmentId={enrollment.id} nodeId={node.id} version={work.version} projectFields={(node.project_handoffs ?? []).filter(item => item.can_open).map(item => ({ id: item.field, label: item.project_name ?? item.field }))} disabled={editingBlocked || dirty || bridgeActive || handoffBusy || Boolean(handoffError) || work.status !== 'PASSED'} onApplied={() => { setBridgeReload(value => value + 1); setNotice('') }} />}
        {historyError && <section className="learning-studio__notice"><p>저장한 실행 기록을 읽지 못했어요. 현재 작성 내용은 유지됩니다. {historyError}</p><button disabled={editingBlocked} onClick={() => setHistoryRetry(value => value + 1)}>실행 기록 다시 읽기</button></section>}
        <LearningProjectBridge key={`${enrollment.id}/${node.id}/${bridgeReload}`} enrollmentId={enrollment.id} disabled={editingBlocked} onActive={setBridgeActive} renderFoundation={id => <FoundationPractice id={id} />} onOpen={async (id, jump) => { await action(async () => { if (dirty) await persist(); await onOpenProject(id, jump) }) }} />
        <ManualAI key={node.id} node={node} answers={answers} feedback={feedback} />
        <footer className="learning-studio__footer"><button onClick={exportDraft}>현재 작성 내용 내려받기</button><p>저장한 답안과 전체 과정 다운로드는 위의 학습 기록에서 확인할 수 있어요.</p></footer>
      </article>
    </div>
  </main>
}
