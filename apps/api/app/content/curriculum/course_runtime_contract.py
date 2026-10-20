"""Published code contracts for the second course unit; no learner code runs here."""

REACT_STARTER = '''function App() {
  const [title, setTitle] = React.useState("");
  const [posts, setPosts] = React.useState([]);
  const [error, setError] = React.useState("");

  function handleSubmit(event) {
    event.preventDefault();
    // trim한 제목이 비면 오류 안내 후 return 하세요.
    // 유효하면 이전 오류를 지우고 새 배열로 posts를 갱신하세요.
    // 이전 배열에 직접 push하지 마세요.
  }

  return <form onSubmit={handleSubmit}>
    <h2>내 게시판</h2>
    <label htmlFor="title">제목</label>
    <input id="title" name="title" value={title}
      onChange={(event) => setTitle(event.target.value)} />
    <p role="alert">{error}</p>
    <button type="submit">게시글 추가</button>
    <ul>{posts.map((post) => <li key={post.id}>{post.title}</li>)}</ul>
  </form>;
}'''

BOOK_STARTER = '''function App() {
  const [book, setBook] = React.useState("");
  const [books, setBooks] = React.useState([]);
  const [error, setError] = React.useState("");
  function handleSubmit(event) {
    event.preventDefault();
    // 도서 이름을 검증하고 books를 새 배열로 갱신하세요.
  }
  return <form onSubmit={handleSubmit}>
    <h2>읽고 싶은 도서</h2>
    <input name="book" value={book} onChange={(event) => setBook(event.target.value)} />
    <p role="alert">{error}</p>
    <button type="submit">도서 추가</button>
    <ul>{books.map((name, index) => <li key={index}>{name}</li>)}</ul>
  </form>;
}'''

GET_STARTER = '''from fastapi import FastAPI

app = FastAPI()
posts = []

@app.get("/api/posts")
def list_posts():
    # 게시글이 없을 때도 JSON 배열을 반환하세요.
    return {}
'''

POST_STARTER = '''from fastapi import FastAPI
from pydantic import BaseModel, field_validator

app = FastAPI()
posts = []

class PostInput(BaseModel):
    title: str
    content: str = ""

    @field_validator("title", mode="before")
    @classmethod
    def validate_title(cls, value):
        # 문자열인지 확인하고 trim 후 1~80자가 아니면 ValueError를 발생시키세요.
        return value

@app.get("/api/posts")
def list_posts():
    return posts

@app.post("/api/posts", status_code=201)
def create_post(payload: PostInput):
    post = {"id": len(posts) + 1, **payload.model_dump()}
    posts.append(post)
    return post
'''

REGISTRATION_STARTER = '''from fastapi import FastAPI
from pydantic import BaseModel, field_validator

app = FastAPI()
registrations = []

class RegistrationInput(BaseModel):
    name: str

    @field_validator("name", mode="before")
    @classmethod
    def validate_name(cls, value):
        # 이름을 trim 후 1~40자로 검증하세요.
        return value

@app.get("/api/registrations")
def list_registrations():
    return registrations

@app.post("/api/registrations", status_code=201)
def create_registration(payload: RegistrationInput):
    registration = {"id": len(registrations) + 1, **payload.model_dump()}
    registrations.append(registration)
    return registration
'''

SQLITE_STARTER = '''import sqlite3

# DB 경로는 /data/learning.db 입니다. 실행마다 새 DB로 시작합니다.
# posts(id INTEGER PRIMARY KEY, title TEXT NOT NULL)를 만드세요.
# 아래 두 제목을 ? 매개변수로 INSERT하고 commit 후 SELECT로 읽어보세요.
titles = ["첫 SQLite 게시글", "'; DROP TABLE posts; --"]
with sqlite3.connect("/data/learning.db") as connection:
    # CREATE TABLE, INSERT, SELECT를 순서대로 작성하세요.
    pass
'''

