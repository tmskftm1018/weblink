"""Beginner scaffolds: working read/validation paths, explicit unfinished writes."""

REVISION = "guided-20261102"


def react(table: str, column: str, maximum: int, *, content: bool = False) -> str:
    body = f'{{{column}: cleaned' + (', content: ""' if content else '') + '}'
    return f'''function App() {{
  const [value, setValue] = React.useState("");
  const [rows, setRows] = React.useState([]);
  const [error, setError] = React.useState("");

  // 준비됨: 서버 목록 읽기와 화면 갱신.
  async function loadRows() {{
    const response = await fetch("/api/{table}");
    if (!response.ok) throw new Error("목록 조회 실패");
    setRows(await response.json());
  }}
  React.useEffect(() => {{ loadRows().catch(() => setError("조회 실패")); }}, []);

  async function handleSubmit(event) {{
    event.preventDefault();
    const cleaned = value.trim();
    if (!cleaned || cleaned.length > {maximum}) {{ setError("입력을 확인하세요."); return; }}
    setError("");
    try {{
      // TODO: 아래 throw 한 줄을 실제 POST 요청과 응답 확인으로 바꾸세요.
      // URL: /api/{table} · method: POST · Content-Type: application/json
      // body: JSON.stringify({body}) · response.ok가 아니면 throw.
      throw new Error("아직 등록 요청을 연결하지 않았어요.");
      // 준비됨: 등록 성공 뒤 서버 목록을 다시 읽고 입력 비우기.
      await loadRows();
      setValue("");
    }} catch (error) {{
      setError("저장하지 못했어요. 등록 요청과 API 코드를 확인하세요.");
    }}
  }}
  return <form onSubmit={{handleSubmit}}>
    <input name="{column}" value={{value}} onChange={{event => setValue(event.target.value)}} />
    <p role="alert">{{error}}</p><button type="submit">등록</button>
    <ul>{{rows.map(row => <li key={{row.id}}>{{row.{column}}}</li>)}}</ul>
  </form>;
}}'''


def api(table: str, column: str, maximum: int, *, content: bool = False) -> str:
    columns = f"{column}, content" if content else column
    return f'''from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, field_validator
import sqlite3

app = FastAPI()
DB_PATH = "/data/learning.db"

class Payload(BaseModel):
    {column}: str
{('    content: str = ""' + chr(10)) if content else ''}
    @field_validator("{column}", mode="before")
    @classmethod
    def validate_value(cls, value):
        if not isinstance(value, str):
            raise ValueError("문자열이 필요합니다.")
        value = value.strip()
        if not 1 <= len(value) <= {maximum}:
            raise ValueError("길이를 확인하세요.")
        return value

# 준비됨: 테이블이 없을 때만 만들기. 기존 데이터는 지우지 않아요.
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
        # TODO: 아래 raise 한 줄을 매개변수 INSERT, commit, 저장 객체 반환으로 바꾸세요.
        # 테이블: {table} · 저장 열: {columns} · 값은 payload.{column}{', payload.content' if content else ''}.
        # ID는 INSERT 결과의 lastrowid이며, 응답에 id와 {columns}을 넣으세요.
        raise HTTPException(status_code=501, detail="아직 DB 저장을 연결하지 않았어요.")
'''
