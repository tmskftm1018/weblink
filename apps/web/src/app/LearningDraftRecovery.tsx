import { useState } from 'react'
import { LearningDraft } from '../services/learningDrafts'
import { LearningNode, LearningWork } from '../services/learning'

export default function LearningDraftRecovery({ draft, work, node, busy, onRestore, onDiscard, onDownload }: {
  draft: LearningDraft; work: LearningWork; node: LearningNode; busy: boolean
  onRestore: (answers: Record<string, string>) => void; onDiscard: () => void; onDownload: () => void
}) {
  const [choices, setChoices] = useState<Record<string, 'local' | 'server'>>({})
  const fields = [...new Set([...Object.keys(work.answers), ...Object.keys(draft.answers)])]
    .filter(key => (work.answers[key] ?? '') !== (draft.answers[key] ?? ''))
  const outdated = draft.version !== work.version
  const ready = !outdated || fields.every(key => choices[key])
  return <section className="learning-draft-recovery" aria-label="저장 전 답안 복구">
    <h3>{outdated ? '서버 답안과 복구본을 비교해 주세요' : '저장 전 작성 내용이 남아 있어요'}</h3>
    <p>복구본 기준 v{draft.version} · 서버 v{work.version}{draft.updatedAt && ` · 임시 보관 ${new Date(draft.updatedAt).toLocaleString('ko-KR')}`}</p>
    <p>{outdated ? '다른 창에서 저장했을 수 있어요. 항목마다 사용할 내용을 선택한 뒤 편집기로 가져오세요.' : '이 브라우저에 보관한 내용을 편집기로 가져올 수 있어요.'} 복구만으로 서버 저장이나 미션 완료가 이루어지지는 않아요.</p>
    {fields.map(key => <details key={key}>
      <summary>{node.fields.find(field => field.id === key)?.label ?? (key === 'concept_answer' ? '개념 확인' : key)}</summary>
      <div className="learning-draft-recovery__columns"><div><strong>서버 저장본</strong><pre>{work.answers[key] || '(비어 있음)'}</pre></div><div><strong>복구본</strong><pre>{draft.answers[key] || '(비어 있음)'}</pre></div></div>
      {outdated && <label>사용할 내용<select value={choices[key] ?? ''} disabled={busy} onChange={event => setChoices(current => ({ ...current, [key]: event.target.value as 'local' | 'server' }))}><option value="" disabled>선택해 주세요</option><option value="server">서버 저장본 유지</option><option value="local">복구본 사용</option></select></label>}
    </details>)}
    <div className="learning-html-exercise__toolbar"><button disabled={busy || !ready} onClick={() => {
      const merged = { ...work.answers }
      for (const key of fields) if (!outdated || choices[key] === 'local') {
        if (Object.prototype.hasOwnProperty.call(draft.answers, key)) merged[key] = draft.answers[key]
        else delete merged[key]
      }
      onRestore(merged)
    }}>선택한 내용 편집기로 가져오기</button><button disabled={busy} onClick={onDownload}>복구본 내려받기</button><button disabled={busy} onClick={onDiscard}>복구본 버리고 서버 답안 사용</button></div>
    <small>복구본은 이 기기의 브라우저에 보관됩니다. 공용 기기에서는 복구본을 정리하고 로그아웃하세요. 브라우저 데이터 삭제 시 복구본도 사라집니다.</small>
  </section>
}
