"""Private transport only: no credentials, mounts, Docker socket or public port."""

import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(3)

    def reply(self, code: int, result: dict):
        body = json.dumps(result, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self.reply(200 if self.path == "/health" else 404, {"status": "ready"})

    def do_POST(self):
        if self.path not in {"/m04", "/m05"}:
            return self.reply(404, {"status": "UNAVAILABLE"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 140000:
                return self.reply(413, {"status": "UNAVAILABLE"})
            payload = json.loads(self.rfile.read(length))
            allowed = {"source"} if self.path == "/m04" else {"source", "variant"}
            if not isinstance(payload, dict) or set(payload) != allowed or not isinstance(payload["source"], str) or len(payload["source"]) > 32000 or payload.get("variant", "board") not in {"board", "books"}:
                return self.reply(422, {"status": "UNAVAILABLE"})
            completed = subprocess.run(
                [sys.executable, "-I", "/app/execute.py" if self.path == "/m04" else "/app/execute_react.py"],
                input=json.dumps(payload, ensure_ascii=False), text=True, capture_output=True,
                timeout=5 if self.path == "/m05" else 3, env={"PATH": "/usr/local/bin:/usr/bin:/bin", "LANG": "C.UTF-8"}, cwd="/app", check=False,
            )
            if completed.returncode in {-9, -24}:
                result = {"status": "LIMIT_EXCEEDED", "error": "실행 자원 한도를 넘었습니다.", "cases": [], "checks": []}
            elif completed.returncode != 0 or len(completed.stdout) > 32000:
                result = {"status": "UNAVAILABLE", "error": "실행 프로세스가 비정상 종료되었습니다.", "cases": [], "checks": []}
            else:
                result = json.loads(completed.stdout)
            return self.reply(200, result)
        except subprocess.TimeoutExpired:
            return self.reply(200, {"status": "LIMIT_EXCEEDED", "error": "실행 제한 시간(3초)을 넘었습니다.", "cases": [], "checks": []})
        except (ValueError, OSError, TimeoutError):
            return self.reply(503, {"status": "UNAVAILABLE", "error": "실행기를 사용할 수 없습니다.", "cases": [], "checks": []})

    def log_message(self, *_args):
        pass  # Never print learner source, request bodies, or runtime diagnostics.


HTTPServer(("0.0.0.0", 8001), Handler).serve_forever()
