import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.auth import AuthIdentity, User, UserSession
from app.schemas.auth import SignupRequest
from app.security.passwords import hash_password, verify_password

_DUMMY_PASSWORD_HASH = hash_password("not-a-real-user-password")


class EmailAlreadyRegistered(Exception):
    pass


class InvalidCredentials(Exception):
    pass


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _new_session(db: Session, user: User) -> tuple[str, UserSession]:
    token = secrets.token_urlsafe(32)
    session = UserSession(
        user_id=user.id,
        token_hash=_token_hash(token),
        expires_at=datetime.now(UTC) + timedelta(days=settings.session_duration_days),
    )
    db.add(session)
    return token, session


def signup(db: Session, request: SignupRequest) -> tuple[User, str]:
    user = User(email=str(request.email), display_name=request.display_name)
    user.identities.append(
        AuthIdentity(
            provider="email",
            provider_subject=str(request.email),
            password_hash=hash_password(request.password),
        )
    )
    db.add(user)
    try:
        db.flush()
        token, _ = _new_session(db, user)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        original = exc.orig
        is_unique_violation = (
            getattr(original, "sqlstate", None) == "23505"
            or getattr(original, "sqlite_errorname", "") == "SQLITE_CONSTRAINT_UNIQUE"
            or "unique constraint failed" in str(original).lower()
        )
        if is_unique_violation:
            raise EmailAlreadyRegistered from exc
        raise
    db.refresh(user)
    return user, token


def login(db: Session, email: str, password: str) -> tuple[User, str]:
    identity = db.scalar(
        select(AuthIdentity).where(
            AuthIdentity.provider == "email",
            AuthIdentity.provider_subject == email,
        )
    )
    password_hash = identity.password_hash if identity else _DUMMY_PASSWORD_HASH
    if not verify_password(password, password_hash) or identity is None:
        raise InvalidCredentials
    if not identity.user.is_active:
        raise InvalidCredentials
    token, _ = _new_session(db, identity.user)
    db.commit()
    return identity.user, token


def get_session_user(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    session = db.scalar(
        select(UserSession).where(
            UserSession.token_hash == _token_hash(token),
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > datetime.now(UTC),
        )
    )
    if session is None:
        return None
    user = db.get(User, session.user_id)
    return user if user and user.is_active else None


def revoke_session(db: Session, token: str | None) -> None:
    if not token:
        return
    session = db.scalar(select(UserSession).where(UserSession.token_hash == _token_hash(token)))
    if session and session.revoked_at is None:
        session.revoked_at = datetime.now(UTC)
        db.commit()
