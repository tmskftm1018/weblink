import { useState } from 'react'
import { ProjectRevision, RunResult } from '../services/projects'
import { projectRunLabels, projectRunTime } from './useProjectRuns'

export default function ProjectRunHistory({ history, revisions, loading, waiting, error, current, hidden, onSelect, onReload, onStop, onResume, onReveal }: {
  history: RunResult[]; revisions: ProjectRevision[]; loading: boolean; waiting: boolean; error: string; current: RunResult | null; hidden: boolean
  onSelect: (run: RunResult) => void; onReload: () => void; onStop: () => void; onResume: () => void; onReveal: () => void
}) {
  const [selected, setSelected] = useState('')
  const entry = history.find(run => run.id === selected) ?? history[0]
  const running = current && (current.status === 'QUEUED' || current.status === 'RUNNING')
  return <section className="project-run-history" aria-label="내 실행 기록">
    <div className="project-run-history__controls"><label>내 실행 기록 · 최근 30개<select value={entry?.id ?? ''} disabled={loading || !entry} onChange={event => setSelected(event.target.value)}>{!history.length && <option value="">{loading ? '기록을 불러오는 중…' : '저장된 실행 없음'}</option>}{history.map(run => <option key={run.id} value={run.id}>{projectRunLabels[run.status]} · {projectRunTime(run.created_at)} · {revisions.find(revision => revision.id === run.revision_id)?.revision_number ? `코드 기록 #${revisions.find(revision => revision.id === run.revision_id)?.revision_number}` : run.revision_id.slice(0, 8)}</option>)}</select></label><button type="button" className="secondary-button" disabled={!entry || loading} onClick={() => entry && onSelect(entry)}>선택한 결과 열기 · 재실행 없음</button><button type="button" disabled={loading} onClick={onReload}>{loading ? '읽는 중…' : '기록 다시 읽기'}</button></div>
    {current && <div className="project-run-history__controls"><span role="status">선택한 실행: {projectRunLabels[current.status]}</span>{hidden && <button type="button" onClick={onReveal}>실행 결과 다시 펼치기</button>}{running && <button type="button" onClick={waiting ? onStop : onResume}>{waiting ? '결과 기다리기 중지' : '같은 실행 결과 확인 재개'}</button>}</div>}
    {error && <p role="status">{error}</p>}
  </section>
}
