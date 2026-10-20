import { BrowserDraft } from './browserDrafts'
import { ProjectFile } from './projects'

export const projectRecoveryKey = (userId: string, projectId: string) => `weblink.project-draft:${userId}:${projectId}`
export const fileContents = (files: ProjectFile[]) => Object.fromEntries(files.map(file => [file.path, file.content]))
export const sameFiles = (left: Record<string, string>, right: Record<string, string>) => {
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && left[key] === right[key])
}

export type RecoveryChange = { path: string; base: string | null; local: string | null; server: string | null; conflict: boolean; selected: 'local' | 'server' }
export function compareProjectRecovery(draft: BrowserDraft, files: ProjectFile[]): RecoveryChange[] {
  const base = new Map(Object.entries(draft.baseAnswers ?? {}))
  const local = new Map(Object.entries(draft.answers))
  const server = new Map(files.map(file => [file.path, file.content]))
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

export function validateRecoveryFiles(files: ProjectFile[]): string | null {
  if (files.length > 50) return '반영할 파일이 50개를 넘어요. 복구본을 내려받아 필요한 파일을 정리해 주세요.'
  if (files.some(file => !file.path || file.path.length > 240 || file.path.startsWith('/') || /[\\\0]/.test(file.path) || file.path.split('/').some(part => !part || part === '.' || part === '..'))) return '안전하지 않은 경로가 있어 편집기로 가져올 수 없어요. 복구본을 내려받아 경로를 정리해 주세요.'
  if (files.some(file => file.content.length > 200_000)) return '파일 하나가 200,000자를 넘어요. 복구본을 내려받아 내용을 줄여 주세요.'
  if (files.reduce((size, file) => size + new TextEncoder().encode(file.content).byteLength, 0) > 1_000_000) return '파일 합계가 1MB를 넘어요. 복구본을 내려받아 내용을 줄여 주세요.'
  return null
}
