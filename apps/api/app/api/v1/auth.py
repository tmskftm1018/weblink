from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.auth import User
from app.schemas.auth import Credentials, SignupRequest, UserResponse
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["auth"])
SessionDep = Annotated[Session, Depends(get_db)]


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key="weblink_session",
        value=token,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        max_age=settings.session_duration_days * 24 * 60 * 60,
        path="/api/v1",
    )


def _user_response(user: User) -> UserResponse:
    return UserResponse(id=str(user.id), email=user.email, display_name=user.display_name)


@router.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest, response: Response, db: SessionDep) -> UserResponse:
    try:
        user, token = auth_service.signup(db, payload)
    except auth_service.EmailAlreadyRegistered as exc:
        raise HTTPException(status_code=409, detail="An account with this email already exists") from exc
    _set_session_cookie(response, token)
    return _user_response(user)


@router.post("/login", response_model=UserResponse)
def login(payload: Credentials, response: Response, db: SessionDep) -> UserResponse:
    try:
        user, token = auth_service.login(db, str(payload.email), payload.password)
    except auth_service.InvalidCredentials as exc:
        raise HTTPException(status_code=401, detail="Invalid email or password") from exc
    _set_session_cookie(response, token)
    return _user_response(user)


def get_current_user(
    db: SessionDep,
    token: Annotated[str | None, Cookie(alias="weblink_session")] = None,
) -> User:
    user = auth_service.get_session_user(db, token)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("/me", response_model=UserResponse)
def current_user(user: CurrentUser) -> UserResponse:
    return _user_response(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    response: Response,
    db: SessionDep,
    token: Annotated[str | None, Cookie(alias="weblink_session")] = None,
) -> Response:
    auth_service.revoke_session(db, token)
    response.delete_cookie(key="weblink_session", path="/api/v1", httponly=True, samesite="lax")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response
