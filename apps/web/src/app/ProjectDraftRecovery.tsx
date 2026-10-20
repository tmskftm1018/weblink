import { useEffect, useMemo, useRef, useState } from 'react'
import { BrowserDraft } from '../services/browserDrafts'
import { compareProjectRecovery, validateRecoveryFiles } from '../services/projectRecovery'
import { ProjectFile, ProjectWorkspace } from '../services/projects'

export default function ProjectDraftRecovery({ draft, server, readOnly, storageNotice, canDefer, onApply, onDiscard, onDownload, onLeave }: {
  draft: BrowserDraft; server: ProjectWorkspace; readOnly: boolean
  storageNotice: string; canDefer: boolean
  onApply: (files: ProjectFile[]) => void; onDiscard: () => void; onDownload: () => void; onLeave: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const rows = useMemo(() => compareProjectRecovery(draft, server.files), [draft, server.files])
  const [choices, setChoices] = useState<Record<string, 'local' | 'server'>>({})
  const choiceFor = (path: string) => Object.prototype.hasOwnProperty.call(choices, path) ? choices[path] : undefined
  const [error, setError] = useState('')
  const conflicts = rows.filter(row => row.conflict)
  const changed = rows.filter(row => row.local !== row.server)
  const ready = conflicts.every(row => choiceFor(row.path))
  useEffect(() => { dialog.current?.showModal(); return () => dialog.current?.close() }, [])
  return <dialog ref={dialog} className="project-recovery-dialog" aria-labelledby="project-recovery-title" onCancel={event => event.preventDefault()}>
    <h2 id="project-recovery-title">저장 전 프로젝트 수정본 확인</h2>
    <p><strong>{server.name}</strong> · 복구본 기준 v{draft.version} / 서버 v{server.draft_version}</p>
    <p>서로 다른 파일 {changed.length}개 · 양쪽에서 수정한 파일 {conflicts.length}개. 다른 파일의 변경은 합치고, 같은 파일의 충돌은 직접 선택합니다. 삭제한 파일도 비교합니다.</p>
    {draft.updatedAt && <small>임시 보관: {new Date(draft.updatedAt).toLocaleString('ko-KR')}</small>}
    <p>편집기로 가져온 뒤 내용을 확인하고 초안을 저장하세요. 자동 저장은 잠시 멈춥니다. 연결된 컴퓨터 폴더는 여기서 변경하지 않습니다.</p>
    {readOnly && <p role="status">현재는 편집 권한이 없어 반영할 수 없어요. 보관한 수정본은 내려받을 수 있습니다.</p>}
    {storageNotice && <p role="status">{storageNotice}</p>}
    {changed.map(row => <details key={row.path} className="project-recovery-file">
      <summary><code>{row.path}</code> · {row.conflict ? '선택 필요' : row.local === null ? '내 수정본에서 삭제' : row.server === null ? '파일 추가·삭제 비교' : '변경 비교'}</summary>
      <div className="project-recovery-columns"><div><strong>내 수정본</strong><pre>{row.local === null ? '(삭제됨 / 파일 없음)' : row.local || '(빈 파일)'}</pre></div><div><strong>서버 저장본</strong><pre>{row.server === null ? '(삭제됨 / 파일 없음)' : row.server || '(빈 파일)'}</pre></div></div>
      <details><summary>수정 전 기준 내용</summary><pre>{row.base === null ? '(파일 없음 / 기준 없음)' : row.base || '(빈 파일)'}</pre></details>
      <label>반영할 내용<select disabled={readOnly} value={choiceFor(row.path) ?? (row.conflict ? '' : row.selected)} onChange={event => setChoices(current => ({ ...current, [row.path]: event.target.value as 'local' | 'server' }))}><option value="" disabled>선택해 주세요</option><option value="local">내 수정본 사용{row.local === null ? ' · 파일 삭제' : ''}</option><option value="server">서버 저장본 사용{row.server === null ? ' · 파일 삭제' : ''}</option></select></label>
    </details>)}
    {error && <p role="alert">{error}</p>}
    <div className="project-recovery-actions"><button type="button" className="primary-button" disabled={readOnly || !ready} onClick={() => {
      const files = rows.flatMap(row => { const value = (choiceFor(row.path) ?? row.selected) === 'local' ? row.local : row.server; return value === null ? [] : [{ path: row.path, content: value }] })
      const issue = validateRecoveryFiles(files)
      if (issue) { setError(issue); return }
      onApply(files)
    }}>선택한 내용 편집기로 가져오기</button><button type="button" className="secondary-button" onClick={onDownload}>내 수정본 내려받기</button><button type="button" className="secondary-button" onClick={onDiscard}>내 수정본 버리고 서버 파일 사용</button></div>
    <button type="button" className="secondary-button" disabled={!canDefer} onClick={onLeave}>목록으로 돌아가기 · 복구본 유지</button>
    <p><small>브라우저 보관이 가능할 때 복구본을 이 기기에 남깁니다. 서버 저장·백업과는 별개이며 브라우저 데이터 삭제 시 사라집니다.</small></p>
  </dialog>
}
