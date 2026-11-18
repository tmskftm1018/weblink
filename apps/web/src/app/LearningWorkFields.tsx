import { CodeExecutionReport, JavaScriptReport, LearningExecutionSummary, LearningNode, LearningWork, WorkFeedback, curriculumService } from '../services/learning'
import HtmlFormExercise from './HtmlFormExercise'
import JavaScriptExercise from './JavaScriptExercise'
import RuntimeCodeExercise from './RuntimeCodeExercise'
import { LessonPhase, lessonFieldPhase } from '../services/learningPhases'
import { learningEdits } from '../services/learningPresentation'
import { setupFieldStep, setupSteps } from '../services/learningSetup'

type Field = LearningNode['fields'][number]
const isTransfer = (field: Field) => field.id.startsWith('transfer_')
const transferOrder = ['transfer_mode', 'transfer_source', 'transfer_api_source', 'transfer_explanation']

export default function LearningWorkFields({ node, enrollmentId, answers, work, fields, history, feedback, validationIssues, disabled, transferRequired, phase, setupStep, onSetupStep, onEdit, onRuntime, onJavaScript }: {
  node: LearningNode; enrollmentId: string; answers: Record<string, string>; work: LearningWork; fields: Field[]
  history: LearningExecutionSummary[]; feedback: WorkFeedback | null; disabled: boolean; transferRequired: boolean
  validationIssues: Record<string, string>
  phase: LessonPhase | null
  setupStep: number; onSetupStep: (step: number) => void
  onEdit: (field: string, value: string) => void
  onRuntime: (field: string, signal: AbortSignal) => Promise<CodeExecutionReport>
  onJavaScript: () => Promise<JavaScriptReport>
}) {
  const activeFields = fields.filter(field => !field.practice_note)
  const mainFields = activeFields.filter(field => !isTransfer(field) && (!phase || lessonFieldPhase(field.id, field.kind) === 'practice'))
  const baselineFields = activeFields.filter(field => lessonFieldPhase(field.id, field.kind) === 'baseline')
  const reviewFields = activeFields.filter(field => lessonFieldPhase(field.id, field.kind) === 'review')
  const notes = fields.filter(field => field.practice_note)
  const transferFields = fields.filter(field => isTransfer(field) && !field.practice_note).sort((a, b) => transferOrder.indexOf(a.id) - transferOrder.indexOf(b.id))
  const hasCode = mainFields.some(field => field.kind === 'code')
  const steppedSetup = node.id === 'M01' && node.assignment.version === 'practice-v2'
  const nextReady = mainFields.filter(field => setupFieldStep(field.id) === setupStep).every(field => field.kind !== 'choice' || field.choices?.includes(answers[field.id] ?? ''))
  let instructions = '이 저장본은 기존 작성 기준을 사용합니다. 답안의 필수 항목을 확인해 주세요.'
  if (node.assignment.version === 'practice-v2') {
    instructions = hasCode
      ? learningEdits[node.id] ?? '코드를 완성하고 실행 결과를 확인한 뒤 개념 답을 선택하세요.'
      : '아래 항목과 개념 답을 선택한 뒤 ‘저장하고 실습 확인하기’를 누르세요. 선택 메모는 비워 두어도 됩니다.'
    if (node.id === 'M01') instructions = '아래 항목과 개념 답을 선택하고 ‘초안 저장’ → ‘저장본 다시 열기’ → ‘저장하고 실습 확인하기’ 순서로 확인하세요. 저장한 설정을 다시 불러오는 연습입니다.'
  }
  function render(field: Field) {
    if (field.kind === 'code' && field.run_field && field.run_field !== field.id && fields.some(item => item.id === field.run_field)) return null
    const paired = fields.find(item => item.kind === 'code' && item.run_field === field.id && item.id !== field.id)
    const issue = validationIssues[field.id] ?? feedback?.issues[field.id]
    if (field.kind === 'choice') {
      return <fieldset className="learning-studio__field journal-question" key={field.id} id={`learning-field-${field.id}`} tabIndex={-1} hidden={steppedSetup && setupFieldStep(field.id) !== setupStep} disabled={disabled}>
        <legend>{field.label}</legend>
        {field.choices?.map(choice => <label className="learning-studio__choice" key={choice}>
          <input type="radio" name={field.id} value={choice} checked={answers[field.id] === choice} onChange={() => onEdit(field.id, choice)} />
          {choice === 'WebLink 설명과 힌트' ? '수업 설명과 힌트' : choice}
        </label>)}
        {field.previous_response && !field.choices?.includes(answers[field.id] ?? '') && <details>
          <summary>이전에 저장한 서술 답안</summary><p>{answers[field.id]}</p>
        </details>}
        {issue && <small className="learning-studio__issue">{issue}</small>}
      </fieldset>
    }
    return <div className="learning-studio__field" key={field.id} id={`learning-field-${field.id}`} tabIndex={-1} hidden={steppedSetup && setupFieldStep(field.id) !== setupStep}>
      {field.kind === 'code' ? <strong>{paired ? field.id === 'baseline_source' ? '실패 재현본 · 화면과 API' : field.id === 'transfer_source' ? '응용 과제 · 화면과 API' : node.id === 'M11' ? '수정본 · 화면과 API' : '본 과제 · 화면과 API' : field.label}</strong> : <label htmlFor={`learning-${field.id}`}>{field.label}</label>}
      {field.kind === 'code' && node.runtime?.language ? <RuntimeCodeExercise
        value={answers[field.id] ?? ''}
        starter={(node.starter_files?.[field.id] ?? (field.id === 'transfer_source' ? node.starter_transfer_code : node.starter_code)) ?? ''}
        language={field.language ?? node.runtime.language} integrated={['M10', 'M11', 'M12'].includes(node.id)}
        companion={Boolean(field.run_field && field.run_field !== field.id)}
        primaryField={field.id}
        pairedFile={paired ? { id: paired.id, label: paired.label, value: answers[paired.id] ?? '', starter: node.starter_files?.[paired.id] ?? '', path: `learning/${enrollmentId}/${node.id}/${paired.id}/${paired.filename ?? 'main.py'}`, issue: validationIssues[paired.id] ?? feedback?.issues[paired.id], onChange: value => onEdit(paired.id, value) } : undefined}
        revisionTag={JSON.stringify(answers)} savedRevisionTag={JSON.stringify(work.answers)}
        history={history.filter(item => item.field === (field.run_field ?? field.id))} onRestore={curriculumService.restoreExecution}
        scope={node.runtime.scope} path={`learning/${enrollmentId}/${node.id}/${field.id}/${field.filename ?? node.runtime.filename}`}
        disabled={disabled} onChange={value => onEdit(field.id, value)} onRun={signal => onRuntime(field.run_field ?? field.id, signal)}
      /> : field.kind === 'code' && node.id === 'M04' ? <JavaScriptExercise value={answers[field.id] ?? ''} starter={node.starter_code ?? ''} path={`learning/${enrollmentId}/${node.id}/main.js`} disabled={disabled} onChange={value => onEdit(field.id, value)} onRun={onJavaScript} />
        : field.kind === 'code' ? <HtmlFormExercise value={answers[field.id] ?? ''} starter={node.starter_code ?? ''} path={`learning/${enrollmentId}/${node.id}/index.html`} disabled={disabled} onChange={value => onEdit(field.id, value)} />
          : <textarea id={`learning-${field.id}`} value={answers[field.id] ?? ''} disabled={disabled} onChange={event => onEdit(field.id, event.target.value)} placeholder={field.placeholder} maxLength={4000} rows={3} aria-describedby={issue ? `issue-${field.id}` : undefined} />}
      {issue && <small className="learning-studio__issue" id={`issue-${field.id}`}>{issue}</small>}
    </div>
  }
  return <>
    {phase && baselineFields.length > 0 && <section id="lesson-phase-baseline" className="journal-practice" hidden={phase !== 'baseline'} tabIndex={-1}>
      <p className="journal-practice__instruction">글이 저장되는데 목록에 나타나지 않는 오류를 재현하고 실행 결과를 골라 보세요.</p>
      {baselineFields.map(render)}
    </section>}
    <section id="lesson-phase-practice" tabIndex={-1} hidden={Boolean(phase && phase !== 'practice')} className={hasCode ? 'journal-practice' : 'learning-studio__section'}>
      {steppedSetup ? <><h3>{setupStep + 1}/3 · {setupSteps[setupStep]}</h3><p>{setupStep === 0 ? '먼저 세 가지만 골라 주세요. AI 도움은 선택이며 설명과 힌트만으로도 진행할 수 있어요.' : setupStep === 1 ? '모르는 문제도 생각한 답을 골라 보세요. 진단 오답은 복습 추천에만 사용해요.' : '아래 개념 답을 고르고 초안 저장 → 저장본 다시 열기 → 실습 확인 순서로 마쳐요.'}</p></> : <>{!hasCode && <h2>선택하고 확인하기</h2>}<p className="journal-practice__instruction">{instructions}</p></>}
      {mainFields.map(render)}
      {steppedSetup && <nav className="learning-html-exercise__toolbar" aria-label="첫 수업 단계">{setupStep > 0 && <button type="button" disabled={disabled} onClick={() => onSetupStep(setupStep - 1)}>← 이전 단계</button>}{setupStep < 2 && <button type="button" disabled={disabled || !nextReady} onClick={() => onSetupStep(setupStep + 1)}>다음 단계 →</button>}{setupStep < 2 && !nextReady && <small>위 항목을 모두 선택하면 다음 단계로 갈 수 있어요.</small>}</nav>}
    </section>
    {transferFields.length > 0 && <section id="lesson-phase-transfer" className="journal-practice" hidden={Boolean(phase && phase !== 'transfer')} tabIndex={-1}>
      {!transferRequired && transferFields.filter(field => field.id === 'transfer_mode').map(render)}
      {(transferRequired || answers.transfer_mode === '전이 과제도 도전하기') && <>
        <p className="journal-practice__instruction">{node.transfer_task}</p>
        {transferFields.filter(field => field.id !== 'transfer_mode').map(render)}
      </>}
    </section>}
    <div hidden={Boolean(phase && phase !== 'review')}>
      {phase && reviewFields.map(render)}
      {notes.some(field => answers[field.id]?.trim()) && <details className="learning-studio__section">
        <summary>이전에 저장한 실습 메모</summary>
        <dl>{notes.filter(field => answers[field.id]?.trim()).map(field => <div key={field.id}><dt>{field.label}</dt><dd>{answers[field.id]}</dd></div>)}</dl>
      </details>}
    </div>
  </>
}
