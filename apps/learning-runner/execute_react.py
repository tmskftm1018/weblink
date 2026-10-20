"""Compile JSX without executing it; run actual React hooks inside QuickJS."""

import json
import resource
import subprocess
import sys
from pathlib import Path

import quickjs

resource.setrlimit(resource.RLIMIT_CPU, (3, 3))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

try:
    request = json.loads(sys.stdin.read(140000))
    variant = request.get("variant", "board")
    compiled = subprocess.run(
        ["/usr/local/bin/esbuild", "--loader=jsx", "--jsx=transform", "--jsx-factory=React.createElement", "--jsx-fragment=React.Fragment", "--log-level=error"],
        input=request["source"], text=True, capture_output=True, timeout=2, check=False,
    )
    if compiled.returncode:
        result = {"status": "CODE_ERROR", "error": compiled.stderr[:700], "checks": [], "cases": []}
    else:
        resource.setrlimit(resource.RLIMIT_AS, (220 * 1024 * 1024, 220 * 1024 * 1024))
        context = quickjs.Context()
        context.set_memory_limit(64 * 1024 * 1024)
        context.set_max_stack_size(512 * 1024)
        context.set_time_limit(0.6)
        # Scheduling callbacks are bounded by the outer process. Only synchronous
        # React state exercises are supported; no host timers or I/O are exposed.
        context.eval("globalThis.console = Object.freeze({log(){},warn(){},error(){}});globalThis.setTimeout=()=>0;globalThis.clearTimeout=()=>{};")
        library = Path("/app/react-bundle.js").read_text()
        harness = Path("/app/react-harness.js").read_text().replace("VARIANT", json.dumps(variant))
        run = context.eval("(() => {" + library + "\nreturn " + harness + ";})()")
        component = context.eval(compiled.stdout + "\nApp;")
        observed = json.loads(run(component))
        empty, spaces, first, second = observed["cases"]
        definitions = [
            ("처음 목록 비어 있음", observed["initial"] == [], "처음 목록 state는 빈 배열로 시작하세요."),
            ("폼 기본 제출 중단", all(row["prevented"] for row in observed["cases"]), "onSubmit에서 preventDefault를 호출하세요."),
            ("빈 값과 공백 거부", empty["items"] == [] and spaces["items"] == [], "빈 값과 공백만 있는 입력은 목록에 추가하지 마세요."),
            ("정리한 첫 항목", first["items"] == ["첫 항목"], "trim한 제목을 li에 표시하세요."),
            ("두 항목 순서 유지", second["items"] == ["첫 항목", "둘째 항목"], "이전 목록을 보존하면서 새 항목을 추가하세요."),
            ("실패 시 입력 유지", spaces["value"] == "   ", "실패한 입력은 그대로 남겨 두세요."),
            ("오류 안내와 초기화", bool(empty["error"].strip()) and bool(spaces["error"].strip()) and not first["error"].strip(), "실패 안내를 role=alert에 표시하고 성공 시 지우세요."),
            ("재시작 시 메모리 초기화", observed["restarted"] == [], "새 컴포넌트 실행은 빈 목록으로 시작합니다. 실제 영속 저장은 다음 단계에서 배워요."),
        ]
        prefix = "WEB-M05-X1" if variant == "books" else "WEB-M05"
        result = {"status": "COMPLETED", **observed, "checks": [{"id": f"{prefix}-T{index}", "label": label, "passed": bool(passed), "message": "React 상태 변화 확인 완료" if passed else hint} for index, (label, passed, hint) in enumerate(definitions, 1)]}
except quickjs.JSException as exc:
    reason = str(exc)[:700]
    result = {"status": "LIMIT_EXCEEDED" if "interrupted" in reason or "memory" in reason else "CODE_ERROR", "error": reason, "checks": [], "cases": []}
except subprocess.TimeoutExpired:
    result = {"status": "LIMIT_EXCEEDED", "error": "JSX 변환 시간 제한을 넘었습니다.", "checks": [], "cases": []}
except (ValueError, OSError, KeyError, TypeError, MemoryError, RuntimeError):
    result = {"status": "UNAVAILABLE", "error": "React 실행 결과를 만들지 못했습니다.", "checks": [], "cases": []}
print(json.dumps(result, ensure_ascii=False))
