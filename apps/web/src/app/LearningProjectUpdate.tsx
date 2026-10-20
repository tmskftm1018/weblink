import { useState } from 'react'
import { curriculumService, LearningProjectPreview } from '../services/learning'

const states = { MATCH: '같은 내용', KEEP: '프로젝트 수정 유지', UPDATE: '학습 변경 반영', CONFLICT: '양쪽 변경 · 선택 필요' }

export default function LearningProjectUpdate({ enrollmentId, nodeId, version, disabled, onApplied }: {
  enrollmentId: string; nodeId: string; version: number; disabled: boolean; onApplied: () => void
}) {
  const [field, setField] = useState('source')
  const [preview, setPreview] = useState<LearningProjectPreview | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, 'KEEP_PROJECT' | 'USE_LEARNING'>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [previewVersion, setPreviewVersion] = useState(0)
  const conflicts = preview?.changes.filter(item => item.state === 'CONFLICT') ?? []
  return <details className="learning-help"><summary>변경한 학습 코드를 기존 프로젝트에 반영하기</summary>
    <p>바뀐 학습 답안을 실행·제출한 뒤 비교하세요. 프로젝트에서 직접 수정한 코드와 다른 파일은 보존합니다. 충돌한 파일에서 학습 코드 사용을 선택하면 해당 프로젝트 파일의 내용을 교체하고 이전 코드는 리비전에 보관합니다.</p>
    <label>대상 과제<select value={field} disabled={disabled || busy} onChange={event => { setField(event.target.value); setPreview(null); setResolutions({}); setError(''); setNotice('') }}><option value="source">본 과제 프로젝트</option><option value="transfer_source">전이 과제 프로젝트</option></select></label>
    <button disabled={disabled || busy || !version} onClick={async () => {
      setBusy(true); setError(''); setNotice(''); setPreview(null); setResolutions({})
      try { const data = await curriculumService.previewProject(enrollmentId, nodeId, version, field); setPreview(data); setPreviewVersion(version) }
      catch (cause) { setError(cause instanceof Error ? cause.message : '변경사항을 비교하지 못했어요.') }
      finally { setBusy(false) }
    }}>{busy ? '처리 중…' : '프로젝트와 변경사항 비교'}</button>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {preview && <section><h4>{preview.project_name} · 초안 v{preview.expected_draft_version}</h4><p>{preview.scope}</p>{previewVersion !== version && <p role="alert">학습 저장본이 바뀌었어요. 다시 비교해 주세요.</p>}
      {preview.changes.map(item => <details key={item.path} open={item.state === 'CONFLICT'}><summary>{item.path} · {states[item.state]}</summary>
        {item.state === 'CONFLICT' && <label>반영할 내용<select value={resolutions[item.path] ?? ''} disabled={disabled || busy} onChange={event => {
          const value = event.target.value
          setResolutions(current => { const next = { ...current }; if (value === 'KEEP_PROJECT' || value === 'USE_LEARNING') next[item.path] = value; else delete next[item.path]; return next })
        }}><option value="">선택해 주세요</option><option value="KEEP_PROJECT">현재 프로젝트 유지</option><option value="USE_LEARNING">새 학습 코드 사용</option></select></label>}
        <details><summary>이전에 가져온 학습 원본</summary><pre>{item.base ?? '(파일 없음)'}</pre></details><details><summary>현재 프로젝트</summary><pre>{item.project ?? '(프로젝트에서 삭제한 파일)'}</pre></details><details><summary>새 학습 코드</summary><pre>{item.learning ?? '(파일 없음)'}</pre></details>
      </details>)}
      <button disabled={disabled || busy || previewVersion !== version || conflicts.some(item => !resolutions[item.path])} onClick={async () => {
        setBusy(true); setError('')
        try { const result = await curriculumService.syncProject(enrollmentId, nodeId, version, field, preview, resolutions); setNotice(result.message); setPreview(null); setResolutions({}); onApplied() }
        catch (cause) { setError(cause instanceof Error ? cause.message : '변경사항을 반영하지 못했어요. 다시 비교해 주세요.'); setPreview(null); setResolutions({}) }
        finally { setBusy(false) }
      }}>선택한 변경사항 반영·코드 버전 저장</button>
    </section>}
  </details>
}
