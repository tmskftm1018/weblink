import hashlib
import json
import re
import secrets
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta

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

GOOGLE_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/spreadsheets.readonly"]
GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo"
GOOGLE_SHEETS_ENDPOINT = "https://sheets.googleapis.com/v4/spreadsheets"
_SPREADSHEET_ID = re.compile(r"^[A-Za-z0-9_-]{10,200}$")
_SHEET_RANGE = re.compile(r"^[\w.'!:$ -]{1,128}$")


class ConnectionsNotConfigured(Exception):
    pass


class GoogleConnectionNotFound(Exception):
    pass


class GoogleRequestFailed(Exception):
    def __init__(self, status_code: int = 502) -> None:
        self.status_code = status_code
        super().__init__("Google Sheets could not complete the request")


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
        raise GoogleRequestFailed(exc.code if exc.code in (400, 401, 403, 404, 429) else 502) from exc
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
    required_scope = "https://www.googleapis.com/auth/spreadsheets.readonly"
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
