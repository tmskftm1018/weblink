import { useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import connectionSketch from '../src/assets/journal-connection.png'
import './styles.css'

const lessons = [
  {
    name: '화면',
    file: 'WritePage.jsx',
    description: '등록을 누르면 화면이 제목과 내용을 JSON으로 묶어 서버에 보냅니다.',
    code: `async function savePost(title, content) {
  const response = await fetch('/api/posts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content })
  })

  if (!response.ok) throw new Error('등록 실패')
  return response.json()
}`,
  },
  {
    name: 'API',
    file: 'main.py',
    description: 'POST 요청을 받은 서버가 입력을 확인하고 글을 저장합니다. 저장된 글을 201 응답으로 돌려줍니다.',
    code: `@app.post("/api/posts", status_code=201)
def create_post(post: PostCreate):
    if not post.title.strip() or not post.content.strip():
        raise HTTPException(
            status_code=422, detail="제목과 내용을 입력하세요"
        )

    return insert_post(post.title, post.content)`,
  },
  {
    name: 'DB',
    file: 'posts.sql',
    description: '서버가 제목과 내용을 posts 테이블에 저장하고, 새 글의 ID를 받습니다.',
    code: `INSERT INTO posts (title, content)
VALUES (:title, :content)
RETURNING id, title, content;`,
  },
]

type Post = { id: number; title: string; content: string }

const example = {
  id: 1,
  title: '첫 번째 개발일지',
  content: '화면에서 입력한 글이 API를 거쳐 글 목록에 나타났어요.',
}
const defaultTitle = '서버에 연결한 날'
const defaultContent = '등록 버튼으로 새 글을 보냈어요.'

function Demo() {
  const [layer, setLayer] = useState(0)
  const [title, setTitle] = useState(defaultTitle)
  const [content, setContent] = useState(defaultContent)
  const [posts, setPosts] = useState<Post[]>([example])
  const [error, setError] = useState('')
  const latestPost = posts.length > 1 ? posts[0] : undefined
  const lesson = lessons[layer]

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const newTitle = title.trim()
    const newContent = content.trim()
    if (!newTitle || !newContent) {
      setError('제목과 내용을 모두 입력해 주세요.')
      return
    }
    setPosts(previous => [
      { id: previous[0].id + 1, title: newTitle, content: newContent },
      ...previous,
    ])
    setTitle('')
    setContent('')
    setError('')
  }

  function reset() {
    setTitle(defaultTitle)
    setContent(defaultContent)
    setPosts([example])
    setError('')
    setLayer(0)
  }

  return <>
    <header className="site-header">
      <div className="header-inner">
        <a className="brand" href={import.meta.env.BASE_URL}>우리들의 개발일지</a>
        <a className="repository" href="https://github.com/tmskftm1018/weblink">GitHub 저장소 ↗</a>
      </div>
    </header>
    <main className="layout">
      <section className="notebook" aria-labelledby="lesson-title">
        <p className="eyebrow">웹 서비스 만들기 · 공개 시연</p>
        <h1 id="lesson-title">등록 버튼을<br />서버에 연결하기</h1>
        <p>글 하나가 화면에서 API를 거쳐 DB에 저장되는 흐름을 따라가 보세요.</p>
        <img src={connectionSketch} alt="글쓰기 화면에서 API 서버를 거쳐 데이터베이스에 글이 전달되는 그림" width="1536" height="1024" />
        <div className="layers" role="group" aria-label="단계별 예시 코드">
          {lessons.map((item, index) => <button
            key={item.name}
            type="button"
            aria-pressed={index === layer}
            onClick={() => setLayer(index)}
          >{item.name}</button>)}
        </div>
        <p className="layer-description" aria-live="polite">{lesson.description}</p>
        <a className="practice-link" href="#practice">등록 실습하기 ↓</a>
      </section>
      <div className="workspace">
        <section className="code-panel" aria-label="단계별 예시 코드">
          <div className="panel-heading">
            <span className="filename">{lesson.file}</span>
            <span>예시 코드</span>
          </div>
          <pre tabIndex={0}><code>{lesson.code}</code></pre>
        </section>
        <section className="practice" id="practice" aria-labelledby="practice-title">
          <div className="practice-heading">
            <div>
              <h2 id="practice-title">글 등록 체험</h2>
              <p>브라우저에서 저장 흐름을 재현해요. 새로고침하면 초기화돼요.</p>
            </div>
            <button className="reset" type="button" onClick={reset}>초기화</button>
          </div>
          <div className="practice-grid">
            <form onSubmit={submit}>
              <label htmlFor="post-title">제목</label>
              <input id="post-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={80} required />
              <label htmlFor="post-content">내용</label>
              <textarea id="post-content" value={content} onChange={event => setContent(event.target.value)} maxLength={400} rows={3} required />
              {error && <p className="error" role="alert">{error}</p>}
              <button className="submit" type="submit">글 등록하기</button>
            </form>
            <div className="results">
              <h3>글 목록</h3>
              <div role="status" className="request-status">
                {latestPost && <>요청 예시 <code>POST /api/posts → 201 Created</code></>}
              </div>
              <ul>
                {posts.map(post => <li key={post.id}>
                  <strong>{post.title}</strong>
                  <p>{post.content}</p>
                </li>)}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </main>
  </>
}

createRoot(document.getElementById('root')!).render(<Demo />)
