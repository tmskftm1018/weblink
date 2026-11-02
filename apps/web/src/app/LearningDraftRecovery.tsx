import { useMemo, useState } from 'react'
import { LearningDraft, compareLearningRecovery } from '../services/learningDrafts'
import { resolveAnswerRecovery } from '../services/answerRecovery'
import { LearningNode, LearningWork } from '../services/learning'

const content = (value: string | null) => value === null ? '(항목 없음)' : value || '(빈 값)'

export default function LearningDraftRecovery({ draft, work, node, busy, onRestore, onDiscard, onDownload }: {
  draft: LearningDraft; work: LearningWork; node: LearningNode; busy: boolean
  onRestore: (answers: Record<string, string>) => void; onDiscard: () => void; onDownload: () => void
}) {
  const [choices, setChoices] = useState<Record<string, 'local' | 'server'>>({})
  const rows = useMemo(() => compareLearningRecovery(draft, work), [draft, work])
  const allowed = new Set([...node.fields.map(field => field.id), 'concept_answer'])
  const changed = rows.filter(row => row.local !== row.server)
  const conflicts = changed.filter(row => row.conflict && allowed.has(row.path))
  const unsupported = changed.filter(row => !allowed.has(row.path))
  const ready = conflicts.every(row => Object.prototype.hasOwnProperty.call(choices, row.path))
  const changedAssignment = draft.assignmentKey && draft.assignmentKey !== node.assignment.key
  return <section className="learning-draft-recovery" aria-label="저장 전 답안 복구">
    <h3>{conflicts.length ? '양쪽에서 수정한 항목을 선택해 주세요' : '보관한 변경과 최신 답안을 함께 이어갑니다'}</h3>
    <p>복구본 기준 v{draft.version} · 서버 v{work.version}{draft.updatedAt && ` · 임시 보관 ${new Date(draft.updatedAt).toLocaleString('ko-KR')}`}</p>
    <p>다른 내용 {changed.length}개 · 직접 선택할 항목 {conflicts.length}개. 한쪽에서만 바뀐 항목은 함께 반영하고, 같은 항목이 양쪽에서 바뀌면 사용할 내용을 선택하세요.</p>
    {!draft.baseAnswers && draft.version !== work.version && <p>이전 복구본에 수정 전 기준이 없어, 다른 항목을 각각 비교합니다.</p>}
    {changedAssignment && <p role="status">처음 작성할 때와 학습 경로가 달라졌어요. 코드는 비교해서 가져오며 제출할 때는 현재 표시된 ‘{node.assignment.title}’ 기준을 사용합니다.</p>}
    {unsupported.length > 0 && <p role="status">현재 과제에서 사용하지 않는 항목은 가져오지 않습니다. 원본이 필요하면 복구본을 내려받아 보관하세요.</p>}
    {changed.map(row => <details key={row.path} open={row.conflict && allowed.has(row.path)}>
      <summary>{node.fields.find(field => field.id === row.path)?.label ?? (row.path === 'concept_answer' ? '개념 확인' : row.path)} · {!allowed.has(row.path) ? '현재 과제에서 제외' : row.conflict ? '선택 필요' : row.selected === 'local' ? '내 변경 유지' : '서버 변경 유지'}</summary>
      <div className="learning-draft-recovery__columns"><div><strong>내 복구본</strong><pre>{content(row.local)}</pre></div><div><strong>서버 저장본</strong><pre>{content(row.server)}</pre></div></div>
      {draft.baseAnswers && <details><summary>수정 전 기준</summary><pre>{content(row.base)}</pre></details>}
      {allowed.has(row.path) && <label>사용할 내용<select value={choices[row.path] ?? (row.conflict ? '' : row.selected)} disabled={busy} onChange={event => setChoices(current => ({ ...current, [row.path]: event.target.value as 'local' | 'server' }))}><option value="" disabled>선택해 주세요</option><option value="server">서버 저장본 유지</option><option value="local">내 복구본 사용</option></select></label>}
    </details>)}
    <div className="learning-html-exercise__toolbar"><button disabled={busy || !ready} onClick={() => {
      const merged = resolveAnswerRecovery(rows.filter(row => allowed.has(row.path)), choices)
      if (allowed.has('transfer_mode') && !merged.transfer_mode) merged.transfer_mode = '본 과제부터 마치기'
      onRestore(merged)
    }}>선택한 내용 편집기로 가져오기</button><button disabled={busy} onClick={onDownload}>복구본 내려받기</button><button disabled={busy} onClick={onDiscard}>복구본 버리고 서버 답안 사용</button></div>
    <small>가져오기는 서버 저장이나 미션 완료와 별개입니다. 편집기에서 확인한 뒤 저장하세요. 브라우저 데이터 삭제 시 이 기기의 복구본은 사라집니다.</small>
  </section>
}
