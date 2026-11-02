import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const built = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/services/learningGuidance.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
})
const { continuationId, aiHelpContext, submissionGaps, savedExecutionEvidence, httpResultExplanation } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString('base64')}`)
const mission = (id, status, unlocked = true, available = true) => ({ id, status, unlocked, available })
const workspace = { missions: [mission('M01', 'PASSED'), mission('M02', 'DRAFT'), mission('M03', 'NOT_STARTED', false)], foundations: [] }

test('completed current lesson leads to the next open unfinished lesson', () => {
  assert.equal(continuationId(workspace, 'M01', false), 'M02')
  assert.equal(continuationId(workspace, 'M03', false), 'M02')
})
test('recovery and unfinished current work retain their destination', () => {
  assert.equal(continuationId(workspace, 'M01', true), 'M01')
  assert.equal(continuationId(workspace, 'M02', false), 'M02')
  assert.equal(continuationId({ ...workspace, foundations: [{ id: 'C01', status: 'DRAFT' }] }, 'C01', false), 'C01')
})
test('all completed lessons lead to the integrated board for review', () => {
  assert.equal(continuationId({ missions: [mission('M01', 'PASSED'), mission('M10', 'PASSED')], foundations: [] }, 'M01', false), 'M10')
  assert.equal(continuationId({ missions: [mission('M10', 'PASSED', true, false)], foundations: [] }, 'M01', false), 'M01')
})
const node = {
  id: 'M05', title: '목록 만들기', objective: '목록 누적', task: '입력을 저장하세요', assignment: { title: '입문' },
  practice_guide: { outcome: '글 추가', expected: '두 글 누적', troubleshooting: '새 배열 확인' },
  fields: [{ id: 'source', label: 'React 코드' }, { id: 'observation', label: '메모', practice_note: true }],
}
test('default AI help contains learning contract but no personal work or feedback', () => {
  const text = aiHelpContext(node, { source: 'private code' }, false, { passed: false, issues: { source: 'private error' } })
  assert.match(text, /성공 조건: 두 글 누적/)
  assert.doesNotMatch(text, /private/)
})
test('opted-in AI help includes relevant code and current issues, omits optional notes and masks known secrets', () => {
  const text = aiHelpContext(node, { source: 'token=hidden-secret\nconst posts = [];', observation: 'personal diary' }, true, { passed: false, issues: { source: '목록 누적 실패' }, checks: [
    { label: '글 누적', message: '기존 목록을 보존하세요', passed: false },
    { label: '성공 항목', message: '이미 통과한 안내', passed: true },
  ] })
  assert.match(text, /const posts/)
  assert.match(text, /React 코드: 목록 누적 실패/)
  assert.match(text, /글 누적: 기존 목록을 보존하세요/)
  assert.match(text, /비밀값 가림/)
  assert.doesNotMatch(text, /hidden-secret|personal diary|이미 통과한 안내/)
})

const readyNode = {
  id: 'M05', assignment: { has_transfer: true, transfer_required: false },
  fields: [
    { id: 'source', label: 'React 코드', kind: 'code', min_length: 20 },
    { id: 'observation', label: '선택 메모', kind: 'text', min_length: 10, optional: true, practice_note: true },
    { id: 'transfer_source', label: '응용 코드', kind: 'code', min_length: 20, optional: true },
    { id: 'transfer_explanation', label: '응용 메모', kind: 'text', optional: true, practice_note: true },
  ],
  concept_check: { choices: ['선택 A', '선택 B'] },
}
const readyAnswers = { source: 'function App() { return null; }', concept_answer: '선택 B' }
const savedWork = { reopened: true }

test('preflight accepts any valid concept choice and leaves optional notes empty', () => {
  assert.deepEqual(submissionGaps(readyNode, readyAnswers, savedWork), [])
  assert.deepEqual(submissionGaps(readyNode, { ...readyAnswers, concept_answer: '선택 A' }, savedWork), [])
  assert.deepEqual(submissionGaps(readyNode, { source: readyAnswers.source }, savedWork).map(item => item.id), ['concept_answer'])
})
test('chosen or required transfer needs its code, never its optional notes', () => {
  assert.deepEqual(submissionGaps(readyNode, { ...readyAnswers, transfer_mode: '전이 과제도 도전하기' }, savedWork).map(item => item.id), ['transfer_source'])
  const required = { ...readyNode, assignment: { has_transfer: true, transfer_required: true } }
  assert.deepEqual(submissionGaps(required, readyAnswers, savedWork).map(item => item.id), ['transfer_source'])
  assert.deepEqual(submissionGaps(required, { ...readyAnswers, transfer_source: readyAnswers.source }, savedWork), [])
})
test('legacy required writing remains required and Unicode length matches server code points', () => {
  const legacy = { ...readyNode, fields: [{ id: 'observation', label: '관찰', kind: 'text', min_length: 4 }] }
  assert.deepEqual(submissionGaps(legacy, { ...readyAnswers, observation: '😀😀' }, savedWork).map(item => item.id), ['observation'])
  assert.deepEqual(submissionGaps(legacy, { ...readyAnswers, observation: '네 글자예요' }, savedWork), [])
})
test('M01 requires reopening its current saved settings', () => {
  assert.deepEqual(submissionGaps({ ...readyNode, id: 'M01' }, readyAnswers, { reopened: false }).map(item => item.id), ['reopen'])
  assert.deepEqual(submissionGaps({ ...readyNode, id: 'M01' }, readyAnswers, savedWork), [])
})

const projectBuilt = buildSync({
  entryPoints: [fileURLToPath(new URL('../src/services/projectExecution.ts', import.meta.url))],
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
})
const { projectExecutionMode } = await import(`data:text/javascript;base64,${Buffer.from(projectBuilt.outputFiles[0].contents).toString('base64')}`)
test('exported full-stack apps use Compose guidance even with an extra root Python file', () => {
  const files = ['compose.yaml', 'web/package.json', 'api/main.py'].map(path => ({ path }))
  assert.equal(projectExecutionMode(files), 'COMPOSE')
  assert.equal(projectExecutionMode([...files, { path: 'main.py' }]), 'COMPOSE')
})
test('a nested API or compose file alone is not a runnable root Python app', () => {
  assert.equal(projectExecutionMode([{ path: 'api/main.py' }]), 'MISSING')
  assert.equal(projectExecutionMode([{ path: 'compose.yaml' }]), 'MISSING')
  assert.equal(projectExecutionMode([{ path: 'main.py' }]), 'PYTHON')
})

test('saved evidence includes real failed and transfer observations in the right order', () => {
  const feedback = { baseline: { status: 'CODE_ERROR', error: 'before' }, execution: { status: 'COMPLETED', requests: [] }, transfer: { status: 'COMPLETED', database_rows: [[1, '메모']] } }
  const items = savedExecutionEvidence({ version: 4, status: 'NEEDS_WORK', feedback }, false)
  assert.deepEqual(items.map(item => item.field), ['baseline_source', 'source', 'transfer_source'])
  assert.equal(items[1].label, '수정본')
  assert.equal(items[0].report, feedback.baseline)
  assert.equal(items[2].report, feedback.transfer)
})
test('edited, stale and unsaved work cannot show evidence as its current result', () => {
  const work = { version: 4, status: 'PASSED', feedback: { execution: { status: 'COMPLETED' } } }
  assert.deepEqual(savedExecutionEvidence(work, true), [])
  assert.deepEqual(savedExecutionEvidence({ ...work, status: 'STALE' }, false), [])
  assert.deepEqual(savedExecutionEvidence({ ...work, version: 0 }, false), [])
})
test('legacy feedback without observations does not invent execution evidence', () => {
  assert.deepEqual(savedExecutionEvidence({ version: 1, status: 'PASSED', feedback: { passed: true, checks: [] } }, false), [])
})
test('HTTP guidance distinguishes input rejection, missing routes and server errors', () => {
  assert.match(httpResultExplanation(201), /새로 등록/)
  assert.match(httpResultExplanation(422), /입력 규칙/)
  assert.match(httpResultExplanation(404), /경로나 자료/)
  assert.match(httpResultExplanation(500), /서버 처리/)
  assert.doesNotMatch(httpResultExplanation(302), /입력 규칙/)
})

const validationBuild = buildSync({ entryPoints: [fileURLToPath(new URL('../src/services/learningErrors.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent' })
const { learningValidationMessage } = await import(`data:text/javascript;base64,${Buffer.from(validationBuild.outputFiles[0].contents).toString('base64')}`)

test('current-course validation describes code limits without echoing submitted secrets', () => {
  const text = learningValidationMessage('/enrollments/qa/nodes/M10/work', [{ type: 'value_error', loc: ['body', 'answers'], input: { source: 'private secret' }, msg: 'untrusted private secret' }])
  assert.match(text, /32,000자/)
  assert.match(text, /4,000자/)
  assert.doesNotMatch(text, /private secret|블록|object Object/)
})

test('current-course errors identify paired code, explain choices and handle malformed details', () => {
  assert.match(learningValidationMessage('/enrollments/qa/nodes/M10/work', [{ type: 'string_too_long', loc: ['body', 'answers', 'transfer_api_source'], ctx: { max_length: 32000 } }]), /응용 API 코드 입력.*32,000자/)
  assert.match(learningValidationMessage('/enrollments/qa/path', [{ type: 'literal_error', loc: ['body', 'level'] }]), /난이도.*보기/)
  assert.match(learningValidationMessage('/enrollments/qa/path', [null]), /입력 항목/)
  assert.equal(learningValidationMessage('/lessons/qa/submit', [{ type: 'missing' }]), null)
  assert.equal(learningValidationMessage('/enrollments/qa/path', '서버의 구체적인 안내'), null)
})
