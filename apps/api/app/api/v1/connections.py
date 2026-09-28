from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.auth import User
from app.schemas.connections import GoogleConnectionStatus, OAuthStartResponse, SheetValuesResponse
from app.services import connections as connection_service

router = APIRouter(prefix="/connections", tags=["connections"])
SessionDep = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("/google", response_model=GoogleConnectionStatus)
def google_status(db: SessionDep, user: CurrentUser) -> GoogleConnectionStatus:
    return connection_service.status(db, user)


@router.post("/google/oauth/start", response_model=OAuthStartResponse)
def start_google_oauth(db: SessionDep, user: CurrentUser) -> OAuthStartResponse:
    try:
        return OAuthStartResponse(authorization_url=connection_service.start_google_authorization(db, user))
    except connection_service.ConnectionsNotConfigured as exc:
        raise HTTPException(status_code=503, detail="Google 연결 설정이 완료되지 않았습니다. 서버 설정을 확인해 주세요.") from exc


@router.get("/google/oauth/callback")
def google_oauth_callback(
    db: SessionDep,
    user: CurrentUser,
    state: Annotated[str | None, Query(max_length=256)] = None,
    code: Annotated[str | None, Query(max_length=4096)] = None,
    error: Annotated[str | None, Query(max_length=128)] = None,
) -> RedirectResponse:
    origin = settings.web_origins[0].rstrip("/") if settings.web_origins else "http://localhost:5173"
    if error or not state or not code:
        return RedirectResponse(f"{origin}/?connection=google_error", status_code=status.HTTP_303_SEE_OTHER)
    try:
        connection_service.complete_google_authorization(db, user, state, code)
    except connection_service.ConnectionsNotConfigured:
        return RedirectResponse(f"{origin}/?connection=google_setup_error", status_code=status.HTTP_303_SEE_OTHER)
    except connection_service.GoogleRequestFailed:
        return RedirectResponse(f"{origin}/?connection=google_authorization_error", status_code=status.HTTP_303_SEE_OTHER)
    return RedirectResponse(f"{origin}/?connection=google_connected", status_code=status.HTTP_303_SEE_OTHER)


@router.delete("/google", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_google(db: SessionDep, user: CurrentUser) -> None:
    connection_service.disconnect_google(db, user)


@router.get("/google/sheets/{spreadsheet_id}/values/{sheet_range:path}", response_model=SheetValuesResponse)
def read_google_sheet(
    spreadsheet_id: str,
    sheet_range: str,
    db: SessionDep,
    user: CurrentUser,
) -> SheetValuesResponse:
    try:
        return connection_service.read_sheet_values(db, user, spreadsheet_id, sheet_range)
    except connection_service.GoogleConnectionNotFound as exc:
        raise HTTPException(status_code=409, detail="Google 계정을 먼저 연결해 주세요.") from exc
    except connection_service.ConnectionsNotConfigured as exc:
        raise HTTPException(status_code=503, detail="연결 암호화 설정을 확인해 주세요.") from exc
    except connection_service.GoogleRequestFailed as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
