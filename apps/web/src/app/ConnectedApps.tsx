import { FormEvent, useEffect, useState } from 'react'
import { GitHubConnectionStatus, GoogleConnectionStatus, GoogleSheetValues } from '../services/connections'

type Props = {
  google: GoogleConnectionStatus | null; github: GitHubConnectionStatus | null; busy: boolean; projectBusy: boolean; error: string
  token: string; onToken: (value: string) => void; onGitHubConnect: () => void; onGitHubDisconnect: () => void
  onGoogleConnect: () => void; onGoogleDisconnect: () => void; onRetry: () => void
  sheetId: string; sheetRange: string; onSheetId: (value: string) => void; onSheetRange: (value: string) => void
  onPreview: (event: FormEvent<HTMLFormElement>) => void; preview: GoogleSheetValues | null
  validation: { issues: string[]; validRows: number } | null; onCreateProject: () => void
  returnProject: string | null; onReturn: () => void; oauthResult: string | null
}

export default function ConnectedApps(props: Props) {
  const { google, github, busy, projectBusy, error } = props
  const [panel, setPanel] = useState<'accounts' | 'sheets'>('accounts')
  const [settings, setSettings] = useState<'google' | 'github' | null>(null)
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }) }, [panel])
  const status = (value: { connected: boolean } | null) => value ? value.connected ? '연결됨' : '연결 안 됨' : busy ? '확인 중' : '확인 실패'
  const googleSettings = () => { setPanel('accounts'); setSettings('google') }
  return <main className="connections-main">
    <header className="connections-heading"><p className="eyebrow">외부 서비스</p><h1>연결 앱</h1><p>계정 연결을 관리하고, 필요한 시트 데이터를 프로젝트로 가져오세요.</p>{props.returnProject && <button className="back-link" type="button" onClick={props.onReturn} disabled={projectBusy || busy}>← {props.returnProject} 프로젝트로 돌아가기</button>}</header>
    {props.oauthResult === 'google_connected' && <p className="project-notice connection-message" role="status">Google 계정을 연결했어요. ‘시트 데이터’에서 범위를 읽어 볼 수 있습니다.</p>}
    {props.oauthResult?.startsWith('google_') && props.oauthResult !== 'google_connected' && <p className="form-error connection-message" role="alert">Google 연결이 완료되지 않았어요. 계정 설정과 권한을 확인해 주세요.</p>}
    {error && <p className="form-error connection-message" role="alert">{error}</p>}
    <nav className="connection-section-nav" aria-label="연결 앱 작업"><button type="button" aria-current={panel === 'accounts' ? 'page' : undefined} onClick={() => setPanel('accounts')}>계정 연결</button><button type="button" aria-current={panel === 'sheets' ? 'page' : undefined} onClick={() => setPanel('sheets')}>시트 데이터</button></nav>
    {panel === 'accounts' ? <div className="connection-account-list">
      <section className="connection-card" aria-labelledby="connection-google-title">
        <div className="connection-title"><span className="google-mark" aria-hidden="true">G</span><div><h2 id="connection-google-title">Google</h2><p>Sheets 데이터 · Drive에서 선택한 파일</p></div><span className={`connection-badge ${google?.connected ? 'connected' : ''}`}>{status(google)}</span></div>
        <p className="connection-description">{google?.connected ? `연결 계정: ${google.account_email ?? 'Google 계정'}` : '스프레드시트를 읽거나, Drive에서 선택한 파일을 프로젝트에 추가할 수 있어요.'}</p>
        <div className="connection-primary-actions">{google?.connected && <button className="primary-button" type="button" onClick={() => setPanel('sheets')}>시트 데이터 열기</button>}{!google ? <button className="secondary-button" type="button" onClick={props.onRetry} disabled={busy}>연결 상태 다시 확인</button> : <button className="secondary-button" type="button" aria-expanded={settings === 'google'} aria-controls="google-connection-settings" disabled={busy} onClick={() => setSettings(settings === 'google' ? null : 'google')}>{google.connected ? '연결 관리' : google.configured ? 'Google 연결하기' : '설정 안내'}</button>}</div>
        {settings === 'google' && google && <div className="connection-settings" id="google-connection-settings">
          {google.connected ? <>
            <p>이 계정이 접근할 수 있는 시트만 사용합니다. Drive에서는 파일 선택창에서 직접 선택한 파일만 가져와요.</p>
            {!google.scopes.includes('https://www.googleapis.com/auth/spreadsheets') && <div className="connection-scope-notice"><p>시트에 쓰려면 추가 권한이 필요해요.</p><button className="secondary-button" type="button" onClick={props.onGoogleConnect} disabled={busy}>Sheets 쓰기 권한 추가</button></div>}
            {!google.scopes.includes('https://www.googleapis.com/auth/drive.file') ? <div className="connection-scope-notice"><p>Drive 파일을 가져오려면 파일 선택 권한을 추가하세요.</p><button className="secondary-button" type="button" onClick={props.onGoogleConnect} disabled={busy}>Drive 파일 선택 권한 추가</button></div> : !google.drive_picker_configured && <details className="storage-help"><summary>Drive 파일 선택창 설정 안내</summary><p>서버에 GOOGLE_PICKER_API_KEY와 GOOGLE_CLOUD_PROJECT_NUMBER를 설정해 주세요.</p></details>}
            <details className="storage-help"><summary>Google 연결 해제</summary><p>WebLink에 저장된 Google 연결 정보를 지웁니다. 기존 프로젝트 파일은 보존됩니다.</p><button className="disconnect-button" type="button" onClick={props.onGoogleDisconnect} disabled={busy}>Google 연결 해제</button></details>
          </> : google.configured ? <><p>Google에서 사용할 계정과 권한을 선택한 뒤 WebLink로 돌아옵니다.</p><button className="primary-button" type="button" onClick={props.onGoogleConnect} disabled={busy}>Google 계정 연결하기</button></> : <div className="connection-setup"><strong>서버 관리자의 설정이 필요해요.</strong><details><summary>설정할 항목 확인</summary><p>.env에 Google OAuth 웹 클라이언트 정보와 연결 암호화 키를 설정하고 API를 다시 시작하세요.</p><code>GOOGLE_OAUTH_CLIENT_ID</code><code>GOOGLE_OAUTH_CLIENT_SECRET</code><code>CONNECTION_ENCRYPTION_KEY</code><p>리디렉션 주소: http://localhost:8000/api/v1/connections/google/oauth/callback</p></details></div>}
        </div>}
      </section>
      <section className="connection-card" aria-labelledby="connection-github-title">
        <div className="connection-title"><span className="github-mark" aria-hidden="true">GH</span><div><h2 id="connection-github-title">GitHub</h2><p>공개·비공개 저장소 파일 가져오기</p></div><span className={`connection-badge ${github?.connected ? 'connected' : ''}`}>{status(github)}</span></div>
        <p className="connection-description">{github?.connected ? `연결 계정: ${github.account_name ?? 'GitHub 계정'}` : '공개 저장소는 토큰 없이 가져올 수 있고, 비공개 저장소에는 계정 연결이 필요해요.'}</p>
        {!github ? <button className="secondary-button" type="button" onClick={props.onRetry} disabled={busy}>연결 상태 다시 확인</button> : <button className="secondary-button" type="button" aria-expanded={settings === 'github'} aria-controls="github-connection-settings" onClick={() => setSettings(settings === 'github' ? null : 'github')} disabled={busy}>{github.connected ? '연결 관리' : github.configured ? '비공개 저장소 연결하기' : '설정 안내'}</button>}
        {settings === 'github' && github && <div className="connection-settings" id="github-connection-settings">
          {github.connected ? <><p>토큰은 암호화해 보관하고 저장소 파일을 읽는 데 사용합니다. GitHub로 자동 업로드하지 않습니다.</p><details className="storage-help"><summary>GitHub 연결 해제</summary><p>WebLink에 저장된 토큰만 지웁니다. 토큰 자체 폐기는 GitHub 설정에서 진행하세요.</p><button className="disconnect-button" type="button" onClick={props.onGitHubDisconnect} disabled={busy}>GitHub 연결 해제</button></details></> : github.configured ? <form onSubmit={event => { event.preventDefault(); props.onGitHubConnect() }}>
            <ol className="github-token-steps"><li>GitHub에서 Fine-grained token을 만들고 사용할 저장소만 선택하세요.</li><li>Contents 권한은 Read-only, Metadata는 기본 읽기 권한으로 둡니다.</li></ol>
            <label className="github-token-field">GitHub 토큰<input type="password" autoComplete="new-password" spellCheck={false} value={props.token} onChange={event => props.onToken(event.target.value)} maxLength={500} placeholder="github_pat_…" /></label><button className="primary-button" type="submit" disabled={busy || props.token.trim().length < 20}>{busy ? '토큰 확인 중…' : 'GitHub 연결'}</button><p className="connection-footnote">토큰은 다른 사람과 공유하지 마세요. 연결 후에는 화면에 다시 표시하지 않습니다.</p>
          </form> : <div className="connection-setup"><strong>서버 관리자의 암호화 설정이 필요해요.</strong><details><summary>설정할 항목 확인</summary><p>.env의 CONNECTION_ENCRYPTION_KEY를 설정한 뒤 API를 다시 시작하세요. Google 연결에서 이미 사용한다면 같은 키를 사용합니다.</p></details></div>}
        </div>}
      </section>
      <p className="connection-footnote">프로젝트의 파일 사본·폴더·저장 버전은 프로젝트 안의 ‘저장 위치’에서 관리합니다.</p>
    </div> : <section className="connection-card" aria-labelledby="connection-sheet-title">
      <h2 id="connection-sheet-title">Google Sheets 데이터</h2>
      {!google?.connected ? <div className="connection-empty"><p>{google ? '먼저 Google 계정을 연결해 주세요.' : 'Google 연결 상태를 확인하지 못했어요.'}</p><button className="secondary-button" type="button" onClick={google ? googleSettings : props.onRetry} disabled={busy}>{google ? 'Google 연결 설정 보기' : '연결 상태 다시 확인'}</button></div> : <>
        <p className="connection-description">{google.account_email ?? '연결한 Google 계정'}에서 읽을 수 있는 시트의 범위를 확인합니다.</p>
        <form className="sheet-preview-form" onSubmit={props.onPreview}>
          <label>스프레드시트 ID 또는 주소<input value={props.sheetId} onChange={event => props.onSheetId(event.target.value)} required maxLength={500} placeholder="Google Sheets 주소를 붙여넣으세요" /></label>
          <label>시트 범위<input value={props.sheetRange} onChange={event => props.onSheetRange(event.target.value)} required maxLength={128} placeholder="예: '시트1'!A1:C20" /></label>
          <button className="primary-button" type="submit" disabled={busy || !props.sheetId.trim()}>{busy ? '읽는 중…' : '시트 데이터 확인'}</button>
        </form>
        {props.preview && <div className="sheet-preview"><p><strong>{props.preview.range}</strong> · {props.preview.values.length}행</p>{props.preview.values.length ? <>
          <div className="sheet-table-wrap"><table aria-label="Google Sheets 미리보기"><thead><tr>{props.preview.values[0].map((cell, index) => <th scope="col" key={index}>{cell === '' ? `열 ${index + 1}` : String(cell)}</th>)}</tr></thead><tbody>{props.preview.values.slice(1).map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{String(cell)}</td>)}</tr>)}</tbody></table></div>
          <p className={props.validation?.issues.length ? 'sheet-validation-error' : 'sheet-validation-ok'} role="status">{props.validation?.issues.length ? props.validation.issues.join(' ') : `가져올 행 ${props.validation?.validRows ?? 0}개를 확인했어요.`}</p><button className="primary-button" type="button" onClick={props.onCreateProject} disabled={projectBusy || !props.validation?.validRows || Boolean(props.validation.issues.length)}>{projectBusy ? '프로젝트 만드는 중…' : '시트 데이터로 DB 프로젝트 만들기'}</button><p className="sheet-import-note">새 프로젝트를 만들고 한 번 동기화합니다. 첫 번째 열은 고유 키로 사용하며 잘못된 행이나 중복 키가 있으면 중단합니다.</p>
        </> : <p>범위에 데이터가 없어요. 탭 이름과 범위를 확인해 주세요.</p>}</div>}
        <details className="connection-code"><summary>프로젝트 코드에서 직접 읽기</summary><pre>{`from weblink_api import get_google_sheet\n\nsheet = get_google_sheet("${props.sheetId || 'SPREADSHEET_ID'}", "${props.sheetRange}")\nprint(sheet["values"])`}</pre><p>시트 쓰기는 편집 권한이 있을 때 명시적으로 코드를 실행해 진행합니다.</p></details>
      </>}
    </section>}
  </main>
}
