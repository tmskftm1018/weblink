"""React in a bounded VM; only allowlisted real HTTP is performed outside it."""

import json
import resource
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

import quickjs

resource.setrlimit(resource.RLIMIT_CPU, (8, 8))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
transfer = sys.argv[1] == "transfer_source"
host, phase, marker = sys.argv[2:5]
mission = sys.argv[5] if len(sys.argv) > 5 else "M10"
table, column, maximum = ("items", "name", 40) if transfer else ("posts", "title", 80)
route = f"/api/{table}"
if mission == "M12":
    table, column, maximum = ("tasks", "label", 120) if transfer else ("notes", "text", 200)
    route = f"/api/{table}"
prefix = f"WEB-{mission}-X1" if transfer else f"WEB-{mission}"
opener = build_opener(ProxyHandler({}))
requests = []


def request(method, payload=None):
    if len(requests) >= 24:
        raise ValueError("HTTP 요청 한도(24회)를 넘었습니다.")
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode()
    if data and len(data) > 16000:
        raise ValueError("요청 본문이 너무 큽니다.")
    req = Request(f"http://{host}:8000{route}", data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        response = opener.open(req, timeout=1)
    except HTTPError as exc:
        response = exc
    with response:
        raw = response.read(32769)
        if len(raw) > 32768:
            raise ValueError("응답 크기 한도를 넘었습니다.")
        body = json.loads(raw)
        row = {"method": method, "path": route, "payload": payload, "status": response.status, "body": body}
        requests.append(row)
        return row


def rows():
    with sqlite3.connect("file:/data/learning.db?mode=ro&immutable=1", uri=True, timeout=1) as connection:
        connection.execute("PRAGMA query_only=ON")
        # Both identifiers are selected from constants above, never learner input.
        return connection.execute(f"SELECT id, {column} FROM {table} ORDER BY id LIMIT 100").fetchall()


def checks(definitions, start=1):
    return [{"id": f"{prefix}-T{index}", "label": label, "passed": bool(passed), "message": hint}
            for index, (label, passed, hint) in enumerate(definitions, start)]


try:
    for attempt in range(24):
        try:
            ready = request("GET")
            break
        except (URLError, TimeoutError, OSError):
            if attempt == 23:
                raise ValueError("학습 API 서버를 열지 못했습니다. main.py의 app과 경로를 확인하세요.") from None
            time.sleep(0.15)
    if phase == "after":
        stored = rows()
        body = ready["body"]
        result = {"status": "COMPLETED", "requests": requests, "database_rows": stored, "checks": checks([
            ("서버 재시작 후 GET", ready["status"] == 200 and isinstance(body, list) and any(isinstance(item, dict) and item.get(column) == marker for item in body), "재시작 후에도 저장한 값을 GET으로 읽어야 합니다."),
            ("서버 재시작 후 DB 행", any(row[1] == marker for row in stored), "시작 시 DB를 초기화하지 말고 같은 파일에서 읽으세요."),
        ], 13)}
    else:
        source = Path("/workspace/App.jsx").read_text()
        compiled = subprocess.run(["/usr/local/bin/esbuild", "--loader=jsx", "--jsx-factory=React.createElement", "--jsx-fragment=React.Fragment", "--log-level=error"], input=source, text=True, capture_output=True, timeout=2, check=False)
        if compiled.returncode:
            raise ValueError(compiled.stderr[:700])
        resource.setrlimit(resource.RLIMIT_AS, (220 * 1024 * 1024, 220 * 1024 * 1024))
        context = quickjs.Context()
        context.set_memory_limit(64 * 1024 * 1024)
        context.set_max_stack_size(512 * 1024)
        context.set_time_limit(0.2)
        context.eval("globalThis.console=Object.freeze({log(){},warn(){},error(){}});globalThis.setTimeout=()=>0;globalThis.clearTimeout=()=>{};")
        harness = context.eval("(() => {" + Path("/opt/weblink/react-bundle.js").read_text() + "\nreturn " + Path("/opt/weblink/integration-harness.js").read_text() + ";})()")
        # Keep trusted function references outside the learner's global namespace.
        methods = {name: context.eval(f"h => h.{name}")(harness) for name in ["mount", "unmount", "submit", "queue", "deliver", "observe"]}
        app = context.eval(compiled.stdout + "\nApp;")
        budget = [0]

        def flush():
            for _ in range(160):
                budget[0] += 1
                if budget[0] > 800:
                    raise ValueError("비동기 작업 한도를 넘었습니다.")
                pending = json.loads(methods["queue"]())
                for call in pending:
                    if call.get("path") != route or call.get("method") not in {"GET", "POST"}:
                        raise ValueError(f"이 과제에서는 {route}의 GET/POST만 요청할 수 있어요.")
                    payload = json.loads(call["body"]) if call["body"] is not None else None
                    row = request(call["method"], payload)
                    methods["deliver"](json.dumps({"id": call["id"], "status": row["status"], "body": json.dumps(row["body"], ensure_ascii=False)}))
                if not context.execute_pending_job() and not pending:
                    return
            raise ValueError("Promise 작업이 끝나지 않았습니다.")

        methods["mount"](app)
        flush()
        initial = json.loads(methods["observe"](column))
        initial_requests = list(requests[1:])  # Exclude the observer's readiness GET.
        observed = []
        for value in ["", "   ", f"  {marker}  ", "둘째 항목", "가" * (maximum + 1)]:
            request_start = len(requests)
            methods["submit"](value, column)
            flush()
            observed.append({"input": value, "requests": requests[request_start:], **json.loads(methods["observe"](column))})
        stored = rows()
        methods["unmount"]()
        methods["mount"](app)
        flush()
        remounted = json.loads(methods["observe"](column))
        methods["unmount"]()
        empty, spaces, first, second, too_long = observed
        posts = [row for row in requests if row["method"] == "POST"]
        titles = [row[1] for row in stored]
        definitions = [
            ("화면 시작 시 실제 GET", any(row["status"] == 200 for row in initial_requests), "useEffect에서 GET으로 목록을 불러오세요."),
            ("폼 기본 제출 중단", all(row["prevented"] for row in observed), "onSubmit에서 preventDefault를 호출하세요."),
            ("정상 입력의 실제 POST 201", any(row["status"] == 201 and isinstance(row["body"], dict) and row["body"].get(column) == marker for row in posts), "입력을 POST로 보내고 서버 성공 응답을 확인하세요."),
            ("SQLite에 같은 두 항목 저장", titles == [marker, "둘째 항목"], "저장 후 실제 DB에 정리한 두 값만 남아야 합니다."),
            ("저장 후 실제 GET", all(any(row["method"] == "GET" and row["status"] == 200 and isinstance(row["body"], list) and [item.get(column) for item in row["body"] if isinstance(item, dict)] == expected for row in case["requests"]) for case, expected in [(first, [marker]), (second, [marker, "둘째 항목"])]), "각 POST 성공 직후 GET으로 서버 목록을 다시 읽으세요."),
            ("GET 결과를 React 목록에 반영", first["items"] == [marker] and second["items"] == titles, "GET 응답으로 목록 state를 갱신하고 li로 표시하세요."),
            ("빈 값·공백에서 입력 유지", empty["items"] == [] and spaces["items"] == [] and spaces["value"] == "   ", "실패한 입력을 지우거나 목록에 추가하지 마세요."),
            ("오류 안내와 성공 시 초기화", bool(spaces["error"].strip()) and not first["error"].strip(), "role=alert로 오류를 알리고 성공 시 지우세요."),
            ("화면 재진입 시 DB 목록 복원", remounted["items"] == titles and len(titles) == 2, "컴포넌트를 다시 열면 GET으로 저장 목록을 복원하세요."),
            ("길이 초과 거부·입력 유지", too_long["items"] == titles and too_long["value"] == "가" * (maximum + 1) and bool(too_long["error"].strip()), "길이 초과는 안내하고 입력을 보존하세요."),
            ("POST 다음 GET 순서", all(any(row["method"] == "POST" and row["status"] == 201 and any(later["method"] == "GET" and later["status"] == 200 for later in case["requests"][index + 1:]) for index, row in enumerate(case["requests"])) for case in [first, second]), "각 제출에서 성공한 POST 다음에 서버 목록을 재조회하세요."),
            ("처음 목록과 성공 후 입력", initial["items"] == [] and first["value"] == "", "최초 빈 목록과 성공 후 입력 초기화를 확인하세요."),
        ]
        result = {"status": "COMPLETED", "checks": checks(definitions), "requests": requests, "database_rows": stored, "cases": [{key: value for key, value in row.items() if key != "tree"} for row in observed], "tree": remounted["tree"]}
except quickjs.JSException as exc:
    reason = str(exc)[:700]
    result = {"status": "LIMIT_EXCEEDED" if "interrupted" in reason or "memory" in reason else "CODE_ERROR", "error": reason, "checks": [], "requests": requests}
except subprocess.TimeoutExpired:
    result = {"status": "LIMIT_EXCEEDED", "error": "JSX 변환 시간이 초과되었습니다.", "checks": [], "requests": requests}
except FileNotFoundError:
    result = {"status": "UNAVAILABLE", "error": "실행에 필요한 파일이나 변환기를 찾지 못했습니다. 저장한 코드는 유지되며 실행 환경 복구가 필요합니다.", "checks": [], "requests": requests}
except (ValueError, TypeError, KeyError, OSError, sqlite3.Error, RuntimeError) as exc:
    result = {"status": "CODE_ERROR", "error": str(exc)[:700], "checks": [], "requests": requests}
print(json.dumps(result, ensure_ascii=False))
