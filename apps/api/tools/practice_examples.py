"""Reference artifacts for localhost course verification, never assessment receipts."""

HTML = '<form><label for="title">제목</label><input id="title" name="title"><label for="content">내용</label><textarea id="content" name="content"></textarea><button type="submit">등록</button></form>'
JAVASCRIPT = '''const form = document.querySelector("#post-form");
const titleInput = document.querySelector("#title");
const contentInput = document.querySelector("#content");
const errorMessage = document.querySelector("#error");
form.addEventListener("submit", event => {
  event.preventDefault();
  const title = titleInput.value.trim();
  if (!title) { errorMessage.textContent = "제목을 입력하세요."; return; }
  errorMessage.textContent = "";
  savePost({title, content: contentInput.value});
});'''
SQLITE = '''import sqlite3
with sqlite3.connect("/data/learning.db") as connection:
    connection.execute("CREATE TABLE IF NOT EXISTS posts(id INTEGER PRIMARY KEY, title TEXT NOT NULL)")
    for title in ["첫 SQLite 게시글", "'; DROP TABLE posts; --"]:
        connection.execute("INSERT INTO posts(title) VALUES (?)", (title,))
    connection.commit()
    print(connection.execute("SELECT id, title FROM posts ORDER BY id").fetchall())
'''


def api(table="posts", column="title", maximum=80, *, database=True, content=True):
    assert (table, column, maximum) in {("posts", "title", 80), ("registrations", "name", 40), ("items", "name", 40), ("notes", "text", 200), ("tasks", "label", 120)}
    source = f'''from fastapi import FastAPI
from pydantic import BaseModel, field_validator
import sqlite3

app = FastAPI()
class Payload(BaseModel):
    {column}: str
'''
    if content:
        source += '    content: str = ""\n'
    source += f'''
    @field_validator("{column}", mode="before")
    @classmethod
    def validate_value(cls, value):
        if not isinstance(value, str):
            raise ValueError("문자열이 필요합니다.")
        value = value.strip()
        if not 1 <= len(value) <= {maximum}:
            raise ValueError("길이가 올바르지 않습니다.")
        return value
'''
    if database:
        columns = f"{column}, content" if content else column
        source += f'''
DB_PATH = "/data/learning.db"
with sqlite3.connect(DB_PATH) as connection:
    connection.execute("CREATE TABLE IF NOT EXISTS {table}(id INTEGER PRIMARY KEY, {column} TEXT NOT NULL{', content TEXT NOT NULL' if content else ''})")

@app.get("/api/{table}")
def list_rows():
    with sqlite3.connect(DB_PATH) as connection:
        connection.row_factory = sqlite3.Row
        return [dict(row) for row in connection.execute("SELECT id, {columns} FROM {table} ORDER BY id")]

@app.post("/api/{table}", status_code=201)
def create_row(payload: Payload):
    with sqlite3.connect(DB_PATH) as connection:
        cursor = connection.execute("INSERT INTO {table}({columns}) VALUES ({'?, ?' if content else '?'})", (payload.{column}, payload.content) if {content!r} else (payload.{column},))
        connection.commit()
        return {{"id": cursor.lastrowid, **payload.model_dump()}}
'''
    else:
        source += f'''
rows = []
@app.get("/api/{table}")
def list_rows():
    return rows
@app.post("/api/{table}", status_code=201)
def create_row(payload: Payload):
    row = {{"id": len(rows) + 1, **payload.model_dump()}}
    rows.append(row)
    return row
'''
    return source


def react(table="posts", column="title", maximum=80, *, connected=True, content=True):
    load = f'''function load() {{
    return fetch("/api/{table}").then(response => {{
      if (!response.ok) throw new Error("조회 실패");
      return response.json();
    }}).then(setRows);
  }}
  React.useEffect(() => {{ load().catch(() => setError("조회 실패")); }}, []);''' if connected else ""
    store = f'''const response = await fetch("/api/{table}", {{
      method: "POST", headers: {{"Content-Type": "application/json"}},
      body: JSON.stringify({{{column}: cleaned{', content: ""' if content else ''}}})
    }});
    if (!response.ok) {{ setError("저장 실패"); return; }}
    await load();''' if connected else "setRows([...rows, cleaned]);"
    displayed = f"row.{column}" if connected else "row"
    return f'''function App() {{
  const [value, setValue] = React.useState("");
  const [rows, setRows] = React.useState([]);
  const [error, setError] = React.useState("");
  {load}
  async function handleSubmit(event) {{
    event.preventDefault();
    const cleaned = value.trim();
    if (!cleaned || cleaned.length > {maximum}) {{ setError("입력을 확인하세요."); return; }}
    setError("");
    {store}
    setValue("");
  }}
  return <form onSubmit={{handleSubmit}}>
    <input name="{column}" value={{value}} onChange={{event => setValue(event.target.value)}} />
    <p role="alert">{{error}}</p><button type="submit">등록</button>
    <ul>{{rows.map((row, index) => <li key={{index}}>{{{displayed}}}</li>)}}</ul>
  </form>;
}}'''


def artifacts(node_id):
    board_api = api()
    board_ui = react()
    return {
        "M03": {"source": HTML}, "M04": {"source": JAVASCRIPT},
        "M05": {"source": react(connected=False), "transfer_source": react("books", "book", connected=False)},
        "M06": {"source": 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/api/posts")\ndef rows():\n    return []\n'},
        "M07": {"source": api(database=False), "transfer_source": api("registrations", "name", 40, database=False, content=False)},
        "M08": {"source": SQLITE}, "M09": {"source": board_api},
        "M10": {"source": board_ui, "api_source": board_api, "transfer_source": react("items", "name", 40), "transfer_api_source": api("items", "name", 40)},
        "M11": {"source": board_ui, "api_source": board_api, "baseline_source": board_ui.replace('await load();', '// 의도적으로 목록 재조회를 누락'), "baseline_api_source": board_api,
                  "reproduction": "등록 후 DB에는 행이 생기지만 화면 목록이 갱신되지 않습니다. 등록 후 조회 요청과 화면의 목록을 비교합니다."},
        "M12": {"source": react("notes", "text", 200, content=False), "api_source": api("notes", "text", 200, content=False),
                  "transfer_source": react("tasks", "label", 120, content=False), "transfer_api_source": api("tasks", "label", 120, content=False),
                  "architecture_explanation": "화면은 입력을 받아 API로 보내고 응답을 표시합니다. API는 공백과 길이를 검사하고 SQLite에 저장합니다. GET 결과와 재시작 후 DB 행으로 저장을 확인했습니다."},
    }.get(node_id, {})
