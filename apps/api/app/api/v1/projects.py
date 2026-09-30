from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models.auth import User
from app.schemas.projects import (
    CreateRevisionResponse,
    DraftSavedResponse,
    ProjectCreateRequest,
    ProjectMemberAddRequest,
    ProjectMemberResponse,
    ProjectMemberRoleUpdateRequest,
    ProjectSummaryResponse,
    ProjectUpdateRequest,
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


@router.put("/{project_id}", response_model=ProjectWorkspaceResponse)
def update_project(
    project_id: UUID,
    payload: ProjectUpdateRequest,
    db: SessionDep,
    user: CurrentUser,
) -> ProjectWorkspaceResponse:
    try:
        return project_service.update_project(db, user, project_id, payload)
    except project_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc
    except project_service.ProjectOwnerRequired as exc:
        raise HTTPException(status_code=403, detail="프로젝트 소유자만 이름과 설명을 바꿀 수 있습니다.") from exc


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: UUID, db: SessionDep, user: CurrentUser) -> Response:
    try:
        project_service.delete_project(db, user, project_id)
    except project_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except project_service.ProjectReadOnly as exc:
        raise HTTPException(status_code=403, detail="Only the project owner can delete this project") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/import", response_model=ProjectWorkspaceResponse, status_code=status.HTTP_201_CREATED)
async def import_project(
    request: Request,
    name: Annotated[str, Query(min_length=1, max_length=120)],
    db: SessionDep,
    user: CurrentUser,
) -> ProjectWorkspaceResponse:
    project_name = name.strip()
    if not project_name:
        raise HTTPException(status_code=422, detail="프로젝트 이름을 입력해 주세요.")
    if len(project_name) > 120:
        raise HTTPException(status_code=422, detail="프로젝트 이름은 120자 이하여야 합니다.")
    try:
        content_length = int(request.headers.get("content-length", "0"))
    except ValueError:
        content_length = 0
    if content_length > project_service.MAX_ARCHIVE_BYTES:
        raise HTTPException(status_code=413, detail="ZIP 파일은 1.5MB 이하여야 합니다.")
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > project_service.MAX_ARCHIVE_BYTES:
            raise HTTPException(status_code=413, detail="ZIP 파일은 1.5MB 이하여야 합니다.")
        chunks.append(chunk)
    try:
        return project_service.import_project_archive(
            db,
            user,
            ProjectCreateRequest(name=project_name, description="ZIP에서 가져온 프로젝트"),
            b"".join(chunks),
        )
    except project_service.InvalidProjectArchive as exc:
        raise HTTPException(
            status_code=422,
            detail="ZIP 파일이 손상되었거나 지원하지 않는 프로젝트 파일입니다. 안전한 UTF-8 텍스트 파일로 다시 압축해 주세요.",
        ) from exc
    except project_service.InvalidDraft as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/{project_id}", response_model=ProjectWorkspaceResponse)
def get_project(project_id: UUID, db: SessionDep, user: CurrentUser) -> ProjectWorkspaceResponse:
    try:
        return project_service.get_workspace(db, user, project_id)
    except project_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc


@router.get("/{project_id}/members", response_model=list[ProjectMemberResponse])
def list_project_members(project_id: UUID, db: SessionDep, user: CurrentUser) -> list[ProjectMemberResponse]:
    try:
        return project_service.list_project_members(db, user, project_id)
    except project_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc


@router.post(
    "/{project_id}/members",
    response_model=ProjectMemberResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_project_member(
    project_id: UUID,
    payload: ProjectMemberAddRequest,
    db: SessionDep,
    user: CurrentUser,
) -> ProjectMemberResponse:
    try:
        return project_service.add_project_member(db, user, project_id, payload)
    except project_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc
    except project_service.ProjectOwnerRequired as exc:
        raise HTTPException(status_code=403, detail="프로젝트 소유자만 팀원을 관리할 수 있습니다.") from exc
    except project_service.ProjectUserNotFound as exc:
        raise HTTPException(status_code=404, detail="해당 이메일로 가입한 WebLink 계정을 찾지 못했습니다.") from exc
    except project_service.ProjectMemberAlreadyExists as exc:
        raise HTTPException(status_code=409, detail="이미 이 프로젝트의 팀원입니다.") from exc


@router.delete("/{project_id}/members/{member_user_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_project_member(
    project_id: UUID,
    member_user_id: UUID,
    db: SessionDep,
    user: CurrentUser,
) -> Response:
    try:
        project_service.remove_project_member(db, user, project_id, member_user_id)
    except project_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc
    except project_service.ProjectOwnerRequired as exc:
        raise HTTPException(status_code=403, detail="프로젝트 소유자만 팀원을 관리할 수 있습니다.") from exc
    except project_service.ProjectMemberNotFound as exc:
        raise HTTPException(status_code=404, detail="팀원을 찾지 못했습니다.") from exc
    except project_service.ProjectOwnerCannotBeRemoved as exc:
        raise HTTPException(status_code=400, detail="프로젝트 소유자는 팀원에서 제외할 수 없습니다.") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{project_id}/members/{member_user_id}", response_model=ProjectMemberResponse)
def update_project_member_role(
    project_id: UUID,
    member_user_id: UUID,
    payload: ProjectMemberRoleUpdateRequest,
    db: SessionDep,
    user: CurrentUser,
) -> ProjectMemberResponse:
    try:
        return project_service.update_project_member_role(db, user, project_id, member_user_id, payload)
    except project_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc
    except project_service.ProjectOwnerRequired as exc:
        raise HTTPException(status_code=403, detail="프로젝트 소유자만 팀원 권한을 바꿀 수 있습니다.") from exc
    except project_service.ProjectMemberNotFound as exc:
        raise HTTPException(status_code=404, detail="팀원을 찾지 못했습니다.") from exc
    except project_service.ProjectOwnerCannotBeRemoved as exc:
        raise HTTPException(status_code=400, detail="프로젝트 소유자의 권한은 바꿀 수 없습니다.") from exc


@router.get("/{project_id}/export")
def export_project(project_id: UUID, db: SessionDep, user: CurrentUser) -> Response:
    try:
        content, filename = project_service.export_project_archive(db, user, project_id)
    except project_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    encoded_filename = quote(filename)
    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"},
    )


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
