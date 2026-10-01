import asyncio
import io
import zipfile
from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import SessionLocal, get_db
from app.models.auth import User
from app.models.projects import ProjectGitHubSource
from app.core.config import settings
from app.schemas.projects import (
    CreateRevisionResponse,
    DraftSavedResponse,
    ProjectCreateRequest,
    ProjectFileImportRequest,
    ProjectFilesImportRequest,
    ProjectMemberAddRequest,
    ProjectMemberResponse,
    ProjectMemberRoleUpdateRequest,
    ProjectInvitationCreateRequest,
    ProjectInvitationCreateResponse,
    ProjectInvitationResponse,
    ProjectInvitationAcceptRequest,
    ProjectInvitationAcceptResponse,
    ProjectTeamActivityResponse,
    ProjectSummaryResponse,
    ProjectUpdateRequest,
    ProjectWorkspaceResponse,
    ProjectGitHubSourceResponse,
    ProjectGitHubPullRequest,
    ProjectGitHubPullResponse,
    SaveDraftRequest,
)
from app.services import projects as project_service
from app.services.mail import send_project_invitation
from app.services.project_events import notify_project_change, project_event_hub
from app.services import github_connections as github_connection_service
from app.services import versions as version_service
from app.schemas.versions import ProjectVersionCreate, RuntimeSpec
from app.services import auth as auth_service
from app.repositories import projects as project_repository

router = APIRouter(prefix="/projects", tags=["projects"])
SessionDep = Annotated[Session, Depends(get_db)]


