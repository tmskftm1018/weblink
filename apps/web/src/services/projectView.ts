export type ProjectSection = 'overview' | 'code' | 'tasks' | 'team' | 'storage'
export type ProjectView = { section: ProjectSection; tabs: string[]; selected: string; lines: Record<string, number>; updatedAt: string }
const key = (userId: string, projectId: string) => `weblink.project-view:${userId}:${projectId}`
const sections = new Set(['overview', 'code', 'tasks', 'team', 'storage'])

export function readProjectView(userId: string, projectId: string): ProjectView | null {
  try {
    const raw = window.localStorage.getItem(key(userId, projectId))
    if (!raw) return null
    const value = JSON.parse(raw) as ProjectView
    if (!value || !sections.has(value.section) || !Array.isArray(value.tabs) || value.tabs.length > 50 || !value.tabs.every(path => typeof path === 'string' && path.length <= 240) || typeof value.selected !== 'string' || value.selected.length > 240) return null
    if (!value.lines || typeof value.lines !== 'object' || Array.isArray(value.lines) || Object.keys(value.lines).length > 50 || !Object.entries(value.lines).every(([path, line]) => path.length <= 240 && Number.isInteger(line) && line > 0 && line <= 1_000_000)) return null
    if (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return null
    return value
  } catch { return null }
}

export function writeProjectView(userId: string, projectId: string, value: ProjectView): boolean {
  try { window.localStorage.setItem(key(userId, projectId), JSON.stringify(value)); return true } catch { return false }
}
