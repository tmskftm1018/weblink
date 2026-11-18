import { useState } from 'react'
import { connectionService, GitHubConnectionStatus } from '../services/connections'

export default function GitHubImportAccess({ disabled }: { disabled: boolean }) {
  const [status, setStatus] = useState<GitHubConnectionStatus | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function update(action: () => Promise<GitHubConnectionStatus>) {
    setBusy(true)
    setError('')
    try {
      setStatus(await action())
      setToken('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'GitHub 권한을 확인하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  return <details className="github-import-access" onToggle={event => {
    if (event.currentTarget.open && !status && !busy) void update(connectionService.githubStatus)
    if (!event.currentTarget.open) setToken('')
  }}>
    <summary>비공개 저장소 읽기 권한</summary>
    {error && <p role="alert">{error}</p>}
    {busy && <p role="status">GitHub 권한을 확인하고 있어요…</p>}
    {!status && error && <button className="secondary-button" type="button" disabled={disabled || busy} onClick={() => void update(connectionService.githubStatus)}>다시 확인</button>}
    {status?.connected ? <>
      <p>연결된 계정 · {status.account_name ?? 'GitHub'}</p>
      <button className="secondary-button" type="button" disabled={disabled || busy} onClick={() => void update(async () => {
        await connectionService.disconnectGitHub()
        return { ...status, connected: false, account_name: null, connected_at: null }
      })}>저장한 토큰 삭제</button>
    </> : status?.configured ? <>
      <p>가져올 저장소에 Contents 읽기 권한만 부여한 Fine-grained 토큰을 사용하세요.</p>
      <label>GitHub 토큰<input type="password" autoComplete="new-password" spellCheck={false} maxLength={500} disabled={disabled || busy} value={token} onChange={event => setToken(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter') event.preventDefault()
      }} /></label>
      <button className="secondary-button" type="button" disabled={disabled || busy || token.trim().length < 20} onClick={() => void update(() => connectionService.connectGitHub(token.trim()))}>읽기 권한 연결</button>
    </> : status && <p>비공개 저장소의 토큰을 보관하려면 서버의 연결 암호화 설정이 필요해요.</p>}
  </details>
}