@router.websocket("/{project_id}/events")
async def project_change_events(websocket: WebSocket, project_id: UUID, db: SessionDep) -> None:
    origin = websocket.headers.get("origin")
    if origin not in settings.web_origins:
        await websocket.close(code=4403)
        return
    session_token = websocket.cookies.get("weblink_session")
    user = auth_service.get_session_user(db, session_token)
    if user is None:
        await websocket.close(code=4401)
        return
    project, role = project_repository.get_access(db, project_id, user.id)
    if project is None or role is None:
        await websocket.close(code=4403)
        return
    # Do not keep a database connection checked out for the lifetime of the socket.
    db.close()
    await websocket.accept()
    await project_event_hub.connect(project_id, websocket, str(user.id))
    try:
        while True:
            if await websocket.receive_text() == "ping":
                with SessionLocal() as access_db:
                    active_user = auth_service.get_session_user(access_db, session_token)
                    current_project, current_role = (
                        project_repository.get_access(access_db, project_id, user.id)
                        if active_user is not None
                        else (None, None)
                    )
                if current_project is None or current_role is None:
                    await websocket.close(code=4401 if active_user is None else 4403)
                    break
                await websocket.send_json({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        await project_event_hub.disconnect(project_id, websocket)
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
        updated = project_service.update_project(db, user, project_id, payload)
        notify_project_change(project_id, "project")
        return updated
    except project_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc
    except project_service.ProjectOwnerRequired as exc:
        raise HTTPException(status_code=403, detail="프로젝트 소유자만 이름과 설명을 바꿀 수 있습니다.") from exc


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: UUID, db: SessionDep, user: CurrentUser) -> Response:
    try:
        project_service.delete_project(db, user, project_id)
        notify_project_change(project_id, "project")
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


@router.post("/import/github", response_model=ProjectWorkspaceResponse, status_code=status.HTTP_201_CREATED)
async def import_github_project(
    repository_url: Annotated[str, Query(min_length=12, max_length=600)],
    name: Annotated[str, Query(min_length=1, max_length=120)],
    db: SessionDep,
    user: CurrentUser,
) -> ProjectWorkspaceResponse:
    project_name = name.strip()
    if not project_name:
        raise HTTPException(status_code=422, detail="프로젝트 이름을 입력해 주세요.")
    try:
        access_token = github_connection_service.get_access_token(db, user)
        archive = await asyncio.to_thread(project_service.download_github_archive, repository_url, access_token)
    except github_connection_service.GitHubConnectionUnavailable as exc:
        raise HTTPException(status_code=503, detail="저장된 GitHub 연결을 복호화하지 못했습니다. 연결 설정을 확인해 주세요.") from exc
    except project_service.GitHubRepositoryTooLarge as exc:
        raise HTTPException(status_code=413, detail="가져올 저장소 ZIP이 1.5MB를 넘습니다. 필요한 파일만 ZIP으로 내려받아 가져와 주세요.") from exc
    except project_service.GitHubRepositoryNotFound as exc:
        raise HTTPException(status_code=422, detail="저장소 주소와 권한을 확인해 주세요. 비공개 저장소는 연결 앱에서 해당 저장소의 Contents 읽기 권한이 있는 GitHub 토큰을 연결해야 합니다.") from exc
    try:
        imported = project_service.import_project_archive(
            db,
            user,
            ProjectCreateRequest(name=project_name, description="GitHub 저장소에서 가져온 프로젝트"),
            archive.content,
        )
        db.add(ProjectGitHubSource(
            project_id=imported.id,
            owner=archive.owner,
            repository=archive.repository,
            branch=archive.branch,
            is_private=archive.is_private,
            commit_sha=archive.commit_sha,
            linked_by=user.id,
        ))
        db.commit()
        return imported
    except project_service.InvalidProjectArchive as exc:
        raise HTTPException(status_code=422, detail="저장소 안에 지원하지 않는 파일이 있거나 UTF-8 텍스트 파일만으로 구성되지 않았습니다.") from exc
    except project_service.InvalidDraft as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/{project_id}/github", response_model=ProjectGitHubSourceResponse)
async def get_github_source_status(
    project_id: UUID,
    db: SessionDep,
    user: CurrentUser,
) -> ProjectGitHubSourceResponse:
    project, role = project_repository.get_access(db, project_id, user.id)
    if project is None or role is None:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.")
    source = db.get(ProjectGitHubSource, project_id)
    if source is None:
        return ProjectGitHubSourceResponse(connected=False)
    base = {
        "connected": True,
        "repository_url": f"https://github.com/{source.owner}/{source.repository}",
        "branch": source.branch,
        "is_private": source.is_private,
        "imported_sha": source.commit_sha,
    }
    try:
        access_token = github_connection_service.get_access_token(db, user)
        if not access_token and source.is_private:
            return ProjectGitHubSourceResponse(**base)
        base["token_connected"] = access_token is not None
        latest_sha = await asyncio.to_thread(
            project_service.latest_github_commit_sha,
            source.owner,
            source.repository,
            source.branch,
            access_token,
        )
    except github_connection_service.GitHubConnectionUnavailable as exc:
        raise HTTPException(status_code=503, detail="GitHub 토큰을 복호화하지 못했습니다. 연결 설정을 확인해 주세요.") from exc
    except project_service.GitHubRepositoryNotFound:
        return ProjectGitHubSourceResponse(**base, status_message="저장소 권한이나 브랜치를 확인해 주세요.")
    return ProjectGitHubSourceResponse(**base, latest_sha=latest_sha, update_available=latest_sha != source.commit_sha)


@router.post("/{project_id}/github/pull", response_model=ProjectGitHubPullResponse)
async def pull_github_source_updates(
    project_id: UUID,
    payload: ProjectGitHubPullRequest,
    db: SessionDep,
    user: CurrentUser,
) -> ProjectGitHubPullResponse:
    project, role = project_repository.get_access(db, project_id, user.id)
    if project is None or role is None:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.")
    if role not in {"OWNER", "EDITOR"}:
        raise HTTPException(status_code=403, detail="보기 전용 계정은 GitHub 변경 사항을 적용할 수 없습니다.")
    source = db.get(ProjectGitHubSource, project_id)
    if source is None:
        raise HTTPException(status_code=404, detail="이 프로젝트에는 연결된 GitHub 저장소가 없습니다.")
    draft = project_repository.get_draft(db, project_id)
    if draft is None or draft.version != payload.expected_draft_version:
        raise HTTPException(status_code=409, detail="초안이 다른 곳에서 변경됐습니다. 최신 내용을 확인한 뒤 다시 시도해 주세요.")
    try:
        access_token = github_connection_service.get_access_token(db, user)
        if not access_token and source.is_private:
            raise HTTPException(status_code=409, detail="연결 앱에서 GitHub 토큰을 먼저 연결해 주세요.")
        repository_url = f"https://github.com/{source.owner}/{source.repository}/tree/{quote(source.branch, safe='/')}"
        archive = await asyncio.to_thread(project_service.download_github_archive, repository_url, access_token)
        files = project_service.read_github_archive_files(archive.content)
    except github_connection_service.GitHubConnectionUnavailable as exc:
        raise HTTPException(status_code=503, detail="GitHub 토큰을 복호화하지 못했습니다. 연결 설정을 확인해 주세요.") from exc
    except project_service.GitHubRepositoryTooLarge as exc:
        raise HTTPException(status_code=413, detail="업데이트 저장소 ZIP이 1.5MB를 넘습니다.") from exc
    except project_service.GitHubRepositoryNotFound as exc:
        raise HTTPException(status_code=422, detail="GitHub 저장소에 접근할 수 없습니다. 토큰의 Contents 읽기 권한과 저장소 주소를 확인해 주세요.") from exc
    except project_service.InvalidProjectArchive as exc:
        raise HTTPException(status_code=422, detail="GitHub 변경 파일이 UTF-8 텍스트·1MB·50개 제한을 만족하지 않습니다.") from exc
    if archive.commit_sha == source.commit_sha:
        return ProjectGitHubPullResponse(workspace=project_service.get_workspace(db, user, project_id), imported_sha=source.commit_sha)
    existing_files = sorted(
        ({"path": file.path, "content": file.content} for file in project_repository.list_files(db, project_id)),
        key=lambda item: item["path"],
    )
    latest_files = sorted(({"path": file.path, "content": file.content} for file in files), key=lambda item: item["path"])
    backup_name: str | None = None
    if latest_files != existing_files:
        try:
            revision = project_service.create_revision(db, user, project_id).revision
            backup = version_service.save_version(
                db,
                user,
                project_id,
                ProjectVersionCreate(
                    revision_id=revision.id,
                    name=f"GitHub 업데이트 전 · {source.commit_sha[:7]}",
                    description=f"{source.owner}/{source.repository}의 {source.branch} 변경을 받기 전 자동 백업",
                    runtime_spec=RuntimeSpec(),
                ),
            )
            backup_name = backup.name
            project_service.save_draft(
                db,
                user,
                project_id,
                SaveDraftRequest(expected_version=payload.expected_draft_version, files=files),
            )
        except project_service.DraftConflict as exc:
            raise HTTPException(status_code=409, detail="초안이 다른 곳에서 변경됐습니다. 최신 내용을 다시 불러와 주세요.") from exc
        except project_service.InvalidDraft as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    source.commit_sha = archive.commit_sha
    db.commit()
    notify_project_change(project_id, "github")
    return ProjectGitHubPullResponse(
        workspace=project_service.get_workspace(db, user, project_id),
        imported_sha=archive.commit_sha,
        backup_version_name=backup_name,
    )


@router.post("/import/file", response_model=ProjectWorkspaceResponse, status_code=status.HTTP_201_CREATED)
def import_project_file(payload: ProjectFileImportRequest, db: SessionDep, user: CurrentUser) -> ProjectWorkspaceResponse:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="프로젝트 이름을 입력해 주세요.")
    archive_buffer = io.BytesIO()
    with zipfile.ZipFile(archive_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(payload.file.path, payload.file.content.encode("utf-8"))
    try:
        return project_service.import_project_archive(
            db,
            user,
            ProjectCreateRequest(name=name, description="Google Drive 파일에서 가져온 프로젝트"),
            archive_buffer.getvalue(),
        )
    except project_service.InvalidProjectArchive as exc:
        raise HTTPException(status_code=422, detail="가져올 파일 경로나 내용이 안전하지 않거나 지원하지 않습니다.") from exc
    except project_service.InvalidDraft as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/import/files", response_model=ProjectWorkspaceResponse, status_code=status.HTTP_201_CREATED)
def import_project_files(payload: ProjectFilesImportRequest, db: SessionDep, user: CurrentUser) -> ProjectWorkspaceResponse:
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="프로젝트 이름을 입력해 주세요.")
    archive_buffer = io.BytesIO()
    try:
        with zipfile.ZipFile(archive_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for file in payload.files:
                archive.writestr(file.path, file.content.encode("utf-8"))
        return project_service.import_project_archive(
            db, user,
            ProjectCreateRequest(name=name, description="Google Drive에서 가져온 프로젝트 파일"),
            archive_buffer.getvalue(),
        )
    except project_service.InvalidProjectArchive as exc:
        raise HTTPException(status_code=422, detail="파일 경로가 중복되었거나 안전하지 않은 파일이 포함되어 있습니다.") from exc
    except project_service.InvalidDraft as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/invitations/accept", response_model=ProjectInvitationAcceptResponse)
def accept_project_invitation(payload: ProjectInvitationAcceptRequest, db: SessionDep, user: CurrentUser) -> ProjectInvitationAcceptResponse:
    try:
        accepted = project_service.accept_project_invitation(db, user, payload.token)
        notify_project_change(accepted.project_id, "team")
        return accepted
    except project_service.ProjectInvitationNotFound as exc:
        raise HTTPException(status_code=404, detail="초대 링크가 만료되었거나 이미 사용됐습니다.") from exc
    except project_service.ProjectInvitationEmailMismatch as exc:
        raise HTTPException(status_code=403, detail="초대를 받은 이메일 계정으로 로그인한 뒤 수락해 주세요.") from exc


@router.post("/{project_id}/invitations", response_model=ProjectInvitationCreateResponse, status_code=status.HTTP_201_CREATED)
def create_project_invitation(project_id: UUID, payload: ProjectInvitationCreateRequest, db: SessionDep, user: CurrentUser) -> ProjectInvitationCreateResponse:
    try:
        invitation = project_service.create_project_invitation(db, user, project_id, payload)
        notify_project_change(project_id, "team")
        try:
            email_sent = send_project_invitation(
                email=invitation.email,
                project_name=invitation.project_name,
                inviter_name=user.display_name or user.email,
                token=invitation.token,
                role=payload.role,
            )
        except Exception:
            email_sent = False
            invitation.email_status = "failed"
        else:
            invitation.email_status = "sent" if email_sent else "not_configured"
        return invitation
    except project_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc
    except project_service.ProjectOwnerRequired as exc:
        raise HTTPException(status_code=403, detail="프로젝트 소유자만 초대할 수 있습니다.") from exc
    except project_service.ProjectMemberAlreadyExists as exc:
        raise HTTPException(status_code=409, detail="이미 이 프로젝트의 팀원입니다.") from exc
    except project_service.ProjectInvitationAlreadyExists as exc:
        raise HTTPException(status_code=409, detail="해당 이메일의 초대가 이미 발급됐습니다. 초대 목록을 새로고침한 뒤 확인해 주세요.") from exc


@router.get("/{project_id}/invitations", response_model=list[ProjectInvitationResponse])
def list_project_invitations(project_id: UUID, db: SessionDep, user: CurrentUser) -> list[ProjectInvitationResponse]:
    try:
        return project_service.list_project_invitations(db, user, project_id)
    except project_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc
    except project_service.ProjectOwnerRequired as exc:
        raise HTTPException(status_code=403, detail="프로젝트 소유자만 초대를 관리할 수 있습니다.") from exc


@router.delete("/{project_id}/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_project_invitation(project_id: UUID, invitation_id: UUID, db: SessionDep, user: CurrentUser) -> Response:
    try:
        project_service.revoke_project_invitation(db, user, project_id, invitation_id)
        notify_project_change(project_id, "team")
    except project_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc
    except project_service.ProjectOwnerRequired as exc:
        raise HTTPException(status_code=403, detail="프로젝트 소유자만 초대를 취소할 수 있습니다.") from exc
    except project_service.ProjectInvitationNotFound as exc:
        raise HTTPException(status_code=404, detail="초대가 이미 삭제됐거나 존재하지 않습니다.") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


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


@router.get("/{project_id}/team-activity", response_model=list[ProjectTeamActivityResponse])
def list_project_team_activity(project_id: UUID, db: SessionDep, user: CurrentUser) -> list[ProjectTeamActivityResponse]:
    try:
        return project_service.list_project_team_activity(db, user, project_id)
    except project_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc


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
        member = project_service.add_project_member(db, user, project_id, payload)
        notify_project_change(project_id, "team")
        return member
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
        notify_project_change(project_id, "team")
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
        member = project_service.update_project_member_role(db, user, project_id, member_user_id, payload)
        notify_project_change(project_id, "team")
        return member
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
        saved = project_service.save_draft(db, user, project_id, payload)
        if saved.draft_version > payload.expected_version:
            notify_project_change(project_id, "draft")
        return saved
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
