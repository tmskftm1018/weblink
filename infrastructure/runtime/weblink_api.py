"""Small HTTP-over-Unix-socket client for the isolated API lesson."""

import http.client
import json
import socket
import time
from urllib.parse import quote


class APIResponseError(ValueError):
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code
        super().__init__(f"API request failed with status {status_code}")


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
