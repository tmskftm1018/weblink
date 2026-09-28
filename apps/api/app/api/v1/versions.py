from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models.auth import User
from app.schemas.versions import (
    ProjectVersionCreate,
    ProjectVersionDetailResponse,
    ProjectVersionResponse,
    VersionRestoreResponse,
)
from app.services import versions as version_service

router = APIRouter(prefix="/projects", tags=["versions"])
SessionDep = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("/{project_id}/versions", response_model=list[ProjectVersionResponse])
def list_versions(project_id: UUID, db: SessionDep, user: CurrentUser) -> list[ProjectVersionResponse]:
    try:
        return version_service.list_versions(db, user, project_id)
    except version_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc


@router.post(
    "/{project_id}/versions",
    response_model=ProjectVersionResponse,
    status_code=status.HTTP_201_CREATED,
)
def save_version(
    project_id: UUID,
    payload: ProjectVersionCreate,
    db: SessionDep,
    user: CurrentUser,
) -> ProjectVersionResponse:
    try:
        return version_service.save_version(db, user, project_id, payload)
    except version_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except version_service.RevisionNotFound as exc:
        raise HTTPException(status_code=404, detail="Revision not found") from exc
    except version_service.ProjectReadOnly as exc:
        raise HTTPException(status_code=403, detail="Project is read-only") from exc


@router.get(
    "/{project_id}/versions/{version_id}", response_model=ProjectVersionDetailResponse
)
def get_version(
    project_id: UUID, version_id: UUID, db: SessionDep, user: CurrentUser
) -> ProjectVersionDetailResponse:
    try:
        return version_service.get_version(db, user, project_id, version_id)
    except (version_service.ProjectNotFound, version_service.VersionNotFound) as exc:
        raise HTTPException(status_code=404, detail="Version not found") from exc


@router.post(
    "/{project_id}/versions/{version_id}/restore", response_model=VersionRestoreResponse
)
def restore_version(
    project_id: UUID, version_id: UUID, db: SessionDep, user: CurrentUser
) -> VersionRestoreResponse:
    try:
        return version_service.restore_version(db, user, project_id, version_id)
    except (version_service.ProjectNotFound, version_service.VersionNotFound) as exc:
        raise HTTPException(status_code=404, detail="Version not found") from exc
    except version_service.ProjectReadOnly as exc:
        raise HTTPException(status_code=403, detail="Project is read-only") from exc
    except version_service.DraftConflict as exc:
        raise HTTPException(status_code=409, detail="Draft changed; reload before restoring") from exc
