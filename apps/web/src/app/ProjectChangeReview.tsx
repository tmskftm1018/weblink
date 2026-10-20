import { lazy, Suspense, useMemo, useState } from 'react'
import { ProjectFile } from '../services/projects'
import { compareProjectRecovery, fileContents } from '../services/projectRecovery'

const DiffViewer = lazy(() => import('./MonacoCodeEditor').then(module => ({ default: module.MonacoDiffViewer })))

export default function ProjectChangeReview({ files, base, version, modelScope, dirty, paused, blocked, onPause, onResume, onOpen }: {
  files: ProjectFile[]; base: Record<string, string> | undefined; version: number; modelScope: string; dirty: boolean; paused: boolean; blocked: boolean
  onPause: () => void; onResume: () => void; onOpen: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState('')
  const [sideBySide, setSideBySide] = useState(false)
  const changes = useMemo(() => !dirty || !base ? [] : compareProjectRecovery({ version, answers: fileContents(files), baseAnswers: base }, Object.entries(base).map(([path, content]) => ({ path, content }))).filter(row => row.local !== row.server), [files, base, version, dirty])
  const current = changes.find(row => row.path === selected) ?? changes[0]
  return <section className="project-change-review" aria-label="저장 전 변경 검토">
    <div className="project-change-review__heading"><span>저장 전 변경 · {changes.length}개 파일</span>{!paused ? <button type="button" className="secondary-button" disabled={blocked} onClick={onPause}>자동 저장 잠시 멈추기</button> : !dirty && <button type="button" className="secondary-button" disabled={blocked} onClick={onResume}>자동 저장 다시 켜기</button>}</div>
    <details open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>수정 전·후 코드 비교{paused ? ' · 검토 후 상단에서 초안 저장' : ''}</summary>
      {!dirty ? <p>서버에 저장하지 않은 변경이 없습니다. 저장 전 비교하려면 자동 저장을 잠시 멈추고 편집하세요.</p> : !base ? <p>비교 기준을 준비하고 있습니다. 현재 작성 내용은 그대로 유지됩니다.</p> : !current ? <p>마지막으로 불러온 서버 파일과 코드 내용이 같습니다.</p> : <>
        <label>비교할 파일<select value={current.path} onChange={event => setSelected(event.target.value)}>{changes.map(row => <option key={row.path} value={row.path}>{row.path} · {row.server === null ? '추가' : row.local === null ? '삭제' : '수정'}</option>)}</select></label>
        <p>기준 초안 v{version}과 현재 화면을 비교합니다. 팀원의 최신 변경 확인은 상단의 충돌 비교 기능을 이용하세요. 삭제·추가된 빈 파일은 코드 차이가 없어도 목록에 표시됩니다.</p>
        <div className="project-change-review__heading"><label className="project-change-review__toggle"><input type="checkbox" checked={sideBySide} onChange={event => setSideBySide(event.target.checked)} />나란히 보기 · 넓은 화면용</label>{current.local !== null && <button type="button" onClick={() => onOpen(current.path)}>이 파일 편집하기</button>}</div>
        {expanded && <div className="project-change-review__diff"><Suspense fallback={<p>코드 비교기를 불러오는 중…</p>}><DiffViewer original={current.server ?? ''} modified={current.local ?? ''} path={current.path} modelScope={`${modelScope}/${version}`} sideBySide={sideBySide} /></Suspense></div>}
        <small>읽기 전용 비교입니다. 이 화면에서 코드를 저장·복구하거나 컴퓨터 폴더를 변경하지 않습니다.</small>
      </>}
    </details>
  </section>
}
