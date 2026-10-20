"""Read actual committed SQLite rows outside the learner process."""

import ast
import json
import sqlite3


def snapshot():
    with sqlite3.connect("file:/data/learning.db?mode=ro&immutable=1", uri=True, timeout=1) as connection:
        connection.execute("PRAGMA query_only=ON")
        return connection.execute("SELECT id, title FROM posts ORDER BY id LIMIT 100").fetchall()


if __name__ == "__main__":
    checks = []
    rows = []
    try:
        rows = snapshot()
        with open("/workspace/main.py", encoding="utf-8") as source:
            tree = ast.parse(source.read())
        inserts = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
                   and isinstance(node.func, ast.Attribute) and node.func.attr in {"execute", "executemany"}
                   and node.args and isinstance(node.args[0], ast.Constant)
                   and isinstance(node.args[0].value, str) and node.args[0].value.lstrip().upper().startswith("INSERT")]
        definitions = [
            ("SQLite 파일과 posts 테이블", True),
            ("등록한 제목 재조회", any(row[1] == "첫 SQLite 게시글" for row in rows)),
            ("SQL 모양의 제목도 데이터로 보관", any(row[1] == "'; DROP TABLE posts; --" for row in rows)),
            ("INSERT 값 매개변수 바인딩", bool(inserts) and all(len(node.args) >= 2 and "?" in node.args[0].value for node in inserts)),
            ("서로 다른 ID", len(rows) >= 2 and len({row[0] for row in rows}) == len(rows)),
        ]
        checks = [{"id": f"WEB-M08-T{index}", "label": label, "passed": bool(passed),
                   "message": "실제 SQLite 파일 및 코드 확인" if passed else "commit, SELECT, ? 매개변수와 기본키를 확인하세요."}
                  for index, (label, passed) in enumerate(definitions, 1)]
        result = {"status": "COMPLETED", "checks": checks, "requests": [], "database_rows": rows}
    except (sqlite3.Error, OSError, SyntaxError, ValueError):
        result = {"status": "CODE_ERROR", "checks": [], "requests": [], "error": "SQLite 파일에서 posts(id, title)를 읽지 못했어요. /data/learning.db 경로와 commit을 확인하세요."}
    print(json.dumps(result, ensure_ascii=False))
