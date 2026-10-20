import { useEffect, useRef, useState } from 'react'
import { RunResult, projectService } from '../services/projects'

export const projectRunLabels: Record<RunResult['status'], string> = { QUEUED: '대기 중', RUNNING: '실행 중', SUCCEEDED: '완료', FAILED: '실패' }
export const projectRunTime = (value: string) => new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`).toLocaleString('ko-KR')
const pending = (run: RunResult) => run.status === 'QUEUED' || run.status === 'RUNNING'
const ordered = (runs: RunResult[]) => runs.sort((left, right) => right.created_at.localeCompare(left.created_at)).slice(0, 30)

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('중지', 'AbortError')); return }
    const abort = () => { window.clearTimeout(timer); reject(new DOMException('중지', 'AbortError')) }
    const timer = window.setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 1500)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export default function useProjectRuns(projectId: string | undefined, userId: string | undefined, run: RunResult | null, onReport: (run: RunResult | null) => void) {
  const [history, setHistory] = useState<RunResult[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [retry, setRetry] = useState(0)
  const controller = useRef<AbortController | null>(null)
  const report = useRef(onReport); report.current = onReport
  const scope = `${userId ?? ''}:${projectId ?? ''}`
  const currentScope = useRef(scope); currentScope.current = scope

  useEffect(() => {
    setHistory([]); setError(''); setWaiting(false); setLoading(false)
    if (!projectId || run?.project_id !== projectId) report.current(null)
  }, [scope])

  useEffect(() => {
    if (!projectId || !userId) return
    const active = new AbortController()
    const timeout = window.setTimeout(() => active.abort('timeout'), 15000)
    setLoading(true); setError('')
    void projectService.listRuns(projectId, active.signal).then(items => {
      if (!active.signal.aborted && currentScope.current === scope) setHistory(previous => {
        const merged = new Map(items.map(item => [item.id, item]))
        for (const item of previous.filter(item => item.project_id === projectId)) if (!merged.has(item.id) || !pending(item)) merged.set(item.id, item)
        return ordered([...merged.values()])
      })
    }).catch(cause => {
      if (currentScope.current === scope && (!active.signal.aborted || active.signal.reason === 'timeout')) setError(active.signal.reason === 'timeout' ? '실행 기록을 불러오는 데 시간이 걸려요. 다시 읽기를 눌러 주세요.' : cause instanceof Error ? cause.message : '실행 기록을 읽지 못했어요.')
    }).finally(() => {
      window.clearTimeout(timeout)
      if (currentScope.current === scope && (!active.signal.aborted || active.signal.reason === 'timeout')) setLoading(false)
    })
    return () => { window.clearTimeout(timeout); active.abort() }
  }, [scope, refresh])

  useEffect(() => {
    if (run && run.project_id === projectId) setHistory(items => ordered([run, ...items.filter(item => item.id !== run.id)]))
  }, [scope, run])

  useEffect(() => {
    if (!projectId || !run || run.project_id !== projectId || !pending(run)) return
    const active = new AbortController(); controller.current = active
    const timeout = window.setTimeout(() => active.abort('timeout'), 90000)
    setWaiting(true); setError('')
    void (async () => {
      try {
        let result = run
        while (pending(result)) {
          result = await projectService.getRun(projectId, run.id, active.signal)
          if (active.signal.aborted || currentScope.current !== scope) return
          report.current(result)
          if (pending(result)) await pause(active.signal)
        }
      } catch (cause) {
        if (currentScope.current === scope && (!active.signal.aborted || active.signal.reason === 'timeout')) setError(active.signal.reason === 'timeout' ? '기다리기 한도를 넘었어요. 서버 실행은 계속될 수 있어요. 같은 기록의 결과 확인을 다시 시작할 수 있습니다.' : cause instanceof Error ? cause.message : '결과를 읽지 못했어요.')
      } finally {
        window.clearTimeout(timeout)
        if (controller.current === active) { controller.current = null; setWaiting(false) }
      }
    })()
    return () => { window.clearTimeout(timeout); active.abort() }
    // Status updates belong to this same poll; only a new run or explicit retry starts another one.
  }, [scope, run?.id, retry])

  return { history, error, loading, waiting, reload: () => setRefresh(value => value + 1), resume: () => setRetry(value => value + 1), stop: () => {
    controller.current?.abort(); setWaiting(false); setError('결과 기다리기를 멈췄어요. 서버 작업은 취소되지 않으며 실행 기록에서 다시 확인할 수 있어요.')
  } }
}
