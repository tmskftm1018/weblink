from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models.auth import User
from app.schemas.debugging import DebugSessionCreate, DebugSessionResponse
from app.services import debugging as debugging_service

router = APIRouter(tags=["debugging"])
SessionDep = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.post(
    "/projects/{project_id}/runs/{run_id}/debug-session",
    response_model=DebugSessionResponse,
)
def save_debug_session(
    project_id: UUID,
    run_id: UUID,
    payload: DebugSessionCreate,
    db: SessionDep,
    user: CurrentUser,
) -> DebugSessionResponse:
    try:
        return debugging_service.save_debug_session(db, user, project_id, run_id, payload)
    except debugging_service.DebugSessionNotFound as exc:
        raise HTTPException(status_code=404, detail="Run not found") from exc
    except debugging_service.RunNotReady as exc:
        raise HTTPException(status_code=409, detail="Run has not finished") from exc


@router.get(
    "/projects/{project_id}/runs/{run_id}/debug-session",
    response_model=DebugSessionResponse,
)
def get_debug_session(
    project_id: UUID,
    run_id: UUID,
    db: SessionDep,
    user: CurrentUser,
) -> DebugSessionResponse:
    try:
        return debugging_service.get_debug_session(db, user, project_id, run_id)
    except debugging_service.DebugSessionNotFound as exc:
        raise HTTPException(status_code=404, detail="Debug session not found") from exc
