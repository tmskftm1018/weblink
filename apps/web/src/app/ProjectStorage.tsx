import { ReactNode } from 'react'
import { ProjectGitHubSource } from '../services/projects'

export default function ProjectStorage({ directory, pendingDirectory, github, busy, readOnly, dirty, needsReload, accessLost, localApp, versions, onChoose, onImport, onExport, onRefresh, onSync, onDisconnect, onCancel, onCheckGitHub, onPullGitHub, onConnections, onArchive, onBackup, onImportBackup }: {
  directory: string | null; pendingDirectory: string | null; github: ProjectGitHubSource | null
  busy: boolean; readOnly: boolean; dirty: boolean; needsReload: boolean; accessLost: boolean; versions: ReactNode
  localApp: boolean
  onChoose: () => void; onImport: () => void; onExport: () => void; onRefresh: () => void; onSync: () => void
  onDisconnect: () => void; onCancel: () => void; onCheckGitHub: () => void; onPullGitHub: () => void
  onConnections: () => void; onArchive: () => void; onBackup: () => void; onImportBackup: (file: File) => void
}) {
  return <div className="project-storage-layout">
    <header className="storage-intro"><p className="eyebrow">프로젝트 보관</p><h2>저장 위치와 내보내기</h2><p>초안과 팀 작업은 이 WebLink에 저장됩니다. 컴퓨터 폴더와 ZIP으로 코드 사본을 보관할 수 있어요.</p><span className="storage-state">기본 저장 · WebLink{directory ? ` / 폴더 사본 · ${directory}` : ''}</span></header>
    <section className="storage-section" aria-labelledby="storage-folder-title">
      <div className="storage-section-heading"><div><h3 id="storage-folder-title">내 컴퓨터 폴더</h3><p>{directory ? `연결한 폴더: ${directory}. 초안 저장 시 이 폴더에도 파일을 기록합니다.` : '프로젝트 전용 폴더를 선택해 파일을 가져오거나 사본을 저장하세요.'}</p></div>{!directory && <button className="secondary-button" type="button" onClick={onChoose} disabled={busy}>폴더 연결</button>}</div>
      {directory && <div className="storage-action-row"><button className="secondary-button" type="button" onClick={onRefresh} disabled={busy || dirty || readOnly}>폴더 → WebLink 가져오기</button><button className="secondary-button" type="button" onClick={onSync} disabled={busy || dirty}>WebLink → 폴더에 저장</button><button className="plain-danger-button" type="button" onClick={onDisconnect} disabled={busy}>폴더 연결 해제</button></div>}
      {pendingDirectory && <div className="folder-connection-choice"><strong>선택한 폴더: {pendingDirectory}</strong><p>가져오기는 현재 초안을 교체하고, 폴더에 저장하기는 같은 경로의 파일을 덮어씁니다. 사용할 방향을 선택하세요.</p><div><button className="secondary-button" type="button" onClick={onImport} disabled={busy || readOnly}>폴더에서 WebLink로 가져오기</button><button className="primary-button" type="button" onClick={onExport} disabled={busy}>WebLink 파일을 폴더에 복사</button><button className="plain-link-button" type="button" onClick={onCancel} disabled={busy}>취소</button></div></div>}
      <details className="storage-help"><summary>GitHub Desktop 폴더와 함께 사용하기</summary><p>복제한 저장소 폴더를 연결한 뒤 GitHub Desktop에서 커밋·푸시하세요. 폴더 연결은 이 브라우저와 컴퓨터에서만 기억하며 GitHub 자동 업로드는 하지 않습니다.</p></details>
    </section>
    {github?.connected && <section className="storage-section" aria-labelledby="storage-github-title">
      <div className="storage-section-heading"><div><h3 id="storage-github-title">가져온 GitHub 원본</h3><p><a href={github.repository_url ?? '#'} target="_blank" rel="noreferrer">{github.repository_url?.replace('https://github.com/', '')}</a> · {github.branch} · {github.is_private ? '비공개' : '공개'}</p><small>가져온 커밋 {github.imported_sha?.slice(0, 7)}</small></div><button className="secondary-button" type="button" onClick={onCheckGitHub} disabled={busy}>GitHub 변경 확인</button></div>
      <p role="status">{github.status_message ?? (github.latest_sha === null ? '연결 앱에서 GitHub 권한을 확인하세요.' : github.update_available ? '가져올 새 변경이 있어요.' : '가져온 원본이 최신 상태예요.')}</p>
      {github.update_available && <button className="primary-button" type="button" onClick={onPullGitHub} disabled={busy || dirty || needsReload || readOnly}>{readOnly ? '보기 전용' : dirty ? '먼저 초안 저장' : needsReload ? '최신 초안 먼저 확인' : 'GitHub 변경 가져오기'}</button>}
      <p className="storage-footnote">가져오기 전 초안을 버전으로 보관합니다. 연결한 컴퓨터 폴더에는 자동 반영하지 않습니다.</p>
    </section>}
    <section className="storage-section" aria-labelledby="storage-export-title">
      <div className="storage-section-heading"><div><h3 id="storage-export-title">파일 사본 내려받기</h3><p>다른 컴퓨터나 새 프로젝트로 옮길 때 ZIP 파일을 사용하세요.</p></div><button className="secondary-button" type="button" onClick={onArchive} disabled={busy || accessLost}>프로젝트 ZIP 다운로드</button></div>
      <p className="storage-footnote">ZIP에는 코드 파일이 담깁니다. 계정·학습 진도·팀원과 저장 버전 기록은 포함하지 않습니다.</p>
      {localApp && <details className="storage-help" open><summary>화면·API·DB 앱을 내 컴퓨터에서 실행하기</summary><ol><li>위의 프로젝트 ZIP을 내려받아 새 폴더에 압축을 푸세요.</li><li>Docker Desktop을 켜고 <code>compose.yaml</code>이 있는 폴더에서 터미널을 여세요.</li><li><code>docker compose up --build -d</code>를 실행하세요. 화면과 API 주소는 ZIP의 <code>README.md</code>에서 확인합니다.</li><li>작업을 마치면 같은 폴더에서 <code>docker compose down</code>으로 종료하세요. 저장 데이터를 유지하려면 <code>down -v</code>는 사용하지 마세요.</li></ol><p>WebLink의 Python 실행기는 이 앱 전체를 실행하지 않습니다. 코드 수정 뒤에는 ZIP이나 연결 폴더를 갱신하고 다시 빌드하세요.</p></details>}
      <details className="storage-help"><summary>저장 실패 시 수정본 보관·복구하기</summary><p>수정본 JSON에는 코드와 비교 기준이 담깁니다. 같은 WebLink의 같은 프로젝트에서 가져오면 서버 내용과 비교해 복구합니다. 저장이 실패한 상태에서도 내려받을 수 있어요.</p><div className="storage-action-row"><button className="secondary-button" type="button" onClick={onBackup}>현재 수정본 JSON 내려받기</button><label className="storage-import-label">수정본 JSON 가져오기<input type="file" accept=".json,application/json" disabled={busy || readOnly} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onImportBackup(file) }} /></label></div></details>
    </section>
    {versions}
    <footer className="storage-connection-link"><p>Google Drive 파일 선택과 GitHub 토큰은 계정의 연결 앱에서 관리합니다.</p><button className="plain-link-button" type="button" onClick={onConnections} disabled={busy}>연결 앱에서 계정 관리 →</button></footer>
  </div>
}
