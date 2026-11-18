import { connectionAreas } from '../services/learningPresentation'
import connectionSketch from '../assets/journal-connection.png'

const parts = [
  { id: 'screen', title: '화면' },
  { id: 'server', title: '서버 · API' },
  { id: 'database', title: '저장소 · DB' },
]

export default function LearningConnectionMap({ nodeId }: { nodeId?: string }) {
  const active = connectionAreas(nodeId)
  return <figure className="journal-connection">
    <img src={connectionSketch} alt="입력한 글이 화면에서 서버를 거쳐 데이터베이스에 저장되는 흐름" width={1536} height={1024} />
    <figcaption>{parts.map(part => <span key={part.id} className={active.includes(part.id) ? 'is-active' : undefined}>{part.title}</span>)}</figcaption>
  </figure>
}
