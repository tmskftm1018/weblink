import { useState } from 'react'
import { LearningLevel, LearningSubjectId, LearningPath } from '../services/learning'

export default function LearningPathPanel({ profile, busy, onSave, onDiagnostic }: {
  profile: LearningPath
  busy: boolean
  onSave: (level: LearningLevel | null, subjectIds: LearningSubjectId[]) => void
  onDiagnostic: () => void
}) {
  const [editing, setEditing] = useState(!profile.level)
  const [level, setLevel] = useState(profile.level)
  const [subjectIds, setSubjectIds] = useState(profile.subject_ids)
  const current = profile.levels.find(item => item.id === profile.level)
  const recommended = profile.levels.find(item => item.id === profile.recommended_level)
  return <section className="learning-path" aria-labelledby="learning-path-title">
    <div className="learning-home__section-heading"><div><h2 id="learning-path-title">{current ? current.title : '나에게 맞는 시작 방식'}</h2><p>{current?.description ?? '현재 경험을 골라 주세요. M01의 경험 선택과 진단 답변도 여기에 연결됩니다.'}</p></div>{!editing && <button disabled={busy} onClick={() => setEditing(true)}>과목·난이도 설정</button>}</div>
    {editing ? <form onSubmit={event => { event.preventDefault(); onSave(level, subjectIds) }}>
      <fieldset disabled={busy} className="learning-path__levels"><legend>배우고 싶은 과목 · 여러 개 선택 가능</legend>{profile.subjects.map(subject => <label key={subject.id} className={subjectIds.includes(subject.id) ? 'is-selected' : ''}><input type="checkbox" checked={subjectIds.includes(subject.id)} onChange={event => setSubjectIds(current => event.target.checked ? [...current, subject.id] : current.filter(id => id !== subject.id))} /><span><strong>{subject.title}</strong><small>{subject.description}</small></span></label>)}</fieldset>
      {!subjectIds.length && <p role="alert">배울 과목을 한 개 이상 선택해 주세요.</p>}
      <fieldset disabled={busy} className="learning-path__levels"><legend>현재 경험에 가까운 방식을 선택하세요</legend>{profile.levels.map(item => <label key={item.id} className={level === item.id ? 'is-selected' : ''}><input type="radio" name="learning-level" checked={level === item.id} onChange={() => setLevel(item.id)} /><span><strong>{item.title}</strong><small>{item.description}</small></span></label>)}</fieldset>
      <div className="learning-path__actions"><button className="learning-studio__primary" type="submit" disabled={busy || !subjectIds.length}>{busy ? '저장 중…' : '과목·난이도 저장'}</button>{recommended && <button type="button" disabled={busy || !subjectIds.length} onClick={() => onSave(null, subjectIds)}>추천 경로 적용 · {recommended.title}</button>}{current && <button type="button" disabled={busy} onClick={() => { setLevel(profile.level); setSubjectIds(profile.subject_ids); setEditing(false) }}>변경 취소</button>}</div><p className="learning-home__footnote">과목을 선택해도 선수 미션과 공통 연결 실습은 유지됩니다. 난이도를 선택하지 않으면 M01에 기록한 경험을 사용하고, 아직 답변이 없으면 입문으로 시작해요. 추천 경로는 위 버튼으로 적용할 수 있어요.</p>
    </form> : <>
      {profile.source === 'M01' && <p>M01에 저장한 경험을 시작 방식으로 사용하고 있어요. 현재 수준에 맞게 언제든 바꿀 수 있습니다.</p>}
      {recommended && <p>진단·경험 기반 추천: <strong>{recommended.title}</strong>{recommended.id !== profile.level ? profile.source === 'M01' ? ' · 현재는 M01에 기록한 경험을 기준으로 안내하고 있어요.' : ' · 직접 선택한 경로를 적용하고 있어요.' : ''}</p>}
      <p>선택한 과목: <strong>{profile.subjects.filter(subject => profile.subject_ids.includes(subject.id)).map(subject => subject.title).join(' · ')}</strong></p>
    </>}
    <div className="learning-path__diagnostic"><p>{profile.diagnostic_status === 'COMPLETE' ? `M01 저장본 v${profile.diagnostic_version}의 진단을 사용합니다.` : profile.diagnostic_status === 'PARTIAL' ? 'M01의 진단 답변이 일부 남아 있어요. 저장된 답변을 이어 작성할 수 있습니다.' : '추천이 필요하면 M01의 짧은 진단을 진행해 보세요. 별도로 같은 진단을 다시 작성할 필요는 없어요.'}</p><button type="button" disabled={busy} onClick={onDiagnostic}>{profile.diagnostic_status === 'COMPLETE' ? 'M01 진단 답변 다시 보기' : 'M01에서 경험·진단 작성하기'}</button>{!!profile.review.length && <details><summary>진단에서 살펴본 개념</summary><ul>{profile.review.map(item => <li key={item.id}><strong>{item.correct ? '익숙한 개념' : '복습 추천'} · {item.label}</strong><p>{item.explanation}</p></li>)}</ul></details>}</div>
    <p className="learning-home__footnote">새 미션의 제공 코드와 필수 과제 범위가 달라져요. 입문은 안내 따라 구현하고, 기본은 M10·M12, 경험자는 M05·M07·M10·M12에서 전이 과제도 완성합니다. M12는 모든 경로에서 두 앱을 확인해요. 이미 저장한 미션은 처음 시작한 과제 기준을 유지합니다.</p>
  </section>
}