SQLITE_API_STARTER = POST_STARTER.replace('posts = []', '''import sqlite3

DB_PATH = "/data/learning.db"
# posts(id INTEGER PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL)를
# CREATE TABLE IF NOT EXISTS로 준비하세요. 시작할 때 기존 행을 지우지 마세요.
''').replace('    return posts', '''    # 연결을 열어 SELECT id, title, content FROM posts ORDER BY id로 조회하고
    # [{"id": ..., "title": ..., "content": ...}] 형태로 반환하세요.
    return []''').replace('    post = {"id": len(posts) + 1, **payload.model_dump()}\n    posts.append(post)\n    return post', '''    # ? 매개변수로 INSERT하고 commit하세요.
    # 저장한 id, title, content를 반환하세요.
    return {"title": payload.title, "content": payload.content}''')

INTEGRATED_REACT_STARTER = '''function App() {
  const [title, setTitle] = React.useState("");
  const [posts, setPosts] = React.useState([]);
  const [error, setError] = React.useState("");

  async function loadPosts() {
    // GET /api/posts → response.json() → setPosts로 연결하세요.
    // response.ok가 false이면 Error를 throw하세요.
  }
  React.useEffect(() => {
    loadPosts().catch(() => setError("목록을 읽지 못했어요."));
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    // trim 후 1~80자를 확인하세요. 실패 시 오류를 표시하고 입력을 유지하세요.
    // fetch("/api/posts", {method: "POST", headers: {"Content-Type": "application/json"},
    //   body: JSON.stringify({title: title.trim(), content: ""})})
    // response.ok 확인 → await loadPosts() → 입력 및 오류 초기화 순서입니다.
    // 네트워크·서버 오류는 catch하여 role=alert에 표시하세요.
  }
  return <form onSubmit={handleSubmit}>
    <h2>서버에 저장하는 게시판</h2>
    <label htmlFor="title">제목</label>
    <input id="title" name="title" value={title}
      onChange={event => setTitle(event.target.value)} />
    <p role="alert">{error}</p>
    <button type="submit">저장</button>
    <ul>{posts.map(post => <li key={post.id}>{post.title}</li>)}</ul>
  </form>;
}'''
INVENTORY_REACT_STARTER = INTEGRATED_REACT_STARTER.replace("posts", "items").replace("Posts", "Items").replace("title", "name").replace("Title", "Name").replace("1~80", "1~40").replace("게시판", "재고 목록").replace("제목", "품목 이름")
INVENTORY_API_STARTER = SQLITE_API_STARTER.replace("posts", "items").replace("Post", "Item").replace("post", "item").replace("title", "name").replace("1~80", "1~40")

CONTRACTS = {
    "M05": {"language": "jsx", "filename": "App.jsx", "starter": REACT_STARTER, "transfer_starter": BOOK_STARTER,
            "scope": "실제 React 18 useState와 Test Renderer를 QuickJS에서 실행한 상태 변화입니다. 실제 브라우저 DOM이나 API/DB 저장은 실행하지 않습니다."},
    "M06": {"language": "python", "filename": "main.py", "starter": GET_STARTER,
            "scope": "별도 FastAPI 서버에 보낸 실제 GET 응답입니다. 실행별 메모리 목록을 사용하며 DB 저장은 다음 단원에서 다룹니다."},
    "M07": {"language": "python", "filename": "main.py", "starter": POST_STARTER, "transfer_starter": REGISTRATION_STARTER,
            "scope": "별도 FastAPI 서버의 실제 GET/POST 요청과 응답입니다. 올바른 요청만 실행별 메모리 목록에 남는지 확인합니다."},
    "M08": {"language": "python", "filename": "main.py", "starter": SQLITE_STARTER,
            "scope": "격리된 Python 스크립트가 만든 실제 SQLite 파일을 별도 검사기가 읽습니다. INSERT의 ? 매개변수 사용은 코드의 정적 확인입니다. 실행 종료 후 연습 DB는 삭제됩니다."},
    "M09": {"language": "python", "filename": "main.py", "starter": SQLITE_API_STARTER,
            "scope": "실제 HTTP 요청·SQLite 행과 FastAPI 서버 재시작 후 GET을 확인합니다. 연습 DB는 이번 실행의 서버 재시작 동안 유지되고 전체 실행 종료 후 삭제됩니다."},
    "M10": {"language": "jsx", "filename": "App.jsx", "starter": INTEGRATED_REACT_STARTER,
            "transfer_starter": INVENTORY_REACT_STARTER,
            "starter_files": {"api_source": SQLITE_API_STARTER, "transfer_api_source": INVENTORY_API_STARTER},
            "scope": "실제 React 18 Test Renderer → 제한된 fetch 연결 → 별도 FastAPI → 실제 SQLite → GET → React 목록을 관찰합니다. 실제 브라우저 DOM·CORS 검사는 아니며 화면 재진입은 컴포넌트 재마운트입니다. 두 파일은 함께 실행되고 연습 DB는 전체 실행 종료 후 삭제됩니다."},
}
CONTRACTS["M11"] = {
    "language": "jsx", "filename": "App.jsx", "starter": INTEGRATED_REACT_STARTER,
    "starter_files": {"api_source": SQLITE_API_STARTER, "baseline_source": INTEGRATED_REACT_STARTER, "baseline_api_source": SQLITE_API_STARTER},
    "scope": CONTRACTS["M10"]["scope"] + " 실패 재현본의 실제 CODE_ERROR 또는 실패 항목과, 코드가 다른 수정본의 통과 결과를 함께 확인합니다. 인프라 장애나 자원 한도는 재현 성공으로 세지 않습니다. 서술은 작성 여부만 확인합니다.",
}


