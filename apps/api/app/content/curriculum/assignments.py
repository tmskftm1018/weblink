"""Versioned learning scopes. Existing saved work retains its original rubric."""

from copy import deepcopy

VERSION = "practice-v2"
LEVEL_TITLES = {"BEGINNER": "입문 · 안내 따라 구현", "PRACTICED": "기본 · 연결 완성", "EXPERIENCED": "경험자 · 직접 설계"}
TRANSFER_MISSIONS = {"M05", "M07", "M10", "M12"}
TRANSFER_TRY = "전이 과제도 도전하기"
TRANSFER_LATER = "본 과제부터 마치기"


def presentation(node: dict, assignment: dict | None) -> dict:
    """Versioned instructions only; never alter the manifest used for grading."""
    if not assignment or assignment.get("version") != VERSION:
        return node
    result = deepcopy(node)
    if node["id"] == "M01":
        result["student_task"] = "만들어 볼 게시판·경험·도움 방식을 선택하세요. 진단과 개념 답을 고르고 초안을 저장한 뒤, 저장본을 다시 열어 선택이 남는지 확인하세요. 마지막으로 실습 확인 버튼을 누릅니다."
        result["hints"].update({"H1": "게시판 목표·현재 경험·도움 방식을 보기에서 고르세요. 선택 메모는 비워 두어도 됩니다.",
                                "H4": "개념 답까지 선택하고 초안 저장 → 저장본 다시 열기 → 저장하고 실습 확인하기 순서로 진행하세요."})
    elif node["id"] == "M02":
        result["objective"] = "게시글을 등록하고 조회할 때 화면·API·DB가 맡는 역할을 구분합니다."
        result["student_task"] = "아래에서 화면·API·DB의 역할과 개념 답을 선택하세요. 긴 요구사항이나 수용 조건을 따로 작성하지 않아도 됩니다. 선택한 답을 저장하고 실습을 확인하세요."
        result["micro_practice"]["task"] = "글 등록과 목록 조회에서 화면·API·DB가 맡는 역할을 선택하세요."
        result["hints"].update({
            "H1": "화면은 사용자의 입력을 받고 결과를 보여 줍니다. DB에 바로 접근하는 역할은 아니에요.",
            "H2": "API는 화면의 요청을 검사하고 DB에 저장·조회 작업을 전달합니다. DB는 데이터를 보관합니다.",
            "H3": "화면: 입력·결과 표시 / API: 요청 검사·DB 통신 / DB: 저장·조회. 각 역할과 일치하는 보기를 고르세요.",
        })
        result["recovery"] = "입력과 결과 표시, 요청 검사, 저장과 조회 중 어느 역할인지 비교하고 해당 보기를 다시 선택하세요."
    elif node["id"] == "M11":
        result["student_task"] = "M10에서 이어진 실패 재현본에서 등록 후 GET이나 목록 갱신을 빼는 등 기능 오류를 재현하세요. 입력·절차·실제 오류를 짧게 적고, 별도 수정본을 고쳐 실행하세요. 원인 가설과 추가 관찰 메모는 선택입니다. 실행기 장애나 시간 초과는 기능 오류 재현으로 인정하지 않습니다."
    elif node["id"] == "M12":
        result["student_task"] = node["student_task"].replace(
            "요구사항 두 개와 UI/API/DB 책임을 설명한 뒤 할 일 목록 전이도 구현하세요.",
            "할 일 목록도 별도 과제로 구현하고 두 앱을 실행하세요. UI·API·DB가 맡은 역할과 실제 실행에서 확인한 사례를 짧게 설명하세요. 요구사항 메모는 선택입니다.",
        )
        result["hints"].update({"H1": "메모장과 할 일 앱에서 입력 필드·API 경로·DB 테이블이 어떻게 달라지는지 비교하세요.",
                                "H4": "두 앱의 GET·POST 201·DB 저장·목록 표시·빈 값과 길이 초과·재시작 복원을 확인하세요. UI·API·DB 역할과 실행 사례 설명은 필수이며, 요구사항 메모는 선택입니다."})
    return result


def new_assignment(node_id: str, level: str, path_version: int) -> dict | None:
    if node_id not in {f"M{number:02d}" for number in range(1, 13)}:
        return None
    required = node_id == "M12" or level == "EXPERIENCED" or (level == "PRACTICED" and node_id == "M10")
    return {"version": VERSION, "level": level, "key": f"{VERSION}:{level}:{path_version}",
            "transfer_required": node_id in TRANSFER_MISSIONS and required}


