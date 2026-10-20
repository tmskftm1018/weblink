import { useEffect, useRef, useState } from 'react'
import { BrowserDraft, clearBrowserDraft, readBrowserDraft, writeBrowserDraft } from '../services/browserDrafts'
import { fileContents, projectRecoveryKey, sameFiles } from '../services/projectRecovery'
import { ProjectWorkspace } from '../services/projects'

export default function useProjectDraftRecovery(userId: string | undefined, workspace: ProjectWorkspace | null, dirty: boolean) {
  const [pending, setPending] = useState<{ draft: BrowserDraft; server: ProjectWorkspace } | null>(null)
  const [paused, setPaused] = useState(false)
  const [storageNotice, setStorageNotice] = useState('')
  const [canDefer, setCanDefer] = useState(true)
  const baseline = useRef<{ projectId: string; draft: BrowserDraft } | null>(null)
  const identity = `${userId ?? ''}:${workspace?.id ?? ''}`
  const [checked, setChecked] = useState('')

  useEffect(() => {
    setPending(null); setPaused(false); setStorageNotice(''); setCanDefer(true); setChecked(identity)
    if (!workspace || !userId) { baseline.current = null; return }
    const server = fileContents(workspace.files)
    baseline.current = { projectId: workspace.id, draft: { version: workspace.draft_version, answers: server } }
    const draft = readBrowserDraft(projectRecoveryKey(userId, workspace.id))
    if (!draft) return
    if (sameFiles(draft.answers, server)) clearBrowserDraft(projectRecoveryKey(userId, workspace.id), draft)
    else setPending({ draft, server: workspace })
    // Only entering a project/account should offer the previous browser copy.
    // Metadata and polling updates must not restart recovery while typing.
  }, [identity])

  useEffect(() => {
    if (!workspace || !userId || checked !== identity || pending) return
    if (!dirty) {
      baseline.current = { projectId: workspace.id, draft: { version: workspace.draft_version, answers: fileContents(workspace.files) } }
      return
    }
    const protection = writeBrowserDraft(projectRecoveryKey(userId, workspace.id), snapshot(workspace))
    setStorageNotice(protection === 'persistent' ? '' : protection === 'session' ? '이 창에서만 임시 보관할 수 있어요. 창을 닫기 전에 서버 저장 또는 수정본 다운로드를 해 주세요.' : '브라우저 임시 보관을 사용할 수 없어요. 서버에 저장하거나 수정본을 내려받아 주세요.')
  }, [workspace, dirty, identity, checked, pending, userId])

  function snapshot(current: ProjectWorkspace): BrowserDraft {
    const base = baseline.current?.projectId === current.id ? baseline.current.draft : null
    return { version: base?.version ?? current.draft_version, baseAnswers: base?.answers, answers: fileContents(current.files), updatedAt: new Date().toISOString() }
  }
  function saved(current: ProjectWorkspace) {
    if (userId) clearBrowserDraft(projectRecoveryKey(userId, current.id), snapshot(current))
    setPaused(false); setStorageNotice('')
  }
  function dismiss() {
    if (pending && userId) clearBrowserDraft(projectRecoveryKey(userId, pending.server.id), pending.draft)
    setPending(null); setPaused(false); setStorageNotice('')
  }
  function accept() {
    if (!pending) return
    baseline.current = { projectId: pending.server.id, draft: { version: pending.server.draft_version, answers: fileContents(pending.server.files) } }
    setPending(null); setPaused(true)
  }
  function compare(draft: BrowserDraft, server: ProjectWorkspace) {
    if (!userId) return
    const protection = writeBrowserDraft(projectRecoveryKey(userId, server.id), draft)
    setCanDefer(protection !== 'unavailable')
    setStorageNotice(protection === 'persistent' ? '' : protection === 'session' ? '복구본은 이 창에서만 보관됩니다. 창을 닫기 전에 내려받아 주세요.' : '브라우저에 복구본을 보관하지 못했어요. 이 화면을 떠나기 전에 수정본을 내려받아 주세요.')
    setPending({ draft, server })
  }
  return { pending: checked === identity ? pending : null, paused, pause: () => setPaused(true), resume: () => setPaused(false), checked: checked === identity, storageNotice, canDefer, snapshot, saved, dismiss, accept, compare }
}
