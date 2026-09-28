"""One-run, fixed-data HTTP API used by the API integration lesson."""

import json
import os
import re
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from socketserver import ThreadingMixIn, UnixStreamServer
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit
from urllib.request import Request, urlopen


students = {
    1: {"id": 1, "name": "민지", "score": 95},
    2: {"id": 2, "name": "서준", "score": 88},
    3: {"id": 3, "name": "지우", "score": 91},
}
next_student_id = 4
retry_attempts = 0
google_access_token = ""
google_access_token_expires = 0.0
spreadsheet_id_pattern = re.compile(r"^[A-Za-z0-9_-]{10,200}$")
sheet_range_pattern = re.compile(r"^[\w.'!:$ -]{1,128}$")


def request_google_sheet(spreadsheet_id: str, sheet_range: str) -> tuple[int, dict[str, object]]:
    global google_access_token, google_access_token_expires
    client_id = os.environ.get("WEBLINK_GOOGLE_CLIENT_ID", "")
    client_secret = os.environ.get("WEBLINK_GOOGLE_CLIENT_SECRET", "")
    refresh_token = os.environ.get("WEBLINK_GOOGLE_REFRESH_TOKEN", "")
    if not client_id or not client_secret or not refresh_token:
        return HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Google connection is not available"}
    if not spreadsheet_id_pattern.fullmatch(spreadsheet_id) or not sheet_range_pattern.fullmatch(sheet_range):
        return HTTPStatus.BAD_REQUEST, {"error": "invalid spreadsheet id or cell range"}
    if google_access_token_expires <= time.monotonic():
        form = urlencode({
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }).encode()
        request = Request(
            "https://oauth2.googleapis.com/token",
            data=form,
            headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=5) as response:
                token_payload = json.loads(response.read(65_537))
        except Exception:
            return HTTPStatus.BAD_GATEWAY, {"error": "Could not refresh Google access"}
        access_token = token_payload.get("access_token") if isinstance(token_payload, dict) else None
        if not isinstance(access_token, str) or len(access_token) > 8192:
            return HTTPStatus.UNAUTHORIZED, {"error": "Google connection needs to be reconnected"}
        google_access_token = access_token
        expires_in = token_payload.get("expires_in", 300)
        try:
            expires_in = int(expires_in)
        except (TypeError, ValueError):
            expires_in = 300
        google_access_token_expires = time.monotonic() + max(min(expires_in, 3600) - 30, 30)

    encoded_spreadsheet_id = quote(spreadsheet_id, safe="")
    encoded_range = quote(sheet_range, safe="!:$'")
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{encoded_spreadsheet_id}/values/{encoded_range}?majorDimension=ROWS"
    request = Request(url, headers={"Authorization": f"Bearer {google_access_token}", "Accept": "application/json"})
    try:
        with urlopen(request, timeout=5) as response:
            raw = response.read(1_048_577)
        if len(raw) > 1_048_576:
            return HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "Google response exceeds the size limit"}
        payload = json.loads(raw)
    except Exception as exc:
        status_code = getattr(exc, "code", None)
        if status_code in (400, 401, 403, 404, 429):
            return int(status_code), {"error": "Google Sheets request was rejected"}
        return HTTPStatus.BAD_GATEWAY, {"error": "Google Sheets could not be reached"}
    if not isinstance(payload, dict) or not isinstance(payload.get("values", []), list):
        return HTTPStatus.BAD_GATEWAY, {"error": "Google returned an invalid sheet response"}
    values = payload.get("values", [])
    if len(values) > 10_000 or any(not isinstance(row, list) or len(row) > 256 for row in values):
        return HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "Google response exceeds the row limit"}
    return HTTPStatus.OK, {"range": payload.get("range", sheet_range), "majorDimension": "ROWS", "values": values}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        global retry_attempts
        parsed_path = urlsplit(self.path)
        path_parts = parsed_path.path.split("/")
        if len(path_parts) == 6 and path_parts[1:3] == ["google", "sheets"] and path_parts[4] == "values":
            if parsed_path.query:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "query parameters are not supported"})
                return
            response_status, payload = request_google_sheet(path_parts[3], unquote(path_parts[5]))
            self.send_json(response_status, payload)
            return
        if parsed_path.path == "/students":
            query = parse_qs(parsed_path.query, keep_blank_values=True)
            if set(query) - {"minimum_score", "limit", "offset"} or any(len(values) != 1 for values in query.values()):
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "unsupported query parameters"})
                return
            student_list = list(students.values())
            if "minimum_score" in query:
                try:
                    minimum_score = int(query["minimum_score"][0])
                except ValueError:
                    self.send_json(HTTPStatus.BAD_REQUEST, {"error": "minimum_score must be an integer"})
                    return
                if not 0 <= minimum_score <= 100:
                    self.send_json(HTTPStatus.BAD_REQUEST, {"error": "minimum_score must be between 0 and 100"})
                    return
                student_list = [student for student in student_list if student["score"] >= minimum_score]
            total = len(student_list)
            try:
                limit = int(query.get("limit", [str(max(total, 1))])[0])
                offset = int(query.get("offset", ["0"])[0])
            except ValueError:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "limit and offset must be integers"})
                return
            if not 1 <= limit <= 50 or not 0 <= offset <= 1000:
                self.send_json(HTTPStatus.BAD_REQUEST, {"error": "limit or offset is outside the allowed range"})
                return
            page = student_list[offset : offset + limit]
            self.send_json(HTTPStatus.OK, {
                "students": page,
                "total": total,
                "has_more": offset + len(page) < total,
            })
            return
        if parsed_path.path == "/retry-once":
            retry_attempts += 1
            if retry_attempts <= 2:
                self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "temporary service interruption"})
                return
            self.send_json(HTTPStatus.OK, students[1])
            return
        if parsed_path.path == "/connections/team-calendar":
            self.send_json(HTTPStatus.OK, {
                "name": "team-calendar",
                "provider": "WebLink 일정",
                "status": "connected",
                "scopes": ["events.read"],
            })
            return
        if parsed_path.path == "/connections/team-calendar/events":
            self.send_json(HTTPStatus.OK, {
                "events": [
                    {"id": 101, "title": "팀 회의", "status": "confirmed"},
                    {"id": 102, "title": "점심 약속", "status": "cancelled"},
                    {"id": 103, "title": "기획 리뷰", "status": "confirmed"},
                ],
            })
            return
        student_id = parsed_path.path.removeprefix("/students/")
        if not student_id.isdigit() or int(student_id) not in students:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "student not found"})
            return
        self.send_json(HTTPStatus.OK, students[int(student_id)])

    def do_POST(self) -> None:
        global next_student_id
        if self.path != "/students":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "endpoint not found"})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if not 0 < content_length <= 8192:
                self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "request is too large"})
                return
            payload = json.loads(self.rfile.read(content_length))
        except (ValueError, json.JSONDecodeError):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid JSON"})
            return
        if (
            not isinstance(payload, dict)
            or not isinstance(payload.get("name"), str)
            or not payload["name"].strip()
            or not isinstance(payload.get("score"), int)
            or isinstance(payload.get("score"), bool)
        ):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "name and integer score are required"})
            return
        student = {"id": next_student_id, "name": payload["name"].strip(), "score": payload["score"]}
        students[next_student_id] = student
        next_student_id += 1
        self.send_json(HTTPStatus.CREATED, {"created": True, "student": student})

    def do_PUT(self) -> None:
        student_id = self.path.removeprefix("/students/")
        if not student_id.isdigit() or int(student_id) not in students:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "student not found"})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if not 0 < content_length <= 8192:
                self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "request is too large"})
                return
            payload = json.loads(self.rfile.read(content_length))
        except (ValueError, json.JSONDecodeError):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid JSON"})
            return
        current_id = int(student_id)
        if (
            not isinstance(payload, dict)
            or payload.get("id") != current_id
            or not isinstance(payload.get("name"), str)
            or not payload["name"].strip()
            or not isinstance(payload.get("score"), int)
            or isinstance(payload.get("score"), bool)
        ):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "matching id, name, and integer score are required"})
            return
        student = {"id": current_id, "name": payload["name"].strip(), "score": payload["score"]}
        students[current_id] = student
        self.send_json(HTTPStatus.OK, {"updated": True, "student": student})

    def do_DELETE(self) -> None:
        student_id = urlsplit(self.path).path.removeprefix("/students/")
        if not student_id.isdigit() or int(student_id) not in students:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "student not found"})
            return
        del students[int(student_id)]
        self.send_json(HTTPStatus.OK, {"deleted": True, "student_id": int(student_id)})

    def send_json(self, status: HTTPStatus, value: dict[str, object]) -> None:
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        return


class ThreadedUnixServer(ThreadingMixIn, UnixStreamServer):
    daemon_threads = True


socket_path = "/run/weblink/api.sock"
os.makedirs(os.path.dirname(socket_path), exist_ok=True)
try:
    os.unlink(socket_path)
except FileNotFoundError:
    pass

with ThreadedUnixServer(socket_path, Handler) as server:
    os.chmod(socket_path, 0o660)
    server.serve_forever()
