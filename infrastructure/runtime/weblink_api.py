"""Small HTTP-over-Unix-socket client for the isolated API lesson."""

import csv
import http.client
import json
import re
import socket
import time
from pathlib import Path
from urllib.parse import quote

MAX_PROJECT_DATA_FILE_BYTES = 200_000
MAX_IMPORTED_ROWS = 10_000
MAX_IMPORTED_COLUMNS = 256


class APIResponseError(ValueError):
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code
        super().__init__(f"API request failed with status {status_code}")


def import_csv_to_sqlite(connection, source_path: str, table_name: str) -> dict[str, object]:
    """Replace a SQLite table with rows from a CSV file in the project workspace."""
    content = _read_project_data_file(source_path, ".csv")
    try:
        reader = iter(csv.reader(content.decode("utf-8-sig").splitlines()))
        source_headers = next(reader, None)
    except (UnicodeDecodeError, csv.Error) as exc:
        raise ValueError("CSV 파일을 UTF-8 텍스트로 읽지 못했습니다.") from exc
    if not source_headers:
        raise ValueError("CSV에는 열 제목과 데이터 행이 하나 이상 있어야 합니다.")
    headers = _safe_column_names(source_headers)
    records: list[list[object]] = []
    try:
        for row_number, row in enumerate(reader, start=2):
            if len(row) != len(headers):
                raise ValueError(f"CSV {row_number}번째 행의 열 개수가 제목 행과 다릅니다.")
            if len(records) >= MAX_IMPORTED_ROWS:
                raise ValueError(f"CSV는 {MAX_IMPORTED_ROWS:,}개 행까지 가져올 수 있습니다.")
            records.append(row)
    except csv.Error as exc:
        raise ValueError("CSV 행을 읽지 못했습니다. 따옴표와 열 구분을 확인해 주세요.") from exc
    if not records:
        raise ValueError("CSV에는 열 제목과 데이터 행이 하나 이상 있어야 합니다.")
    return _replace_sqlite_table(connection, table_name, headers, records)


def import_json_to_sqlite(connection, source_path: str, table_name: str) -> dict[str, object]:
    """Replace a SQLite table with records from a JSON array of objects."""
    content = _read_project_data_file(source_path, ".json")
    try:
        value = json.loads(content.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("JSON 파일을 읽지 못했습니다. UTF-8 형식인지 확인해 주세요.") from exc
    if not isinstance(value, list) or not value or any(not isinstance(record, dict) for record in value):
        raise ValueError("JSON은 객체가 담긴 배열 형식이어야 합니다. 예: [{\"name\": \"민지\"}]")
    if len(value) > MAX_IMPORTED_ROWS:
        raise ValueError(f"JSON은 {MAX_IMPORTED_ROWS:,}개 행까지 가져올 수 있습니다.")
    source_headers: list[str] = []
    for record in value:
        for key in record:
            if not isinstance(key, str):
                raise ValueError("JSON 각 행의 열 이름은 문자열이어야 합니다.")
            if key not in source_headers:
                source_headers.append(key)
    headers = _safe_column_names(source_headers)
    records = [[_json_cell(record.get(key)) for key in source_headers] for record in value]
    return _replace_sqlite_table(connection, table_name, headers, records)


def _read_project_data_file(source_path: str, expected_extension: str) -> bytes:
    relative = Path(source_path)
    if relative.is_absolute() or not relative.parts or any(part in {".", ".."} for part in relative.parts):
        raise ValueError("파일 경로는 프로젝트 폴더 안의 상대 경로여야 합니다.")
    workspace = Path("/workspace").resolve()
    target = (workspace / relative).resolve()
    if target == workspace or workspace not in target.parents:
        raise ValueError("프로젝트 폴더 바깥의 파일은 가져올 수 없습니다.")
    if target.suffix.lower() != expected_extension:
        raise ValueError(f"{expected_extension} 파일만 가져올 수 있습니다.")
    try:
        if not target.is_file() or target.stat().st_size > MAX_PROJECT_DATA_FILE_BYTES:
            raise ValueError("가져올 데이터 파일은 200KB 이하의 일반 파일이어야 합니다.")
        return target.read_bytes()
    except OSError as exc:
        raise ValueError("프로젝트에서 데이터 파일을 찾지 못했습니다.") from exc


def _safe_column_names(source_names: list[object]) -> list[str]:
    if not source_names:
        raise ValueError("데이터 파일에 열 제목이 없습니다.")
    if len(source_names) > MAX_IMPORTED_COLUMNS:
        raise ValueError(f"파일은 {MAX_IMPORTED_COLUMNS}개 열까지 가져올 수 있습니다.")
    names: list[str] = []
    used: set[str] = set()
    for index, source_name in enumerate(source_names, start=1):
        normalized = re.sub(r"[^A-Za-z0-9_]+", "_", str(source_name).strip()).strip("_").lower()
        if not normalized:
            normalized = f"column_{index}"
        if normalized[0].isdigit():
            normalized = f"column_{normalized}"
        if normalized.startswith("sqlite_"):
            normalized = f"data_{normalized}"
        base = normalized[:60]
        normalized = base
        suffix = 2
        while normalized in used:
            ending = f"_{suffix}"
            normalized = f"{base[:63 - len(ending)]}{ending}"
            suffix += 1
        used.add(normalized)
        names.append(normalized)
    return names


def _json_cell(value: object) -> object:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


def _replace_sqlite_table(connection, table_name: str, columns: list[str], rows: list[list[object]]) -> dict[str, object]:
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,62}", table_name) or table_name.lower().startswith("sqlite_"):
        raise ValueError("테이블 이름은 영문자로 시작하는 영문·숫자·밑줄만 사용할 수 있습니다.")
    if not rows or len(rows) > MAX_IMPORTED_ROWS:
        raise ValueError("가져올 데이터는 1개 이상 10,000개 이하 행이어야 합니다.")
    quote_identifier = lambda value: '"' + value.replace('"', '""') + '"'
    quoted_table = quote_identifier(table_name)
    definitions = ", ".join(f"{quote_identifier(column)} TEXT" for column in columns)
    placeholders = ", ".join("?" for _ in columns)
    savepoint = "weblink_data_import"
    connection.execute(f"SAVEPOINT {savepoint}")
    try:
        connection.execute(f"CREATE TABLE IF NOT EXISTS {quoted_table} ({definitions})")
        actual_columns = [row[1] for row in connection.execute(f"PRAGMA table_info({quoted_table})")]
        if actual_columns != columns:
            raise ValueError("기존 테이블의 열 구성이 파일과 다릅니다. 다른 테이블 이름을 선택해 주세요.")
        connection.execute(f"DELETE FROM {quoted_table}")
        connection.executemany(
            f"INSERT INTO {quoted_table} ({', '.join(quote_identifier(column) for column in columns)}) VALUES ({placeholders})",
            rows,
        )
        connection.execute(f"RELEASE SAVEPOINT {savepoint}")
    except Exception:
        connection.execute(f"ROLLBACK TO SAVEPOINT {savepoint}")
        connection.execute(f"RELEASE SAVEPOINT {savepoint}")
        raise
    return {"table_name": table_name, "row_count": len(rows), "columns": columns}


