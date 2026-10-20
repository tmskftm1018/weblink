"""Fixed private transport to the constrained JavaScript execution service."""

import json
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener

from app.content.curriculum.course_runtime_contract import CHECK_IDS as COURSE_IDS
from app.content.curriculum.js_form_contract import CHECK_IDS as M04_IDS
from app.core.config import settings


def execute(source: str, node_id: str = "M04", variant: str = "board") -> dict:
    unavailable = {"status": "UNAVAILABLE", "error": "JavaScript 실행기를 사용할 수 없어요. 서버 실행 상태를 확인한 뒤 다시 시도해 주세요.", "cases": [], "checks": []}
    if not settings.learning_runner_url or node_id not in {"M04", "M05"}:
        return unavailable
    try:
        request = Request(
            settings.learning_runner_url.rstrip("/") + ("/m04" if node_id == "M04" else "/m05"),
            data=json.dumps({"source": source, **({"variant": variant} if node_id == "M05" else {})}, ensure_ascii=False).encode(),
            headers={"Content-Type": "application/json"}, method="POST",
        )
        # Do not forward authentication cookies, project files or proxy credentials.
        with build_opener(ProxyHandler({})).open(request, timeout=7) as response:
            raw = response.read(32001)
        if len(raw) > 32000:
            return unavailable
        result = json.loads(raw)
        if not isinstance(result, dict) or result.get("status") not in {"COMPLETED", "CODE_ERROR", "LIMIT_EXCEEDED", "UNAVAILABLE"}:
            return unavailable
        if result["status"] == "COMPLETED":
            checks = result.get("checks")
            expected_ids = M04_IDS if node_id == "M04" else [f"WEB-M05-X1-T{index}" for index in range(1, 9)] if variant == "books" else COURSE_IDS["M05"]
            if not isinstance(checks, list) or [check.get("id") for check in checks if isinstance(check, dict)] != expected_ids:
                return unavailable
            if any(type(check.get("passed")) is not bool for check in checks) or not isinstance(result.get("cases"), list) or len(result["cases"]) != (6 if node_id == "M04" else 4):
                return unavailable
        return result
    except (HTTPError, URLError, TimeoutError, ValueError, OSError):
        return unavailable
