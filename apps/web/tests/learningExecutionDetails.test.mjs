import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const built = buildSync({
  stdin: { contents: `import { createElement } from 'react'; import { renderToStaticMarkup } from 'react-dom/server.browser'; import Details from './src/app/LearningExecutionDetails'; export function render(report, showChecks = true) { return renderToStaticMarkup(createElement(Details, { report, showChecks })); }`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'tsx' },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', logLevel: 'silent',
})
const { render } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString('base64')}`)

test('requests, responses and persistent rows are readable without a new run', () => {
  const html = render({ status: 'COMPLETED', requests: [{ method: 'POST', path: '/api/notes', status: 201, payload: { text: '새 메모' }, body: { id: 1, text: '새 메모' } }], database_rows: [[1, '새 메모']], restarted: true, database_after_restart: [[1, '새 메모']] })
  assert.match(html, /보낸 값 · 요청/)
  assert.match(html, /돌아온 값 · 응답/)
  assert.match(html, /서버가 자료를 새로 등록/)
  assert.match(html, /서버 재시작 후 SQLite 행/)
})
test('learner strings are escaped and snapshot scripts and event handlers are discarded', () => {
  const html = render({ status: 'CODE_ERROR', error: '<script>bad()</script>', tree: { type: 'div', props: { onClick: 'bad()' }, children: [{ type: 'script', children: ['bad()'] }, { type: 'button', props: { onClick: 'bad()' }, children: ['등록'] }] } })
  assert.doesNotMatch(html, /<script>|onclick=/i)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /disabled/)
})
test('main feedback can omit repeated checks without losing failed execution details', () => {
  const html = render({ status: 'CODE_ERROR', error: '구문 오류', checks: [{ id: 'a', label: '중복 검사 이름', passed: false, message: '확인' }] }, false)
  assert.match(html, /구문 오류/)
  assert.doesNotMatch(html, /중복 검사 이름/)
})


test('unavailable execution is not presented as learner failure', () => {
  const html = render({ status: 'UNAVAILABLE' })
  assert.match(html, /코드가 틀렸다고 판단하지 않아요/)
  assert.doesNotMatch(html, /모두 통과했어요|확인 필요 ·/)
})

test('case summaries show observed calls and errors rather than invented per-case grades', () => {
  const html = render({ status: 'COMPLETED', cases: [
    { title: '   ', input: '   ', prevented: true, calls: [], error: '제목을 입력하세요.' },
    { title: '새 글', input: '새 글', prevented: true, calls: [{ title: '새 글', content: '' }], error: '' },
  ], checks: [{ id: 'validation', label: '빈 값 거절', passed: false, message: '저장 전에 확인하세요.' }] })
  assert.match(html, /저장 요청 0회/)
  assert.match(html, /저장 요청 1회/)
  assert.match(html, /1개 중 1개 동작을 더 확인/)
  assert.match(html, /저장 전에 확인하세요/)
  assert.match(html, /전체 검사 항목/)
})

test('successful execution reports distinguish runtime checks from mission submission', () => {
  const html = render({ status: 'COMPLETED', checks: [{ id: 'a', label: '저장', passed: true, message: '확인' }] })
  assert.match(html, /실행 검사 1개를 모두 통과/)
  assert.match(html, /수업 완료는 개념 답과 필수 과제를 제출한 뒤/)
})
