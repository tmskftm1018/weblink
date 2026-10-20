import { useId, useState } from 'react'
import type { Lesson } from '../services/learning'
import './BlockExercise.css'

type BlockActivity = NonNullable<Lesson['content']['block_activity']>
type Block = BlockActivity['blocks'][number]

type Props = {
  activity: BlockActivity
  palette: Block[]
  selectedIds: string[]
  disabled: boolean
  onAdd: (id: string) => void
  onMove: (index: number, offset: number) => void
  onRemove: (index: number) => void
}

function BlockChoice({ block, used, disabled, onAdd }: {
  block: Block
  used: boolean
  disabled: boolean
  onAdd: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const lines = block.code.replace(/\n$/, '').split('\n')
  const isLong = lines.length > 3
  return (
    <li className={`block-exercise__choice${used ? ' is-used' : ''}`}>
      <div className="block-exercise__choice-heading">
        <strong>{block.label}</strong>
        <button type="button" className="block-exercise__add" onClick={onAdd} disabled={disabled || used}
          aria-label={used ? `${block.label}: 사용 중` : `${block.label} 블록 추가`}>
          {used ? '✓ 사용 중' : '+ 추가'}
        </button>
      </div>
      <div id={detailsId}>
        <pre className="block-exercise__fragment" tabIndex={0} aria-label={`${block.label} 코드 조각`}>
          <code>{expanded || !isLong ? block.code : `${lines.slice(0, 3).join('\n')}\n…`}</code>
        </pre>
        {expanded && block.description && <p className="block-exercise__description">{block.description}</p>}
      </div>
      {(isLong || block.description) && (
        <button className="block-exercise__details" type="button" aria-expanded={expanded}
          aria-controls={detailsId} onClick={() => setExpanded(!expanded)}>
          {expanded ? '설명 접기' : isLong ? `전체 ${lines.length}줄 · 설명 보기` : '이 블록 설명 보기'}
        </button>
      )}
    </li>
  )
}

export default function BlockExercise({ activity, palette, selectedIds, disabled, onAdd, onMove, onRemove }: Props) {
  const selectedBlocks = selectedIds.flatMap((id, index) => {
    const block = activity.blocks.find((item) => item.id === id)
    return block ? [{ block, index }] : []
  })
  const source = selectedBlocks.map(({ block }) => block.code).join('')

  return (
    <div className="block-exercise">
      <p className="block-exercise__instruction">{activity.instruction}</p>
      <div className="block-exercise__goal">
        <span>만들고 싶은 결과 <small>예상 출력</small></span>
        <pre>{activity.expected_output}</pre>
      </div>

      <section className="block-exercise__section" aria-label="블록 선택">
        <div className="block-exercise__section-heading">
          <h3><span aria-hidden="true">1</span> 필요한 블록 고르기</h3>
          <span className="block-exercise__count" role="status" aria-live="polite">
            {selectedBlocks.length}개 사용 중 · {palette.length - selectedBlocks.length}개 남음
          </span>
        </div>
        <p className="block-exercise__help">코드 조각을 읽고 ‘추가’를 누르세요. 설명은 필요할 때 펼칠 수 있어요.</p>
        <ul className="block-exercise__choices">
          {palette.map((block) => (
            <BlockChoice key={block.id} block={block} used={selectedIds.includes(block.id)}
              disabled={disabled} onAdd={() => onAdd(block.id)} />
          ))}
        </ul>
      </section>

      <section className="block-exercise__section" aria-label="블록 순서">
        <div className="block-exercise__section-heading">
          <h3><span aria-hidden="true">2</span> 실행할 순서 정하기</h3>
        </div>
        <p className="block-exercise__help">위에서 아래로 이어집니다. 화살표로 옮기거나 ‘빼기’로 다시 선택하세요.</p>
        <ol className="block-exercise__sequence">
          {selectedBlocks.map(({ block, index }) => (
            <li key={block.id}>
              <span className="block-exercise__position" aria-hidden="true">{index + 1}</span>
              <div className="block-exercise__selected-label">
                <strong>{block.label}</strong>
                <code>{block.code.split('\n').find((line) => line.trim()) || '빈 줄'}</code>
              </div>
              <div className="block-exercise__controls">
                <button type="button" aria-label={`${block.label} 위로 이동`} title="위로 이동"
                  disabled={disabled || index === 0} onClick={() => onMove(index, -1)}>↑</button>
                <button type="button" aria-label={`${block.label} 아래로 이동`} title="아래로 이동"
                  disabled={disabled || index === selectedIds.length - 1} onClick={() => onMove(index, 1)}>↓</button>
                <button type="button" aria-label={`${block.label} 블록 빼기`}
                  disabled={disabled} onClick={() => onRemove(index)}>빼기</button>
              </div>
            </li>
          ))}
          {!selectedBlocks.length && (
            <li className="block-exercise__empty">위에서 블록을 추가하면 여기에서 순서를 정할 수 있어요.</li>
          )}
        </ol>
      </section>

      <section className="block-exercise__section" aria-label="조립한 코드 미리보기">
        <div className="block-exercise__section-heading">
          <h3><span aria-hidden="true">3</span> 완성되는 코드 읽기</h3>
          <span className="block-exercise__count">아직 실행하지 않았어요</span>
        </div>
        <p className="block-exercise__help">선택한 조각을 그대로 이은 코드예요. 예상한 순서인지 읽고 답안을 확인하세요.</p>
        <pre className="block-exercise__source" tabIndex={0} aria-label="조립한 파이썬 코드">
          <code>{source || '# 블록을 추가하면 코드가 여기에 표시돼요.'}</code>
        </pre>
      </section>
    </div>
  )
}
