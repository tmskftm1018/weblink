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
