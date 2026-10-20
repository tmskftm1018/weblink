import { lazy, ReactNode, Suspense, useEffect, useState } from 'react'
import { curriculumService, LearningProjectContext, ProjectJump } from '../services/learning'

const Editor = lazy(() => import('./MonacoCodeEditor'))

export default function LearningProjectBridge({ enrollmentId, disabled, onActive, onOpen, renderFoundation }: {
  enrollmentId: string; disabled: boolean; onActive: (active: boolean) => void
  onOpen: (projectId: string, jump: ProjectJump) => Promise<void>
  renderFoundation: (id: string) => ReactNode
}) {
  const [context, setContext] = useState<LearningProjectContext | null>(null)
  const [path, setPath] = useState('')
  const [line, setLine] = useState(1)
  const [bridgeId, setBridgeId] = useState('')
  const [selectedProject, setSelectedProject] = useState('')
  const [returned, setReturned] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    void curriculumService.projectContext(enrollmentId).then(data => {
      if (!active) return
      setSelectedProject(data.project_id ?? data.projects[0]?.id ?? ''); setContext(data); onActive(Boolean(data.active_bridge_id))
      const snapshot = data.active_bridge_id ? data.origin : data.latest
      setPath(snapshot?.files.find(file => file.path === data.file_path)?.path ?? snapshot?.files.find(file => file.path === 'web/src/App.jsx')?.path ?? snapshot?.files[0]?.path ?? '')
      setLine(data.cursor_line ?? 1); setBridgeId(data.active_bridge_id ?? data.bridges[0]?.id ?? '')
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '프로젝트 위치를 읽지 못했어요.') })
    return () => { active = false }
  }, [enrollmentId, retry])
  if (error && !context) return <section className="learning-studio__section"><p role="alert">{error}</p><button onClick={() => { setError(''); setRetry(value => value + 1) }}>프로젝트 연결 다시 읽기</button></section>
  if (!context || (!context.project_id && !context.projects.length)) return null
  const snapshot = context.active_bridge_id || returned ? context.origin : context.latest
  const selected = snapshot?.files.find(file => file.path === path)
  const bridge = context.bridges.find(item => item.id === (context.active_bridge_id ?? bridgeId))
  return <details className="learning-help" open={Boolean(context.active_bridge_id) || returned}>
    <summary>연결 프로젝트 · {context.project_name ?? '프로젝트 선택'} · 기초 설명과 코드 복귀</summary>
    <p>저장된 코드에서 파일과 위치를 선택한 뒤 기초 설명을 열면 그 버전·파일·줄을 보관합니다. 프로젝트의 미저장 내용과 리비전으로 확정하지 않은 초안은 포함하지 않습니다. 돌아와도 최신 프로젝트 내용을 덮어쓰지 않습니다.</p>
    {error && <p role="alert">{error}</p>}
    <label>기초 설명에 연결할 프로젝트<select value={selectedProject} disabled={disabled || busy || Boolean(context.active_bridge_id)} onChange={event => setSelectedProject(event.target.value)}>{context.projects.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button disabled={disabled || busy || Boolean(context.active_bridge_id) || !selectedProject || selectedProject === context.project_id} onClick={async () => { setBusy(true); setError(''); try { const data = await curriculumService.linkProject(enrollmentId, selectedProject); setContext(data); setPath(data.file_path ?? ''); setLine(data.cursor_line ?? 1); setBridgeId(data.bridges[0]?.id ?? ''); setReturned(false) } catch (cause) { setError(cause instanceof Error ? cause.message : '프로젝트를 연결하지 못했어요.') } finally { setBusy(false) } }}>선택한 프로젝트에 연결</button>
    {context.active_bridge_id ? <section><h3>{bridge?.title}</h3><p>{bridge?.objective}</p><p>{bridge?.concepts.join(' · ')}</p><p>{bridge?.observation}</p>{bridge?.foundation_ids.map(id => <section key={id}>{renderFoundation(id)}</section>)}<button disabled={disabled || busy} onClick={async () => {
      setBusy(true); setError('')
      try { const data = await curriculumService.bridge(enrollmentId, { action: 'RETURN' }); setContext(data); setPath(data.file_path ?? ''); setLine(data.cursor_line ?? 1); setReturned(true); onActive(false) }
      catch (cause) { setError(cause instanceof Error ? cause.message : '복귀 위치를 읽지 못했어요.') }
      finally { setBusy(false) }
    }}>원래 코드 버전·파일·줄로 돌아가기</button></section> : <>
      {returned && <p role="status">당시 코드 버전으로 돌아왔어요. 이 미리보기는 읽기 전용입니다.</p>}
      {context.latest?.revision_id !== context.origin?.revision_id && context.origin && <button disabled={busy} onClick={() => { const data = returned ? context.latest : context.origin; setReturned(!returned); setPath(data?.files.find(file => file.path === path)?.path ?? data?.files[0]?.path ?? '') }}> {returned ? '최신 저장 버전 보기' : '마지막 복귀 버전 보기'}</button>}
      <label>기초 설명<select value={bridgeId} disabled={disabled || busy || !context.bridges.length} onChange={event => setBridgeId(event.target.value)}>{context.bridges.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <button disabled={disabled || busy || !bridgeId || !snapshot || !selected} onClick={async () => {
        if (!snapshot || !selected) return
        setBusy(true); setError('')
        try { const data = await curriculumService.bridge(enrollmentId, { action: 'ENTER', bridge_id: bridgeId, revision_id: snapshot.revision_id, file_path: selected.path, cursor_line: line }); setContext(data); onActive(true) }
        catch (cause) { setError(cause instanceof Error ? cause.message : '기초 설명을 열지 못했어요.') }
        finally { setBusy(false) }
      }}>이 코드 위치를 보관하고 기초 설명 보기</button>
    </>}
    <label>저장된 파일<select value={path} disabled={busy || Boolean(context.active_bridge_id)} onChange={event => { setPath(event.target.value); setLine(1) }}>{snapshot?.files.map(file => <option key={file.path}>{file.path}</option>)}</select></label>
    <p>줄 {line} · 버전 {snapshot?.source_hash.slice(0, 12)} · 읽기 전용{snapshot?.revision_id !== context.latest?.revision_id && ' · 최신 저장 버전과 다릅니다'}</p>
    {selected && <div className="learning-html-exercise__editor"><Suspense fallback={<p>코드 위치를 여는 중…</p>}><Editor key={`${snapshot?.revision_id}/${path}`} path={`learning-project/${context.project_id}/${snapshot?.revision_id}/${path}`} value={selected.content} initialLine={line} readOnly onChange={() => {}} onCursorChange={setLine} /></Suspense></div>}
    {!context.active_bridge_id && <button disabled={disabled || busy || !context.project_id} onClick={async () => { setBusy(true); setError(''); try { await onOpen(context.project_id!, { file_path: path, cursor_line: line, notice: snapshot?.revision_id !== context.latest?.revision_id ? '당시 코드 버전은 학습 화면에 보존했습니다. 현재 편집기는 최신 프로젝트이며 파일을 덮어쓰지 않았습니다.' : undefined }) } catch (cause) { setError(cause instanceof Error ? cause.message : '프로젝트를 열지 못했어요.') } finally { setBusy(false) } }}>최신 프로젝트 편집기로 열기</button>}
  </details>
}
