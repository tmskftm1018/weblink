"""Encrypted per-user GitHub read-token management."""

import json
import urllib.error
import urllib.request
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.auth import User
from app.models.connections import GitHubConnection
from app.schemas.connections import GitHubConnectionStatus
from app.security.connection_tokens import ConnectionEncryptionUnavailable, decrypt_token, encrypt_token, encryption_key_is_valid

GITHUB_USER_ENDPOINT = "https://api.github.com/user"


class GitHubConnectionUnavailable(Exception):
    pass


class GitHubTokenInvalid(Exception):
    pass


def status(db: Session, user: User) -> GitHubConnectionStatus:
    connection = db.scalar(select(GitHubConnection).where(GitHubConnection.user_id == user.id))
    return GitHubConnectionStatus(
        configured=encryption_key_is_valid(),
        connected=connection is not None,
        account_name=connection.account_name if connection else None,
        connected_at=connection.connected_at.isoformat() if connection else None,
    )


def _verify_token(token: str) -> str:
    request = urllib.request.Request(
        GITHUB_USER_ENDPOINT,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "WebLink-Project-Importer",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            body = response.read(65_537)
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise GitHubTokenInvalid from exc
        raise GitHubConnectionUnavailable from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise GitHubConnectionUnavailable from exc
    if len(body) > 65_536:
        raise GitHubConnectionUnavailable
    try:
        profile = json.loads(body)
    except (ValueError, UnicodeDecodeError) as exc:
        raise GitHubConnectionUnavailable from exc
    account_name = profile.get("login") if isinstance(profile, dict) else None
    if not isinstance(account_name, str) or not account_name:
        raise GitHubConnectionUnavailable
    return account_name


def save_token(db: Session, user: User, token: str) -> str:
    normalized = token.strip()
    if len(normalized) < 20 or len(normalized) > 500 or any(char.isspace() for char in normalized):
        raise GitHubTokenInvalid
    try:
        account_name = _verify_token(normalized)
        ciphertext = encrypt_token(normalized)
    except ConnectionEncryptionUnavailable as exc:
        raise GitHubConnectionUnavailable from exc
    connection = db.scalar(
        select(GitHubConnection).where(GitHubConnection.user_id == user.id).with_for_update()
    )
    if connection is None:
        connection = GitHubConnection(
            user_id=user.id,
            account_name=account_name,
            token_ciphertext=ciphertext,
        )
        db.add(connection)
    else:
        connection.account_name = account_name
        connection.token_ciphertext = ciphertext
        connection.connected_at = datetime.now(UTC)
    db.commit()
    return account_name


def get_access_token(db: Session, user: User) -> str | None:
    connection = db.scalar(select(GitHubConnection).where(GitHubConnection.user_id == user.id))
    if connection is None:
        return None
    try:
        return decrypt_token(connection.token_ciphertext)
    except ConnectionEncryptionUnavailable as exc:
        raise GitHubConnectionUnavailable from exc


def disconnect(db: Session, user: User) -> None:
    connection = db.scalar(select(GitHubConnection).where(GitHubConnection.user_id == user.id))
    if connection is not None:
        db.delete(connection)
        db.commit()