def independent_starters(table: str, column: str, maximum: int) -> tuple[str, str]:
    frontend = '''function App() {
  const [value, setValue] = React.useState("");
  const [rows, setRows] = React.useState([]);
  const [error, setError] = React.useState("");
  // 직접 구현: 최초 GET, 입력 검사, POST, 성공 후 GET으로 rows 갱신.
  // 실패 시 입력 보존과 오류 표시, 성공 시 입력/오류 초기화.
  async function handleSubmit(event) {
    event.preventDefault();
  }
  return <form onSubmit={handleSubmit}>
    <input name="COLUMN" value={value} onChange={event => setValue(event.target.value)} />
    <p role="alert">{error}</p>
    <button type="submit">저장</button>
    <ul>{rows.map(row => <li key={row.id}>{row.COLUMN}</li>)}</ul>
  </form>;
}'''.replace("COLUMN", column)
    api = f'''from fastapi import FastAPI
import sqlite3

app = FastAPI()
DB_PATH = "/data/learning.db"
# 직접 구현: {table}(id INTEGER PRIMARY KEY, {column} TEXT NOT NULL).
# GET /api/{table}: id와 {column}을 가진 객체 배열을 반환합니다.
# POST /api/{table}: JSON의 {column}을 문자열·trim·1~{maximum}자로 검증합니다.
# 성공은 201과 저장 객체, 유효하지 않은 입력은 422입니다.
# 매개변수 INSERT와 commit 후 GET, 서버 재시작 후에도 같은 파일을 읽습니다.
'''
    return frontend, api


NOTES_REACT_STARTER, NOTES_API_STARTER = independent_starters("notes", "text", 200)
TASKS_REACT_STARTER, TASKS_API_STARTER = independent_starters("tasks", "label", 120)
CONTRACTS["M12"] = {
    "language": "jsx", "filename": "App.jsx", "starter": NOTES_REACT_STARTER,
    "transfer_starter": TASKS_REACT_STARTER,
    "starter_files": {"api_source": NOTES_API_STARTER, "transfer_api_source": TASKS_API_STARTER},
    "scope": CONTRACTS["M10"]["scope"] + " 메모장과 할 일 목록은 정해진 경로·필드 계약에 맞춰 직접 구현합니다. 요구사항과 설명의 의미·독창성을 자동 판정한 결과는 아닙니다.",
}
CHECK_IDS = {node: [f"WEB-{node}-T{index}" for index in range(1, count + 1)] for node, count in [("M05", 8), ("M06", 4), ("M07", 9), ("M08", 5), ("M09", 12), ("M10", 14), ("M11", 14), ("M12", 14)]}
