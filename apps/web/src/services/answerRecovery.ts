import type { BrowserDraft } from './browserDrafts'

export const sameAnswers = (left: Record<string, string>, right: Record<string, string>) => {
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && left[key] === right[key])
}

export type RecoveryChange = { path: string; base: string | null; local: string | null; server: string | null; conflict: boolean; selected: 'local' | 'server' }
export function compareAnswerRecovery(draft: Pick<BrowserDraft, 'answers' | 'baseAnswers'>, current: Record<string, string>): RecoveryChange[] {
  const base = new Map(Object.entries(draft.baseAnswers ?? {}))
  const local = new Map(Object.entries(draft.answers))
  const server = new Map(Object.entries(current))
  return [...new Set([...base.keys(), ...local.keys(), ...server.keys()])].sort().map(path => {
    const original = base.get(path) ?? null
    const mine = local.get(path) ?? null
    const theirs = server.get(path) ?? null
    const changedLocal = original !== mine
    const changedServer = original !== theirs
    return { path, base: original, local: mine, server: theirs,
      conflict: mine !== theirs && (!draft.baseAnswers || (changedLocal && changedServer)),
      selected: changedLocal ? 'local' : 'server' }
  })
}

export function resolveAnswerRecovery(rows: RecoveryChange[], choices: Record<string, 'local' | 'server'>): Record<string, string> {
  return Object.fromEntries(rows.flatMap(row => {
    const choice = Object.prototype.hasOwnProperty.call(choices, row.path) ? choices[row.path] : undefined
    if (row.conflict && choice !== 'local' && choice !== 'server') throw new Error('양쪽에서 바뀐 항목의 내용을 선택해 주세요.')
    const value = (choice ?? row.selected) === 'local' ? row.local : row.server
    return value === null ? [] : [[row.path, value]]
  }))
}
