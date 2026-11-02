import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildSync } from 'esbuild'

const built = buildSync({
  stdin: { contents: `export * from './src/services/answerRecovery'; export * from './src/services/browserDrafts'; export * from './src/services/learningDrafts'; export * from './src/services/projectRecovery';`, resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
})
const api = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString('base64')}`)
const work = (answers, version = 1) => ({ answers, version })
afterEach(() => { delete globalThis.window })

test('different fields merge while preserving the remote change', () => {
  const rows = api.compareAnswerRecovery({ baseAnswers: { source: 'base', observation: 'before' }, answers: { source: 'my code', observation: 'before' } }, { source: 'base', observation: 'remote observation' })
  assert.equal(rows.filter(row => row.conflict).length, 0)
  assert.deepEqual(api.resolveAnswerRecovery(rows, {}), { source: 'my code', observation: 'remote observation' })
})

test('two changes to the same field require a choice', () => {
  const rows = api.compareAnswerRecovery({ baseAnswers: { source: 'base' }, answers: { source: 'local' } }, { source: 'server' })
  assert.throws(() => api.resolveAnswerRecovery(rows, {}), /선택/)
  assert.deepEqual(api.resolveAnswerRecovery(rows, { source: 'server' }), { source: 'server' })
  assert.deepEqual(api.resolveAnswerRecovery(rows, { source: 'local' }), { source: 'local' })
})

test('matching changes do not require a conflict decision', () => {
  const rows = api.compareAnswerRecovery({ baseAnswers: { source: 'base' }, answers: { source: 'same new code' } }, { source: 'same new code' })
  assert.equal(rows[0].conflict, false)
  assert.deepEqual(api.resolveAnswerRecovery(rows, {}), { source: 'same new code' })
})

test('deletion and an intentionally empty value remain different', () => {
  const rows = api.compareAnswerRecovery({ baseAnswers: { source: 'old', observation: 'old' }, answers: { observation: '' } }, { source: 'old', observation: 'old' })
  assert.deepEqual(api.resolveAnswerRecovery(rows, {}), { observation: '' })
  assert.equal(rows.find(row => row.path === 'source').local, null)
})

test('old recovery without a baseline requires choices when the server advanced', () => {
  const rows = api.compareLearningRecovery({ version: 1, answers: { source: 'local' } }, work({ source: 'remote' }, 2))
  assert.equal(rows[0].conflict, true)
  assert.throws(() => api.resolveAnswerRecovery(rows, {}))
})

test('old recovery at the same server version can keep its local edits', () => {
  const rows = api.compareLearningRecovery({ version: 1, answers: { source: 'local' } }, work({ source: 'unchanged server' }))
  assert.equal(rows[0].conflict, false)
  assert.deepEqual(api.resolveAnswerRecovery(rows, {}), { source: 'local' })
})

test('snapshot records the source version and applied assignment', () => {
  const base = work({ source: 'server baseline' }, 3)
  const snapshot = api.learningSnapshot(base, { source: 'new local' }, 'level-v1:BEGINNER:0')
  assert.equal(snapshot.version, 3)
  assert.deepEqual(snapshot.baseAnswers, base.answers)
  assert.equal(snapshot.assignmentKey, 'level-v1:BEGINNER:0')
  assert.equal(api.matchesLearningWork(snapshot, work(snapshot.answers, 4), 'other-key'), false)
  assert.equal(api.matchesLearningWork(snapshot, work(snapshot.answers, 4), snapshot.assignmentKey), true)
})

test('answer equality does not depend on JSON key order', () => {
  assert.equal(api.sameAnswers({ source: 'a', observation: 'b' }, { observation: 'b', source: 'a' }), true)
  assert.equal(api.sameAnswers({ source: '' }, {}), false)
})

test('project recovery shares the same three-way merge', () => {
  const draft = { version: 2, baseAnswers: { 'main.py': 'base', 'README.md': 'base' }, answers: { 'main.py': 'my code', 'README.md': 'base' } }
  const files = [{ path: 'main.py', content: 'base' }, { path: 'README.md', content: 'new description' }]
  assert.deepEqual(api.resolveAnswerRecovery(api.compareProjectRecovery(draft, files), {}), { 'README.md': 'new description', 'main.py': 'my code' })
})

test('special file names are ordinary keys, not inherited object properties', () => {
  const values = Object.fromEntries([['__proto__', 'source'], ['constructor', 'notes']])
  const rows = api.compareAnswerRecovery({ baseAnswers: {}, answers: values }, {})
  const result = api.resolveAnswerRecovery(rows, {})
  assert.equal(Object.hasOwn(result, '__proto__'), true)
  assert.equal(result.__proto__, 'source')
  assert.equal(api.sameAnswers(values, result), true)
})

class MemoryStorage {
  values = new Map()
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, value) }
  removeItem(key) { this.values.delete(key) }
}
function storage() {
  globalThis.window = { sessionStorage: new MemoryStorage(), localStorage: new MemoryStorage() }
  return globalThis.window
}

test('saving in one tab does not clear a different recovery copy', () => {
  const state = storage()
  const mine = { version: 1, answers: { source: 'mine' }, assignmentKey: 'one' }
  api.writeBrowserDraft('draft', mine)
  const theirs = { version: 1, answers: { source: 'theirs' }, assignmentKey: 'one' }
  state.localStorage.setItem('draft', JSON.stringify(theirs))
  api.clearBrowserDraft('draft', mine)
  assert.equal(state.sessionStorage.getItem('draft'), null)
  assert.deepEqual(JSON.parse(state.localStorage.getItem('draft')), theirs)
})

test('a recovery copy with a different assignment is preserved', () => {
  const state = storage()
  const draft = { version: 0, answers: { source: 'same' }, assignmentKey: 'one' }
  api.writeBrowserDraft('draft', draft)
  api.clearBrowserDraft('draft', { ...draft, assignmentKey: 'two' })
  assert.notEqual(state.localStorage.getItem('draft'), null)
  api.clearBrowserDraft('draft', draft)
  assert.equal(state.localStorage.getItem('draft'), null)
})

test('blocked persistent storage falls back to the current tab', () => {
  const state = storage()
  state.localStorage.setItem = () => { throw new Error('quota') }
  const draft = { version: 0, answers: { source: 'local' } }
  assert.equal(api.writeBrowserDraft('draft', draft), 'session')
  assert.deepEqual(api.readBrowserDraft('draft'), draft)
  state.sessionStorage.setItem = () => { throw new Error('blocked') }
  assert.equal(api.writeBrowserDraft('another', draft), 'unavailable')
})

test('invalid recovery metadata is rejected', () => {
  assert.equal(api.parseBrowserDraft(JSON.stringify({ version: 0, answers: {}, assignmentKey: 42 })), null)
  assert.equal(api.parseBrowserDraft(JSON.stringify({ version: 0, answers: {}, baseAnswers: { source: false } })), null)
  assert.equal(api.parseBrowserDraft('{broken'), null)
})
