import { useState } from 'react'

import { learningGoals } from '../services/learningPresentation'
import LearningConnectionMap from './LearningConnectionMap'

export default function LearningMissionIntro({ nodeId, fallback }: { nodeId: string; fallback: string }) {
  const goal = learningGoals[nodeId]
  const [value, setValue] = useState('')
  const [items, setItems] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [fixed, setFixed] = useState(false)
  const interactive = ['M04', 'M05', 'M09', 'M10', 'M11', 'M12'].includes(nodeId)
  const noun = nodeId === 'M12' ? '메모' : '글'
  return <section className="journal-notebook__intro" aria-label="이번 수업에서 배우는 것">
    <h1>{goal?.title ?? fallback}</h1>
    {goal && <p>{goal.learn}</p>}
    <LearningConnectionMap nodeId={nodeId} />
    {interactive && <details className="learning-mission-intro__example">
      <summary>완성 동작 맛보기</summary><small>요청 흐름을 살펴보는 예시예요.</small>
      <label htmlFor={`example-${nodeId}`}>{nodeId === 'M12' ? '메모 내용' : '글 제목'}</label>
      <div className="learning-html-exercise__toolbar"><input id={`example-${nodeId}`} value={value} maxLength={80} onChange={event => setValue(event.target.value)} placeholder={nodeId === 'M04' ? '공백만 넣어 보고, 글도 넣어 보세요' : '첫 글을 넣고, 다음 글도 등록해 보세요'} />
        <button type="button" onClick={() => { const title = value.trim(); if (!title) { setMessage('빈 내용은 등록할 수 없어요.'); return } if (nodeId === 'M11' && !fixed) { setMessage('저장됐지만 목록이 바뀌지 않았어요. 아래에서 수정 후 동작을 비교하세요.'); return } setItems(previous => [...previous, title]); setValue(''); setMessage('목록에 추가했어요. 다른 내용도 등록해 보세요.') }}>예시 등록</button>
        {nodeId === 'M11' && <button type="button" aria-pressed={fixed} onClick={() => { setFixed(previous => !previous); setItems([]); setMessage('같은 내용으로 다시 등록해 비교해 보세요.') }}>{fixed ? '수정 전 동작 보기' : '수정 후 동작 보기'}</button>}
        {['M09', 'M10'].includes(nodeId) && <button type="button" onClick={() => setMessage(items.length ? '다시 조회한 목록에도 같은 글이 보여야 해요. 실제 저장 여부는 아래 코드 실행에서 확인합니다.' : '글을 먼저 등록해 보세요.')}>다시 조회 예시</button>}
      </div>
      {message && <p role="status">{message}</p>}
      {items.length ? <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>등록한 {noun}이 여기에 표시돼요.</p>}
    </details>}
  </section>
}
