from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models.auth import User
from app.schemas.projects import (
    CreateRevisionResponse,
    DraftSavedResponse,
    ProjectCreateRequest,
    ProjectSummaryResponse,
    ProjectWorkspaceResponse,
    SaveDraftRequest,
)
from app.services import projects as project_service

router = APIRouter(prefix="/projects", tags=["projects"])
SessionDep = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("", response_model=list[ProjectSummaryResponse])
def list_projects(db: SessionDep, user: CurrentUser) -> list[ProjectSummaryResponse]:
    return project_service.list_projects(db, user)


@router.post("", response_model=ProjectWorkspaceResponse, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreateRequest, db: SessionDep, user: CurrentUser) -> ProjectWorkspaceResponse:
    return project_service.create_project(db, user, payload)


@router.get("/{project_id}", response_model=ProjectWorkspaceResponse)
def get_project(project_id: UUID, db: SessionDep, user: CurrentUser) -> ProjectWorkspaceResponse:
    try:
        return project_service.get_workspace(db, user, project_id)
    except project_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc


@router.put("/{project_id}/draft", response_model=DraftSavedResponse)
def save_draft(
    project_id: UUID,
    payload: SaveDraftRequest,
    db: SessionDep,
    user: CurrentUser,
) -> DraftSavedResponse:
    try:
        return project_service.save_draft(db, user, project_id, payload)
    except project_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except project_service.ProjectReadOnly as exc:
        raise HTTPException(status_code=403, detail="Project is read-only") from exc
    except project_service.DraftConflict as exc:
        raise HTTPException(status_code=409, detail="Draft changed since it was loaded; reload before saving") from exc
    except project_service.InvalidDraft as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/{project_id}/revisions", response_model=CreateRevisionResponse)
def create_revision(
    project_id: UUID,
    db: SessionDep,
    user: CurrentUser,
    response: Response,
) -> CreateRevisionResponse:
    try:
        result = project_service.create_revision(db, user, project_id)
    except project_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except project_service.ProjectReadOnly as exc:
        raise HTTPException(status_code=403, detail="Project is read-only") from exc
    if not result.created:
        response.status_code = status.HTTP_200_OK
    return result