def describe(assignment: dict | None, node_id: str, *, pinned: bool) -> dict:
    if not assignment:
        common = node_id not in {f"M{number:02d}" for number in range(3, 13)}
        return {"key": "legacy", "version": "legacy", "level": None, "title": "공통 준비 미션" if common else "기존 과제 기준",
                "pinned": pinned, "has_transfer": node_id in TRANSFER_MISSIONS,
                "transfer_required": node_id in TRANSFER_MISSIONS,
                "summary": "목표·요구사항·기초 개념은 모든 경로에서 함께 확인해요." if common else "이전에 저장한 코드와 제출 기준을 그대로 사용합니다.", "steps": []}
    level = assignment["level"]
    if node_id in {"M01", "M02"}:
        return {**assignment, "title": "공통 준비 미션", "pinned": pinned,
                "has_transfer": False, "summary": "목표와 경험을 선택하고 화면·API·DB의 역할을 구분해요. 모든 난이도에서 함께 준비합니다.", "steps": []}
    summary = {
        "BEGINNER": "준비된 화면과 단계별 코드에서 연결할 부분을 완성합니다. M12에서는 두 앱을 직접 연결합니다.",
        "PRACTICED": "기본 뼈대에서 기능을 구현합니다. M10·M12의 다른 문제 적용은 필수입니다.",
        "EXPERIENCED": "최소 실행 계약에서 직접 구현합니다. M05·M07·M10·M12의 다른 문제 적용은 모두 필수입니다.",
    }[level]
    return {**assignment, "title": LEVEL_TITLES[level], "pinned": pinned,
            "has_transfer": node_id in TRANSFER_MISSIONS, "summary": summary,
            "steps": GUIDED_STEPS.get(node_id, []) if level == "BEGINNER" and assignment["version"] != VERSION else []}


def transfer_enabled(assignment: dict | None, answers: dict, node_id: str) -> bool:
    if node_id not in TRANSFER_MISSIONS:
        return False
    return not assignment or assignment["transfer_required"] or answers.get("transfer_mode") == TRANSFER_TRY


def fields_for_assignment(fields: list[dict], assignment: dict | None, node_id: str) -> list[dict]:
    fields = deepcopy(fields)
    if assignment and assignment["version"] == VERSION:
        for field in fields:
            if field["kind"] == "text" and (node_id, field["id"]) not in {("M11", "reproduction"), ("M12", "architecture_explanation")}:
                field.update(optional=True, practice_note=True)
            if (node_id, field["id"]) == ("M11", "reproduction"):
                field["placeholder"] = "어떤 값을 입력하고 어떤 버튼을 눌렀나요? 기대한 결과와 실제 결과의 차이를 짧게 적어 주세요."
            elif (node_id, field["id"]) == ("M12", "architecture_explanation"):
                field["placeholder"] = "화면은 무엇을 보내고, API는 무엇을 확인하며, DB는 무엇을 저장했나요? 실행 결과에서 확인한 사례 하나를 덧붙여 주세요."
        if node_id == "M01":
            fields.insert(0, {"id": "project_goal", "label": "먼저 만들어 볼 게시판", "kind": "choice", "choices": [
                "학급 소식을 공유하는 게시판", "공부한 내용을 기록하는 게시판", "팀의 진행 상황을 나누는 게시판",
            ]})
    if assignment and node_id in TRANSFER_MISSIONS and not assignment["transfer_required"]:
        index = next(i for i, field in enumerate(fields) if field["id"].startswith("transfer_"))
        fields.insert(index, {"id": "transfer_mode", "label": "다른 문제에도 적용해 볼까요?", "kind": "choice",
                              "choices": [TRANSFER_LATER, TRANSFER_TRY]})
        for field in fields:
            if field["id"].startswith("transfer_") and field["id"] != "transfer_mode":
                field["optional"] = True
    return fields


def required_fields(fields: list[dict], assignment: dict | None, answers: dict, node_id: str) -> list[dict]:
    return [field for field in fields if not field.get("practice_note") and (
        not field.get("optional") or (field["id"].startswith("transfer_") and transfer_enabled(assignment, answers, node_id)))]