class _UnixHTTPConnection(http.client.HTTPConnection):
    def connect(self) -> None:
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(2)
        self.sock.connect("/run/weblink/api.sock")


def get_json(path: str) -> dict[str, object]:
    return _request_json("GET", path)


def get_google_sheet(spreadsheet_id: str, cell_range: str) -> dict[str, object]:
    """Read a range through the account connection managed by WebLink."""
    encoded_id = quote(spreadsheet_id, safe="")
    encoded_range = quote(cell_range, safe="!:$'")
    return get_json(f"/google/sheets/{encoded_id}/values/{encoded_range}")


def update_google_sheet(
    spreadsheet_id: str,
    cell_range: str,
    values: list[list[str | int | float | bool]],
) -> dict[str, object]:
    """Write rows to a user-selected Google Sheets range through WebLink's scoped connection."""
    encoded_id = quote(spreadsheet_id, safe="")
    encoded_range = quote(cell_range, safe="!:$'")
    return put_json(f"/google/sheets/{encoded_id}/values/{encoded_range}", {"values": values})


def post_json(path: str, payload: dict[str, object]) -> dict[str, object]:
    return _request_json("POST", path, payload)


def put_json(path: str, payload: dict[str, object]) -> dict[str, object]:
    return _request_json("PUT", path, payload)


def delete_json(path: str) -> dict[str, object]:
    return _request_json("DELETE", path)


def _request_json(
    method: str,
    path: str,
    payload: dict[str, object] | None = None,
) -> dict[str, object]:
    if not path.startswith("/") or ".." in path.split("/"):
        raise ValueError("API path must be a local absolute path")
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    last_error: OSError | None = None
    for _attempt in range(10):
        connection = _UnixHTTPConnection("weblink-api")
        try:
            headers = {"Accept": "application/json"}
            if body is not None:
                headers["Content-Type"] = "application/json; charset=utf-8"
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            if response.status not in (200, 201):
                raise APIResponseError(response.status)
            value = json.loads(response.read())
            if not isinstance(value, dict):
                raise ValueError("API response must be a JSON object")
            return value
        except (ConnectionError, FileNotFoundError, TimeoutError) as exc:
            last_error = exc
            time.sleep(0.1)
        finally:
            connection.close()
    raise ConnectionError("The local API service did not respond") from last_error
