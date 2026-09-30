from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models.auth import User
from app.schemas.runs import RunCreateRequest, RunListResponse, RunResponse
from app.services import execution as execution_service

router = APIRouter(tags=["runs"])
SessionDep = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
IdempotencyKey = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)]


@router.post(
    "/projects/{project_id}/runs",
    response_model=RunResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def create_run(
    project_id: UUID,
    payload: RunCreateRequest,
    response: Response,
    idempotency_key: IdempotencyKey,
    db: SessionDep,
    user: CurrentUser,
) -> RunResponse:
    try:
        result, created = execution_service.create_run(
            db,
            user,
            project_id,
            payload.revision_id,
            idempotency_key,
        )
    except execution_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except execution_service.ProjectReadOnly as exc:
        raise HTTPException(status_code=403, detail="보기 전용 권한으로는 프로젝트를 실행할 수 없습니다.") from exc
    except execution_service.RevisionNotFound as exc:
        raise HTTPException(status_code=404, detail="Revision not found") from exc
    except execution_service.IdempotencyConflict as exc:
        raise HTTPException(status_code=409, detail="Idempotency key was already used for a different request") from exc
    if not created:
        response.status_code = status.HTTP_200_OK
    return result


@router.get("/projects/{project_id}/runs", response_model=RunListResponse)
def list_runs(project_id: UUID, db: SessionDep, user: CurrentUser) -> RunListResponse:
    try:
        return RunListResponse(runs=execution_service.list_runs(db, user, project_id))
    except execution_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc


@router.get("/projects/{project_id}/runs/{run_id}", response_model=RunResponse)
def get_run(project_id: UUID, run_id: UUID, db: SessionDep, user: CurrentUser) -> RunResponse:
    try:
        return execution_service.get_run(db, user, project_id, run_id)
    except execution_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Run not found") from exc