GUIDED_STEPS = {
    "M03": ["제목의 label·input 연결을 먼저 읽어 보세요.", "내용의 for와 id를 맞추고 제출 버튼의 type을 바꾸세요.", "미리보기에서 제목·내용 label을 클릭한 뒤 구조 검사를 확인하세요."],
    "M04": ["제출 방지와 공백 제거가 준비되어 있어요.", "정상 입력에서 오류를 지우고 savePost에 제목과 본문을 전달하세요.", "빈 값·공백·정상 값의 저장 호출을 비교하세요."],
    "M05": ["빈 제목을 막는 조건은 준비되어 있어요.", "새 배열로 게시글을 추가하고 입력을 초기화하세요.", "빈 입력과 연속 두 번 등록을 실행해서 목록을 확인하세요."],
    "M06": ["/api/posts가 받는 GET 요청과 posts 목록을 찾아보세요.", "함수의 반환값을 객체에서 posts 목록으로 바꾸세요.", "상태 코드와 JSON 배열 응답을 확인하세요."],
    "M07": ["검증 함수가 받는 value의 형식을 확인하세요.", "문자열 여부·공백 제거·1~80자 길이 조건을 완성하세요.", "거부한 입력이 목록에 들어가지 않았는지 확인하세요."],
    "M08": ["테이블 준비와 읽기 코드는 제공되어 있어요.", "반복문에서 ? 매개변수로 두 제목을 저장하고 commit하세요.", "따옴표가 포함된 제목도 데이터로 남는지 확인하세요."],
    "M09": ["테이블을 지우지 않고 여는 초기화를 먼저 읽으세요.", "GET의 행 변환과 POST의 매개변수 INSERT를 완성하세요.", "서버 재시작 뒤에도 같은 행이 조회되는지 확인하세요."],
    "M10": ["M09에 저장한 API가 있다면 그대로 이어 사용해요.", "준비된 GET 함수와 POST 제출 처리 사이를 연결하세요.", "저장·재조회·실패 시 입력 보존을 차례로 확인하세요."],
    "M11": ["M10 코드에서 실패하는 입력을 골라 재현본에 남기세요.", "예상한 원인 부분을 찾아 수정본만 바꾸세요. 가설 메모는 선택입니다.", "실패 재현본과 수정본의 실행 항목을 비교하세요."],
    "M12": ["메모와 할 일의 API 경로·입력 필드를 비교하세요.", "요구사항을 정하고 화면·API·DB를 각각 구현하세요.", "두 앱의 저장·복원 결과를 확인하고 역할을 설명하세요."],
}


def starters(node_id: str, level: str, source: str | None, transfer: str | None, files: dict) -> tuple:
    """Change supplied code, never a learner's saved answers or predecessor code."""
    files = dict(files)
    if level == "PRACTICED" or node_id in {"M01", "M02", "M11"} or node_id.startswith("C"):
        return source, transfer, files
    if level == "EXPERIENCED":
        source = MINIMAL.get(node_id, source)
        if node_id in {"M10", "M12"}:
            # Preserve M09's saved API when M10 continues it.
            if node_id == "M12":
                files["api_source"] = minimal_api("notes", "text", 200)
            files["transfer_api_source"] = minimal_api("items" if node_id == "M10" else "tasks", "name" if node_id == "M10" else "label", 40 if node_id == "M10" else 120, content=node_id == "M10")
        if transfer:
            transfer = minimal_react("book" if node_id == "M05" else "name" if node_id == "M10" else "label", connected=node_id != "M05") if node_id != "M07" else minimal_api("registrations", "name", 40, database=False)
        return source, transfer, files
    if node_id == "M03":
        source = source.replace('<label>제목</label>\n  <input type="text">', '<label for="title">제목</label>\n  <input id="title" name="title" type="text">')
    elif node_id == "M04":
        source = '''const form = document.querySelector("#post-form");
const titleInput = document.querySelector("#title");
const contentInput = document.querySelector("#content");
const errorMessage = document.querySelector("#error");
form.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = titleInput.value.trim();
  if (!title) {
    errorMessage.textContent = "제목을 입력해 주세요.";
    return;
  }
  // TODO: 이전 오류를 지우고 savePost({ title, content: ... })를 호출하세요.
});'''
    elif node_id == "M05":
        source = source.replace('// trim한 제목이 비면 오류 안내 후 return 하세요.', '''const cleaned = title.trim();
    if (!cleaned) { setError("제목을 입력해 주세요."); return; }
    setError("");''')
    elif node_id == "M07":
        source = source.replace('        return value', '''        if not isinstance(value, str):
            raise ValueError("제목은 문자열이어야 합니다.")
        cleaned = value.strip()
        # TODO: 1~80자 조건을 검사한 뒤 cleaned를 반환하세요.
        return value''')
    elif node_id == "M08":
        source = '''import sqlite3

titles = ["첫 SQLite 게시글", "'; DROP TABLE posts; --"]
with sqlite3.connect("/data/learning.db") as connection:
    connection.execute("CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL)")
    for title in titles:
        # TODO: connection.execute에 INSERT 문과 (title,) 값을 전달하세요.
        pass
    # TODO: 저장을 확정하세요.
    rows = connection.execute("SELECT id, title FROM posts ORDER BY id").fetchall()
    print(rows)
'''
    elif node_id == "M09":
        source = source.replace('# posts(id INTEGER PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL)를\n# CREATE TABLE IF NOT EXISTS로 준비하세요. 시작할 때 기존 행을 지우지 마세요.', '''with sqlite3.connect(DB_PATH) as connection:
    connection.execute("CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL)")
# 기존 행을 지우지 말고 GET/POST 함수를 완성하세요.''')
    elif node_id == "M10":
        source = source.replace('// GET /api/posts → response.json() → setPosts로 연결하세요.\n    // response.ok가 false이면 Error를 throw하세요.', '''const response = await fetch("/api/posts");
    if (!response.ok) throw new Error("목록 조회 실패");
    setPosts(await response.json());''')
    return source, transfer, files


