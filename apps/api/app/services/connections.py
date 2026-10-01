import hashlib
import json
import re
import secrets
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import PurePosixPath

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.auth import User
from app.models.connections import GoogleConnection, GoogleOAuthState
from app.schemas.connections import GoogleConnectionStatus, SheetValuesResponse
from app.security.connection_tokens import (
    ConnectionEncryptionUnavailable,
    decrypt_token,
    encryption_key_is_valid,
    encrypt_token,
)

GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo"
GOOGLE_SHEETS_ENDPOINT = "https://sheets.googleapis.com/v4/spreadsheets"
GOOGLE_DRIVE_ENDPOINT = "https://www.googleapis.com/drive/v3/files"
GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file"
GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets"
GOOGLE_SCOPES = ["openid", "email", GOOGLE_SHEETS_SCOPE, GOOGLE_DRIVE_FILE_SCOPE]
_SPREADSHEET_ID = re.compile(r"^[A-Za-z0-9_-]{10,200}$")
_DRIVE_FILE_ID = re.compile(r"^[A-Za-z0-9_-]{10,200}$")
_SHEET_RANGE = re.compile(r"^[\w.'!:$ -]{1,128}$")


class ConnectionsNotConfigured(Exception):
    pass


class GoogleConnectionNotFound(Exception):
    pass


class GoogleDriveScopeRequired(Exception):
    pass


class GoogleDriveFileUnsupported(Exception):
    pass


class GoogleRequestFailed(Exception):
    def __init__(self, status_code: int = 502, message: str = "Google 서비스에 요청하지 못했습니다. 잠시 후 다시 시도해 주세요.") -> None:
        self.status_code = status_code
        super().__init__(message)


def _google_failure_message(status_code: int, body: bytes, *, refreshing_token: bool = False) -> str:
    if refreshing_token and status_code in (400, 401):
        return "Google 연결이 만료되었어요. Google 계정 연결을 해제한 뒤 다시 연결해 주세요."

    try:
        payload = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        payload = {}
    error = payload.get("error", {}) if isinstance(payload, dict) else {}
    provider_text = json.dumps(error, ensure_ascii=False).lower() if isinstance(error, dict) else ""

    if status_code == 400:
        return "시트 범위를 읽지 못했어요. 탭 이름과 범위(예: '시트1'!A1:C20)를 확인해 주세요."
    if status_code == 401:
        return "Google 인증이 만료되었어요. Google 계정 연결을 해제한 뒤 다시 연결해 주세요."
    if status_code == 403 and any(
        marker in provider_text for marker in ("accessnotconfigured", "service_disabled", "has not been used", "not enabled")
    ):
        return "Google Sheets API가 Google Cloud 프로젝트에서 활성화되어 있지 않아요. API 및 서비스에서 사용 설정해 주세요."
    if status_code == 403:
        return "Google 계정에 이 스프레드시트 접근 권한이 없어요. 연결된 계정과 시트 공유 권한을 확인해 주세요."
    if status_code == 404:
        return "스프레드시트를 찾지 못했어요. ID가 맞는지, 연결된 Google 계정에서 열 수 있는지 확인해 주세요."
    if status_code == 429:
        return "Google Sheets 요청 한도에 도달했어요. 잠시 기다린 뒤 다시 시도해 주세요."
    return "Google Sheets 서비스에 일시적인 문제가 있어요. 잠시 후 다시 시도해 주세요."


def is_configured() -> bool:
    return bool(
        settings.google_oauth_client_id
        and settings.google_oauth_client_secret
        and settings.google_oauth_redirect_uri
        and encryption_key_is_valid()
    )


def status(db: Session, user: User) -> GoogleConnectionStatus:
    connection = db.scalar(select(GoogleConnection).where(GoogleConnection.user_id == user.id))
    return GoogleConnectionStatus(
        configured=is_configured(),
        connected=connection is not None,
        account_email=connection.account_email if connection else None,
        scopes=connection.scopes if connection else [],
        connected_at=connection.connected_at.isoformat() if connection else None,
        drive_picker_configured=bool(settings.google_picker_api_key and settings.google_cloud_project_number),
    )


