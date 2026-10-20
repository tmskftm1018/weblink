"""One bounded process per execution request. This file is not in the main API."""

import json
import resource
import sys
from pathlib import Path

import quickjs

resource.setrlimit(resource.RLIMIT_CPU, (2, 2))
resource.setrlimit(resource.RLIMIT_AS, (160 * 1024 * 1024, 160 * 1024 * 1024))
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
resource.setrlimit(resource.RLIMIT_FSIZE, (0, 0))
resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))

TITLES = ["", "   ", "\t\n", "첫 글", "  hello  ", "  ✨ 게시글  "]


def execute(source: str) -> dict:
    harness = Path("/app/harness.js").read_text(encoding="utf-8")
    cases = []
    for title in TITLES:
        context = quickjs.Context()
        context.set_memory_limit(16 * 1024 * 1024)
        context.set_max_stack_size(256 * 1024)
        context.set_time_limit(0.2)
        dispatch = context.eval(harness.replace("INITIAL_TITLE", json.dumps(title)))
        context.eval(source)
        result = json.loads(dispatch())
        result["title"] = title
        cases.append(result)
    empty, spaces, whitespace, *valid = cases
    rejected = [empty, spaces, whitespace]
    definitions = [
        ("WEB-M04-T1", "기본 제출 중단", all(case["prevented"] for case in cases), "submit 함수에서 event.preventDefault()를 호출하세요."),
        ("WEB-M04-T2", "빈 제목 거부", not empty["calls"], "빈 문자열이면 저장 함수를 호출하지 마세요."),
        ("WEB-M04-T3", "공백 제목 거부", all(not case["calls"] for case in [spaces, whitespace]), "스페이스와 탭/줄바꿈만 있는 입력도 거부하세요."),
        ("WEB-M04-T4", "정상 제목 저장", all(len(case["calls"]) == 1 for case in valid), "유효한 제목마다 savePost를 한 번 호출하세요."),
        ("WEB-M04-T5", "정리한 값 전달", all(len(case["calls"]) == 1 and case["calls"][0]["title"] == case["title"].strip() and case["calls"][0]["content"] == "관찰용 본문" for case in valid), "trim한 제목과 본문을 savePost({ title, content })로 전달하세요."),
        ("WEB-M04-T6", "오류 안내", all(case["error"].strip() and case["error"] != "이전 오류" for case in rejected), "거부할 때 #error.textContent에 구체적인 안내를 넣으세요."),
        ("WEB-M04-T7", "실패 시 입력 보존", all(case["input"] == case["title"] for case in rejected), "거부한 입력을 지우지 말고 사용자가 수정할 수 있게 남겨 두세요."),
        ("WEB-M04-T8", "성공 시 오류 지우기", all(not case["error"].strip() for case in valid), "정상 처리할 때 이전 오류 메시지를 지우세요."),
    ]
    return {"status": "COMPLETED", "cases": cases, "checks": [{"id": key, "label": label, "passed": bool(passed), "message": "실행 결과 확인 완료" if passed else hint} for key, label, passed, hint in definitions]}


try:
    request = json.loads(sys.stdin.read(140000))
    result = execute(request["source"])
except quickjs.JSException as exc:
    text = str(exc)[:700]
    result = {"status": "LIMIT_EXCEEDED" if "interrupted" in text or "memory" in text else "CODE_ERROR", "error": text, "cases": [], "checks": []}
except MemoryError:
    result = {"status": "LIMIT_EXCEEDED", "error": "실행 메모리 한도를 넘었습니다.", "cases": [], "checks": []}
except (ValueError, OSError, TypeError, KeyError, RuntimeError):
    result = {"status": "UNAVAILABLE", "error": "실행 결과를 만들지 못했습니다.", "cases": [], "checks": []}
print(json.dumps(result, ensure_ascii=False))