def minimal_react(name: str, *, connected: bool = True) -> str:
    return f'''function App() {{
  // 직접 구성: name="{name}"인 제어 입력, form의 onSubmit, role="alert", li 목록.
  // {"React.useState/useEffect와 fetch로 API에 연결하세요." if connected else "React.useState와 새 배열로 목록을 갱신하세요. API 요청은 사용하지 않습니다."}
  // import/export는 넣지 마세요.
  return <form><input name="{name}" /><p role="alert"></p><button type="submit">저장</button><ul></ul></form>;
}}'''


def minimal_api(table: str, column: str, maximum: int, *, database: bool = True, content: bool = False) -> str:
    return f'''from fastapi import FastAPI
{"import sqlite3" if database else ""}

app = FastAPI()
{"DB_PATH = '/data/learning.db'" if database else ""}
# GET /api/{table}: id, {column}{", content" if content else ""} 객체의 배열을 반환.
# POST /api/{table}: {column}은 문자열·trim·1~{maximum}자. 정상 201, 잘못된 입력 422.
{chr(35) + " content는 선택 문자열이며 기본값은 빈 문자열입니다." if content else ""}
# {"같은 DB의 " + table + " 테이블에 매개변수로 저장하고 재시작 후에도 조회." if database else "이번 실행의 메모리 목록에 정상 요청만 저장."}
{chr(35) + " 테이블: " + table + "(id INTEGER PRIMARY KEY, " + column + " TEXT NOT NULL" + (", content TEXT NOT NULL" if content else "") + ")." if database else ""}
'''


MINIMAL = {
    "M03": '<form>\n  <!-- 제목(title)과 내용(content), label 연결, 제출 버튼을 직접 구성하세요. -->\n</form>',
    "M04": '// #post-form 제출을 처리하세요. #title, #content, #error를 사용합니다.\n// 공백 제거, 빈 제목 거부, 실패 시 입력 보존, 정상 savePost({title, content}) 호출.\n',
    "M05": minimal_react("title", connected=False),
    "M06": 'from fastapi import FastAPI\n\napp = FastAPI()\nposts = []\n# GET /api/posts에서 posts 배열을 반환하세요.\n',
    "M07": minimal_api("posts", "title", 80, database=False, content=True),
    "M08": 'import sqlite3\n\nDB_PATH = "/data/learning.db"\ntitles = ["첫 SQLite 게시글", "\'; DROP TABLE posts; --"]\n# posts(id INTEGER PRIMARY KEY, title TEXT NOT NULL)를 준비하세요.\n# ? 매개변수 INSERT, commit, id 순서 SELECT로 두 제목을 저장·조회하세요.\n',
    "M09": minimal_api("posts", "title", 80, content=True),
    "M10": minimal_react("title"),
    "M12": minimal_react("text"),
}
