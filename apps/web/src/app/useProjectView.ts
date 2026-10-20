import { useCallback, useEffect, useRef, useState } from 'react'
import { ProjectSection, ProjectView, readProjectView, writeProjectView } from '../services/projectView'

export default function useProjectView(userId: string | undefined, projectId: string | undefined, active: boolean, busy: boolean, section: ProjectSection, tabs: string[], selected: string, paths: string[]) {
  const [recent, setRecent] = useState<ProjectView | null>(null)
  const identity = `${userId ?? ''}:${projectId ?? ''}`
  const initialized = useRef('')
  const lines = useRef<Record<string, number>>({})
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef({ userId, projectId, active, busy, section, tabs, selected, paths, identity })
  latest.current = { userId, projectId, active, busy, section, tabs, selected, paths, identity }

  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    const now = latest.current
    if (!now.userId || !now.projectId || !now.active || now.busy || now.section === 'overview' || initialized.current !== now.identity) return
    const available = new Set(now.paths)
    const value: ProjectView = { section: now.section, tabs: now.tabs.filter(path => available.has(path)).slice(0, 50), selected: available.has(now.selected) ? now.selected : '', lines: Object.fromEntries(Object.entries(lines.current).filter(([path]) => available.has(path))), updatedAt: new Date().toISOString() }
    if (writeProjectView(now.userId, now.projectId, value)) setRecent(value)
  }, [])

  useEffect(() => {
    window.clearTimeout(timer.current)
    const saved = userId && projectId ? readProjectView(userId, projectId) : null
    setRecent(saved); lines.current = saved?.lines ?? {}; initialized.current = identity
  }, [identity])
  useEffect(() => {
    timer.current = window.setTimeout(flush, 300)
    return () => window.clearTimeout(timer.current)
  }, [identity, active, busy, section, tabs, selected, flush])
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', hidden)
    return () => { window.clearTimeout(timer.current); window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', hidden) }
  }, [flush])
  const onCursor = useCallback((line: number) => {
    const now = latest.current
    if (!now.selected || initialized.current !== now.identity) return
    lines.current = { ...lines.current, [now.selected]: line }
    window.clearTimeout(timer.current); timer.current = window.setTimeout(flush, 300)
  }, [flush])
  return { recent: initialized.current === identity ? recent : null, onCursor, flush }
}