def start_google_authorization(db: Session, user: User) -> str:
    if not is_configured():
        raise ConnectionsNotConfigured
    db.execute(delete(GoogleOAuthState).where(GoogleOAuthState.expires_at <= datetime.now(UTC)))
    state = secrets.token_urlsafe(32)
    db.add(
        GoogleOAuthState(
            state_hash=hashlib.sha256(state.encode()).hexdigest(),
            user_id=user.id,
            expires_at=datetime.now(UTC) + timedelta(minutes=10),
        )
    )
    db.commit()
    query = urllib.parse.urlencode(
        {
            "client_id": settings.google_oauth_client_id,
            "redirect_uri": settings.google_oauth_redirect_uri,
            "response_type": "code",
            "scope": " ".join(GOOGLE_SCOPES),
            "access_type": "offline",
            "include_granted_scopes": "true",
            "prompt": "consent",
            "state": state,
        }
    )
    return f"{GOOGLE_AUTHORIZATION_ENDPOINT}?{query}"


def _post_form(url: str, payload: dict[str, str]) -> dict:
    request = urllib.request.Request(
        url,
        data=urllib.parse.urlencode(payload).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            body = response.read(256_001)
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read(32_768)
        except OSError:
            body = b""
        refreshing_token = payload.get("grant_type") == "refresh_token"
        status_code = 401 if refreshing_token and exc.code in (400, 401) else exc.code
        raise GoogleRequestFailed(
            status_code,
            _google_failure_message(exc.code, body, refreshing_token=refreshing_token),
        ) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise GoogleRequestFailed from exc
    if len(body) > 256_000:
        raise GoogleRequestFailed
    try:
        result = json.loads(body)
    except (ValueError, UnicodeDecodeError) as exc:
        raise GoogleRequestFailed from exc
    if not isinstance(result, dict):
        raise GoogleRequestFailed
    return result


def _get_json(url: str, access_token: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            body = response.read(1_048_577)
    except urllib.error.HTTPError as exc:
        try:
            error_body = exc.read(32_768)
        except OSError:
            error_body = b""
        status_code = exc.code if exc.code in (400, 401, 403, 404, 429) else 502
        raise GoogleRequestFailed(status_code, _google_failure_message(exc.code, error_body)) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise GoogleRequestFailed from exc
    if len(body) > 1_048_576:
        raise GoogleRequestFailed
    try:
        result = json.loads(body)
    except (ValueError, UnicodeDecodeError) as exc:
        raise GoogleRequestFailed from exc
    if not isinstance(result, dict):
        raise GoogleRequestFailed
    return result


def complete_google_authorization(
    db: Session,
    user: User,
    state: str,
    code: str,
) -> None:
    if not is_configured() or len(state) > 256 or len(code) > 4096:
        raise ConnectionsNotConfigured
    state_hash = hashlib.sha256(state.encode()).hexdigest()
    flow = db.scalar(
        select(GoogleOAuthState)
        .where(GoogleOAuthState.state_hash == state_hash)
        .with_for_update()
    )
    now = datetime.now(UTC)
    if flow is None or flow.user_id != user.id or flow.consumed_at is not None or flow.expires_at <= now:
        raise ConnectionsNotConfigured
    flow.consumed_at = now
    db.flush()

    tokens = _post_form(
        GOOGLE_TOKEN_ENDPOINT,
        {
            "code": code,
            "client_id": settings.google_oauth_client_id or "",
            "client_secret": settings.google_oauth_client_secret or "",
            "redirect_uri": settings.google_oauth_redirect_uri,
            "grant_type": "authorization_code",
        },
    )
    access_token = tokens.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        db.rollback()
        raise GoogleRequestFailed
    profile = _get_json(GOOGLE_USERINFO_ENDPOINT, access_token)
    account_email = profile.get("email")
    if not isinstance(account_email, str) or "@" not in account_email:
        db.rollback()
        raise GoogleRequestFailed
    scopes = tokens.get("scope", " ".join(GOOGLE_SCOPES))
    scopes = scopes.split() if isinstance(scopes, str) else []
    required_scope = GOOGLE_SHEETS_SCOPE
    if required_scope not in scopes:
        db.rollback()
        raise GoogleRequestFailed(403)
    refresh_token = tokens.get("refresh_token")
    connection = db.scalar(select(GoogleConnection).where(GoogleConnection.user_id == user.id).with_for_update())
    if not isinstance(refresh_token, str) or not refresh_token:
        if connection is None:
            db.rollback()
            raise GoogleRequestFailed
        encrypted_refresh_token = connection.refresh_token_ciphertext
    else:
        encrypted_refresh_token = encrypt_token(refresh_token)
    if connection is None:
        connection = GoogleConnection(
            user_id=user.id,
            account_email=account_email.lower(),
            refresh_token_ciphertext=encrypted_refresh_token,
            scopes=scopes,
        )
        db.add(connection)
    else:
        connection.account_email = account_email.lower()
        connection.refresh_token_ciphertext = encrypted_refresh_token
        connection.scopes = scopes
    db.commit()


def disconnect_google(db: Session, user: User) -> None:
    connection = db.scalar(select(GoogleConnection).where(GoogleConnection.user_id == user.id))
    if connection:
        db.delete(connection)
        db.commit()


def drive_picker_config(db: Session, user: User) -> dict[str, str]:
    if not settings.google_picker_api_key or not settings.google_cloud_project_number:
        raise ConnectionsNotConfigured
    connection = db.scalar(select(GoogleConnection).where(GoogleConnection.user_id == user.id))
    if connection is None:
        raise GoogleConnectionNotFound
    if GOOGLE_DRIVE_FILE_SCOPE not in connection.scopes:
        raise GoogleDriveScopeRequired
    try:
        refresh_token = decrypt_token(connection.refresh_token_ciphertext)
    except ConnectionEncryptionUnavailable as exc:
        raise ConnectionsNotConfigured from exc
    return {
        "access_token": _access_token(refresh_token),
        "api_key": settings.google_picker_api_key,
        "app_id": settings.google_cloud_project_number,
    }


def _drive_get_bytes(url: str, access_token: str, *, max_bytes: int = 200_000) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {access_token}", "Accept": "*/*"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            body = response.read(max_bytes + 1)
    except urllib.error.HTTPError as exc:
        try:
            error_body = exc.read(32_768)
        except OSError:
            error_body = b""
        message = (
            "Google Drive API가 활성화되어 있지 않아요. Google Cloud에서 Drive API를 사용 설정해 주세요."
            if exc.code == 403 and any(marker in error_body.lower() for marker in (b"accessnotconfigured", b"service_disabled", b"not enabled"))
            else "Google Drive 파일을 읽을 권한이 없거나 파일이 삭제되었습니다. Picker에서 파일을 다시 선택해 주세요."
            if exc.code in (403, 404)
            else "Google 계정 연결이 만료되었어요. 계정을 다시 연결해 주세요."
            if exc.code == 401
            else "Google Drive 요청 한도에 도달했어요. 잠시 뒤 다시 시도해 주세요."
            if exc.code == 429
            else "Google Drive 파일을 불러오지 못했습니다."
        )
        raise GoogleRequestFailed(413 if exc.code == 413 else (401 if exc.code == 401 else 422 if exc.code in (403, 404) else 502), message) from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise GoogleRequestFailed(502, "Google Drive에 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요.") from exc
    if len(body) > max_bytes:
        raise GoogleRequestFailed(413, "가져올 파일은 200KB 이하여야 합니다.")
    return body


def import_google_drive_file(db: Session, user: User, file_id: str):
    if not _DRIVE_FILE_ID.fullmatch(file_id):
        raise GoogleDriveFileUnsupported
    connection = db.scalar(select(GoogleConnection).where(GoogleConnection.user_id == user.id))
    if connection is None:
        raise GoogleConnectionNotFound
    if GOOGLE_DRIVE_FILE_SCOPE not in connection.scopes:
        raise GoogleDriveScopeRequired
    try:
        refresh_token = decrypt_token(connection.refresh_token_ciphertext)
    except ConnectionEncryptionUnavailable as exc:
        raise ConnectionsNotConfigured from exc
    access_token = _access_token(refresh_token)
    quoted_id = urllib.parse.quote(file_id, safe="")
    metadata_url = f"{GOOGLE_DRIVE_ENDPOINT}/{quoted_id}?fields=id,name,mimeType,size"
    metadata = _get_json(metadata_url, access_token)
    name = metadata.get("name")
    mime_type = metadata.get("mimeType")
    if not isinstance(name, str) or not isinstance(mime_type, str):
        raise GoogleDriveFileUnsupported
    export_mime: str | None = None
    output_mime = mime_type
    if mime_type == "application/vnd.google-apps.document":
        export_mime, output_mime = "text/plain", "text/plain"
    elif mime_type == "application/vnd.google-apps.spreadsheet":
        export_mime, output_mime = "text/csv", "text/csv"
    elif mime_type not in {"text/plain", "text/markdown", "text/csv", "text/html", "text/css", "application/json", "application/xml", "text/xml", "application/javascript"}:
        raise GoogleDriveFileUnsupported
    if export_mime:
        download_url = f"{GOOGLE_DRIVE_ENDPOINT}/{quoted_id}/export?mimeType={urllib.parse.quote(export_mime)}"
    else:
        download_url = f"{GOOGLE_DRIVE_ENDPOINT}/{quoted_id}?alt=media"
    content_bytes = _drive_get_bytes(download_url, access_token)
    try:
        content = content_bytes.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise GoogleDriveFileUnsupported from exc
    if len(content) > 200_000:
        raise GoogleRequestFailed(413, "가져올 파일은 200,000자 이하여야 합니다.")
    safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")[:180] or "drive-file"
    if export_mime == "text/csv" and not safe_name.lower().endswith(".csv"):
        safe_name += ".csv"
    elif export_mime == "text/plain" and not PurePosixPath(safe_name).suffix:
        safe_name += ".txt"
    return {"file_name": name, "file_path": safe_name, "content": content, "mime_type": output_mime}


def _access_token(refresh_token: str) -> str:
    result = _post_form(
        GOOGLE_TOKEN_ENDPOINT,
        {
            "client_id": settings.google_oauth_client_id or "",
            "client_secret": settings.google_oauth_client_secret or "",
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
    )
    access_token = result.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise GoogleRequestFailed(401)
    return access_token


def read_sheet_values(
    db: Session,
    user: User,
    spreadsheet_id: str,
    sheet_range: str,
) -> SheetValuesResponse:
    if not _SPREADSHEET_ID.fullmatch(spreadsheet_id) or not _SHEET_RANGE.fullmatch(sheet_range):
        raise GoogleRequestFailed(400)
    connection = db.scalar(select(GoogleConnection).where(GoogleConnection.user_id == user.id))
    if connection is None:
        raise GoogleConnectionNotFound
    try:
        refresh_token = decrypt_token(connection.refresh_token_ciphertext)
    except ConnectionEncryptionUnavailable as exc:
        raise ConnectionsNotConfigured from exc
    access_token = _access_token(refresh_token)
    spreadsheet = urllib.parse.quote(spreadsheet_id, safe="")
    cell_range = urllib.parse.quote(sheet_range, safe="!:$'")
    url = f"{GOOGLE_SHEETS_ENDPOINT}/{spreadsheet}/values/{cell_range}?majorDimension=ROWS"
    payload = _get_json(url, access_token)
    values = payload.get("values", [])
    if not isinstance(values, list) or len(values) > 10_000:
        raise GoogleRequestFailed
    rows: list[list[str | int | float | bool]] = []
    for row in values:
        if not isinstance(row, list) or len(row) > 256:
            raise GoogleRequestFailed
        rows.append([value if isinstance(value, (str, int, float, bool)) else "" for value in row])
    return SheetValuesResponse(range=str(payload.get("range", sheet_range)), majorDimension="ROWS", values=rows)
