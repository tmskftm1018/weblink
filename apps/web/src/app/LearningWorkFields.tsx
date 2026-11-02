import { CodeExecutionReport, JavaScriptReport, LearningExecutionSummary, LearningNode, LearningWork, WorkFeedback, curriculumService } from '../services/learning'
import HtmlFormExercise from './HtmlFormExercise'
import JavaScriptExercise from './JavaScriptExercise'
import RuntimeCodeExercise from './RuntimeCodeExercise'

type Field = LearningNode['fields'][number]
const isTransfer = (field: Field) => field.id.startsWith('transfer_')
const transferOrder = ['transfer_mode', 'transfer_source', 'transfer_api_source', 'transfer_explanation']

export default function LearningWorkFields({ node, enrollmentId, answers, work, fields, history, feedback, validationIssues, disabled, transferRequired, onEdit, onRuntime, onJavaScript }: {
  node: LearningNode; enrollmentId: string; answers: Record<string, string>; work: LearningWork; fields: Field[]
  history: LearningExecutionSummary[]; feedback: WorkFeedback | null; disabled: boolean; transferRequired: boolean
  validationIssues: Record<string, string>
  onEdit: (field: string, value: string) => void
  onRuntime: (field: string, signal: AbortSignal) => Promise<CodeExecutionReport>
  onJavaScript: () => Promise<JavaScriptReport>
}) {
  const mainFields = fields.filter(field => !isTransfer(field) && !field.practice_note)
  const notes = fields.filter(field => field.practice_note)
  const transferFields = fields.filter(field => isTransfer(field) && !field.practice_note).sort((a, b) => transferOrder.indexOf(a.id) - transferOrder.indexOf(b.id))
  const hasCode = mainFields.some(field => field.kind === 'code')
  let instructions = '이 저장본은 기존 작성 기준을 사용합니다. 답안의 필수 항목을 확인해 주세요.'
  if (node.assignment.version === 'practice-v2') {
    instructions = hasCode
      ? '제공 코드를 완성하고 실행 결과를 확인하세요. 마지막에 개념 답을 고른 뒤 ‘저장하고 실습 확인하기’를 누르면 됩니다. 추가 기록은 선택 메모에 남길 수 있어요.'
      : '아래 항목과 개념 답을 선택한 뒤 ‘저장하고 실습 확인하기’를 누르세요. 선택 메모는 비워 두어도 됩니다.'
    if (node.id === 'M01') instructions = '아래 항목과 개념 답을 선택하고 ‘초안 저장’ → ‘저장본 다시 열기’ → ‘저장하고 실습 확인하기’ 순서로 확인하세요. 저장한 설정을 다시 불러오는 연습입니다.'
  }
  function render(field: Field) {
    const issue = validationIssues[field.id] ?? feedback?.issues[field.id]
    return <div className="learning-studio__field" key={field.id} id={`learning-field-${field.id}`} tabIndex={-1}>
      {field.kind === 'code' ? <strong>{field.label}</strong> : <label htmlFor={`learning-${field.id}`}>{field.label}</label>}
      {field.kind === 'code' && node.runtime?.language ? <RuntimeCodeExercise
        value={answers[field.id] ?? ''}
        starter={(node.starter_files?.[field.id] ?? (field.id === 'transfer_source' ? node.starter_transfer_code : node.starter_code)) ?? ''}
        language={field.language ?? node.runtime.language} integrated={['M10', 'M11', 'M12'].includes(node.id)}
        companion={Boolean(field.run_field && field.run_field !== field.id)}
        revisionTag={JSON.stringify(answers)} savedRevisionTag={JSON.stringify(work.answers)}
        history={history.filter(item => item.field === (field.run_field ?? field.id))} onRestore={curriculumService.restoreExecution}
        scope={node.runtime.scope} path={`learning/${enrollmentId}/${node.id}/${field.id}/${field.filename ?? node.runtime.filename}`}
        disabled={disabled} onChange={value => onEdit(field.id, value)} onRun={signal => onRuntime(field.run_field ?? field.id, signal)}
      /> : field.kind === 'code' && node.id === 'M04' ? <JavaScriptExercise value={answers[field.id] ?? ''} starter={node.starter_code ?? ''} path={`learning/${enrollmentId}/${node.id}/main.js`} disabled={disabled} onChange={value => onEdit(field.id, value)} onRun={onJavaScript} />
        : field.kind === 'code' ? <HtmlFormExercise value={answers[field.id] ?? ''} starter={node.starter_code ?? ''} path={`learning/${enrollmentId}/${node.id}/index.html`} disabled={disabled} onChange={value => onEdit(field.id, value)} />
          : field.kind === 'choice' ? <select id={`learning-${field.id}`} value={answers[field.id] ?? ''} disabled={disabled} onChange={event => onEdit(field.id, event.target.value)}><option value="">선택해 주세요</option>{field.choices?.map(choice => <option key={choice}>{choice}</option>)}</select>
            : <textarea id={`learning-${field.id}`} value={answers[field.id] ?? ''} disabled={disabled} onChange={event => onEdit(field.id, event.target.value)} placeholder={field.placeholder} maxLength={4000} rows={3} aria-describedby={issue ? `issue-${field.id}` : undefined} />}
      {issue && <small className="learning-studio__issue" id={`issue-${field.id}`}>{issue}</small>}
    </div>
  }
  return <>
    <section className="learning-studio__section"><h3>2. {hasCode ? '본 과제 · 작성하고 실행하기' : '선택하고 확인하기'}</h3><p>{instructions}</p>{mainFields.map(render)}</section>
    {transferFields.length > 0 && <details key={`${node.id}:${transferRequired}`} className="learning-studio__section learning-transfer" open={transferRequired || answers.transfer_mode === '전이 과제도 도전하기'}>
      <summary>3. 다른 문제에 적용하기 · {transferRequired ? '필수 과제' : '선택 과제'}</summary>
      <p>{transferRequired ? '이 미션은 다른 문제의 코드와 실행 결과까지 확인해야 완료할 수 있어요.' : '본 과제부터 마칠 수 있어요. 도전을 선택하면 다른 문제의 코드와 실행도 확인합니다.'}</p>
      <p>{node.transfer_task}</p>{transferFields.map(render)}
      {node.id === 'M12' && node.assignment.version === 'practice-v2' && <p>두 앱의 연결 원리는 본 과제의 ‘UI·API·DB의 책임과 실제 실행 근거’에 한 번 정리하면 됩니다. 추가 응용 메모는 선택이에요.</p>}
    </details>}
    {notes.length > 0 && <details className="learning-studio__section"><summary>선택 메모 · 예상·관찰·설명 남기기</summary><p>메모를 쓰지 않아도 제출할 수 있어요. 입력한 내용은 코드와 함께 저장됩니다. 메모의 문장 품질을 자동 채점하지 않습니다.</p>{notes.map(render)}</details>}
  </>
}
