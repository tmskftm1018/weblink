import { ProjectFile } from './projects'

export type ProjectSearchMode = 'files' | 'content'
export type ProjectSearchHit = { path: string; line: number; column: number; preview: string; start: number; length: number }
const regexSpecial = new Set([...'^$.*+?()[]{}|', String.fromCharCode(92)])
const escape = (value: string) => Array.from(value, char => regexSpecial.has(char) ? String.fromCharCode(92) + char : char).join('')

export function searchProject(files: ProjectFile[], query: string, mode: ProjectSearchMode, caseSensitive: boolean, pathFilter: string) {
  const hits: ProjectSearchHit[] = []
  if (!query && mode === 'content') return { hits, truncated: false }
  const pattern = query ? new RegExp(escape(query.slice(0, 200)), caseSensitive ? 'u' : 'iu') : null
  const filter = pathFilter.toLocaleLowerCase()
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    if (filter && !file.path.toLocaleLowerCase().includes(filter)) continue
    if (mode === 'files') {
      const match = pattern?.exec(file.path)
      if (pattern && !match) continue
      hits.push({ path: file.path, line: 1, column: 1, preview: file.path, start: match?.index ?? 0, length: match?.[0].length ?? 0 })
    } else {
      const lines = file.content.split(/\r\n|\r|\n/)
      for (let index = 0; index < lines.length; index += 1) {
        const match = pattern!.exec(lines[index])
        if (!match) continue
        const offset = Math.max(0, match.index - 60)
        const end = Math.min(lines[index].length, match.index + match[0].length + 100)
        const leading = offset > 0 ? '…' : ''
        hits.push({ path: file.path, line: index + 1, column: match.index + 1, preview: `${leading}${lines[index].slice(offset, end)}${end < lines[index].length ? '…' : ''}`, start: leading.length + match.index - offset, length: match[0].length })
        if (hits.length > 200) return { hits: hits.slice(0, 200), truncated: true }
      }
    }
    if (hits.length > 200) return { hits: hits.slice(0, 200), truncated: true }
  }
  return { hits, truncated: false }
}
