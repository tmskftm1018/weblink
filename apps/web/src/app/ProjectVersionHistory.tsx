import { ProjectMember, ProjectVersion, ProjectVersionDetails } from '../services/projects'

export default function ProjectVersionHistory({ versions, members, userId, busy, readOnly, preview, onSave, onView, onRestore, onDelete, onClose }: {
  versions: ProjectVersion[]; members: ProjectMember[]; userId: string; busy: boolean; readOnly: boolean
  preview: ProjectVersionDetails | null; onSave: () => void; onView: (id: string) => void
  onRestore: (id: string) => void; onDelete: (version: ProjectVersion) => void; onClose: () => void
}) {
  return <section className="storage-section" aria-labelledby="storage-versions-title">
    <div className="storage-section-heading"><div><h3 id="storage-versions-title">저장한 버전</h3><p>중요한 시점을 별도 버전으로 보관하고, 필요하면 초안으로 복원하세요.</p></div><button type="button" className="secondary-button" onClick={onSave} disabled={busy || readOnly}>현재 초안을 버전으로 저장</button></div>
    {versions.length ? <ul className="storage-version-list">{versions.map(version => {
      const creator = members.find(member => member.user_id === version.created_by)
      const creatorName = version.created_by === userId ? '나' : creator?.display_name || creator?.email || '이전 팀원'
      return <li className="saved-version-row" key={version.id}>
        <div><strong>v{version.version_number} · {version.name}</strong><small>{creatorName} 저장 · {new Date(version.created_at).toLocaleDateString('ko-KR')}</small></div>
        <div><button type="button" aria-label={`v${version.version_number} ${version.name} 내용 보기`} onClick={() => onView(version.id)} disabled={busy}>내용 보기</button><button type="button" aria-label={`v${version.version_number} ${version.name} 복원`} onClick={() => onRestore(version.id)} disabled={busy || readOnly}>복원</button><button className="delete-version-button" type="button" aria-label={`v${version.version_number} ${version.name} 삭제`} onClick={() => onDelete(version)} disabled={busy || readOnly}>삭제</button></div>
      </li>
    })}</ul> : <p className="storage-empty">아직 따로 보관한 버전이 없어요. 평소 작업은 초안에 계속 저장됩니다.</p>}
    {preview && <section className="version-preview" aria-label="저장 버전 미리보기"><div><strong>v{preview.version_number} · {preview.name}</strong><button className="back-link" type="button" onClick={onClose}>미리보기 닫기</button></div><p>{preview.description || '저장한 파일의 읽기 전용 미리보기입니다.'}</p>{preview.files.map(file => <details key={file.path}><summary>{file.path}</summary><pre>{file.content}</pre></details>)}</section>}
  </section>
}
