"""Trusted HTTP observer in a different container from the learner's Python."""

import json
import sqlite3
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

sys.path.insert(0, "/opt/weblink")
from check_sqlite import snapshot

mission = sys.argv[1]
transfer = sys.argv[2] == "transfer_source"
server_name = sys.argv[3]
path, field, maximum = ("/api/registrations", "name", 40) if transfer else ("/api/posts", "title", 80)
opener = build_opener(ProxyHandler({}))
observations = []
after_restart = len(sys.argv) > 4 and sys.argv[4] == "after"
stored_title = sys.argv[5] if len(sys.argv) > 5 else "첫 게시글"


def request(method: str, payload=None, route=path) -> dict:
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode()
    req = Request(f"http://{server_name}:8000" + route, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        response = opener.open(req, timeout=1)
    except HTTPError as exc:
        response = exc
    raw = response.read(32769)
    if len(raw) > 32768:
        raise ValueError("응답 크기 제한을 넘었습니다.")
    try:
        body = json.loads(raw)
    except ValueError:
        body = raw.decode("utf-8", "replace")[:500]
    row = {"method": method, "path": route, "payload": payload, "status": response.status, "body": body, "content_type": response.headers.get("Content-Type", "")}
    observations.append(row)
    response.close()
    return row


try:
    ready = False
    for _ in range(24):
        try:
            first = request("GET")
            ready = True
            break
        except (URLError, TimeoutError, OSError):
            time.sleep(0.15)
    if not ready:
        result = {"status": "CODE_ERROR", "error": "FastAPI 서버를 열지 못했어요. app 변수, 들여쓰기, import와 경로를 확인하세요.", "checks": [], "requests": []}
    elif after_restart:
        rows = snapshot()
        body = first["body"]
        result = {"status": "COMPLETED", "requests": observations, "database_rows": rows, "checks": [
            {"id": "WEB-M09-T11", "label": "서버 재시작 후 GET", "passed": first["status"] == 200 and isinstance(body, list) and any(isinstance(item, dict) and item.get("title") == stored_title for item in body), "message": "재시작한 서버에서 같은 제목을 다시 읽어야 합니다."},
            {"id": "WEB-M09-T12", "label": "재시작 후 SQLite 행 유지", "passed": any(row[1] == stored_title for row in rows), "message": "동일 SQLite 파일의 저장 행을 확인합니다."},
        ]}
    else:
        definitions = [
            ("GET 상태 200", first["status"] == 200, "정확한 GET 경로에서 200을 반환하세요."),
            ("JSON 배열", isinstance(first["body"], list), "빈 목록은 []로 반환하세요."),
            ("JSON 응답 형식", "application/json" in first["content_type"], "JSON 응답을 반환하세요."),
        ]
        if mission == "M06":
            again = request("GET")
            definitions.append(("반복 조회", again["status"] == 200 and again["body"] == first["body"], "읽기 요청으로 목록이 달라지지 않도록 하세요."))
        else:
            count_before = len(first["body"]) if isinstance(first["body"], list) else 0
            normal = request("POST", {field: "  첫 신청  " if transfer else f"  {stored_title}  ", **({} if transfer else {"content": "본문"})})
            valid_title = "첫 신청" if transfer else stored_title
            invalid = [request("POST", payload) for payload in [{field: ""}, {field: "   "}, {}, {field: "가" * (maximum + 1)}, {field: 123}]]
            after_invalid = request("GET")
            boundary = request("POST", {field: "가" * maximum})
            final = request("GET")
            definitions.extend([
                ("정상 입력 201", normal["status"] == 201, "유효 입력에 201을 반환하세요."),
                ("정리한 값 반환", isinstance(normal["body"], dict) and normal["body"].get(field) == valid_title, "앞뒤 공백을 제거한 값을 반환하세요."),
                ("잘못된 입력 422", all(row["status"] == 422 for row in invalid), "빈 값·공백·누락·길이 초과·숫자 입력을 저장 전에 거부하세요."),
                ("실패 요청 저장 방지", isinstance(after_invalid["body"], list) and len(after_invalid["body"]) == count_before + 1, "거부한 요청은 목록에 추가하지 마세요."),
                ("최대 길이 경계 허용", boundary["status"] == 201, f"정리한 값은 1~{maximum}자까지 허용하세요."),
                ("저장 후 GET 조회", isinstance(final["body"], list) and len(final["body"]) == count_before + 2 and any(isinstance(item, dict) and item.get(field) == valid_title for item in final["body"]), "저장한 항목을 GET 목록에서 다시 읽을 수 있게 하세요."),
            ])
        prefix = "WEB-M07-X1" if transfer else f"WEB-{mission}"
        result = {"status": "COMPLETED", "requests": observations, "checks": [{"id": f"{prefix}-T{index}", "label": label, "passed": bool(passed), "message": "HTTP 응답 확인 완료" if passed else hint} for index, (label, passed, hint) in enumerate(definitions, 1)]}
        if mission == "M09":
            rows = snapshot()
            result["database_rows"] = rows
            result["checks"].append({"id": "WEB-M09-T10", "label": "POST 제목의 실제 SQLite 저장", "passed": any(row[1] == stored_title for row in rows), "message": "POST 응답뿐 아니라 /data/learning.db의 posts 행을 확인합니다."})
except (URLError, TimeoutError, OSError, ValueError, sqlite3.Error):
    result = {"status": "CODE_ERROR", "error": "요청 처리 도중 서버 응답을 확인하지 못했어요. 반환값과 예외 처리를 확인하세요.", "requests": observations, "checks": []}
print(json.dumps(result, ensure_ascii=False))
