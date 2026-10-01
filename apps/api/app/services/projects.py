import hashlib
import io
import json
import re
import secrets
import stat
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib
from dataclasses import dataclass
from pathlib import PurePosixPath
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.auth import User
from app.models.debugging import DebugSession
from app.models.execution import ExecutionSnapshot, Job, ProjectStorageCleanup, Run
from app.models.projects import (
    Project,
    ProjectDraft,
    ProjectFile,
    ProjectInvitation,
    ProjectMember,
    ProjectRevision,
    ProjectTeamActivity,
    ProjectVersion,
)
from app.models.tasks import ProjectTask, ProjectTaskActivity
from app.repositories import projects as repository
from app.schemas.projects import (
    CreateRevisionResponse,
    DraftSavedResponse,
    ProjectCreateRequest,
    ProjectFileInput,
    ProjectFileResponse,
    ProjectMemberAddRequest,
    ProjectMemberResponse,
    ProjectMemberRoleUpdateRequest,
    ProjectInvitationCreateRequest,
    ProjectInvitationCreateResponse,
    ProjectInvitationResponse,
    ProjectInvitationAcceptResponse,
    ProjectTeamActivityResponse,
    ProjectRevisionResponse,
    ProjectSummaryResponse,
    ProjectWorkspaceResponse,
    ProjectUpdateRequest,
    SaveDraftRequest,
)

MAX_DRAFT_BYTES = 1_000_000
MAX_ARCHIVE_BYTES = 1_500_000
STARTER_FILES = [
    {"path": "README.md", "content": "# My WebLink Project\n\n내가 만들고 싶은 것을 여기에 적어 보세요.\n"},
    {"path": "main.py", "content": 'print("Hello from WebLink!")\n'},
]


class ProjectNotFound(Exception):
    pass


class ProjectReadOnly(Exception):
    pass


class DraftConflict(Exception):
    pass


class InvalidDraft(Exception):
    pass


class InvalidProjectArchive(Exception):
    pass


class GitHubRepositoryNotFound(Exception):
    pass


class GitHubRepositoryTooLarge(Exception):
    pass


@dataclass(frozen=True)
class GitHubArchive:
    content: bytes
    owner: str
    repository: str
    branch: str
    commit_sha: str
    is_private: bool


class _GithubRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        target = urllib.parse.urlsplit(newurl)
        if target.scheme != "https" or target.hostname not in {"api.github.com", "codeload.github.com"}:
            raise urllib.error.HTTPError(newurl, code, "Unexpected GitHub archive redirect", headers, fp)
        if target.hostname != urllib.parse.urlsplit(req.full_url).hostname:
            req.remove_header("Authorization")
            req.unredirected_hdrs.pop("Authorization", None)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download_github_archive(repository_url: str, access_token: str | None = None) -> GitHubArchive:
    parsed = urllib.parse.urlsplit(repository_url.strip())
    parts = [part for part in parsed.path.split("/") if part]
    if parsed.scheme != "https" or parsed.hostname != "github.com" or parsed.query or parsed.fragment or len(parts) < 2:
        raise GitHubRepositoryNotFound
    owner, repository = parts[0], parts[1].removesuffix(".git")
    safe_segment = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
    if not safe_segment.fullmatch(owner) or not safe_segment.fullmatch(repository):
        raise GitHubRepositoryNotFound
    branch: str | None = None
    if len(parts) > 2:
        if len(parts) < 4 or parts[2] != "tree":
            raise GitHubRepositoryNotFound
        branch = "/".join(parts[3:])
        if len(branch) > 300 or any(part in {".", ".."} or not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", part) for part in branch.split("/")):
            raise GitHubRepositoryNotFound

    opener = urllib.request.build_opener(_GithubRedirectHandler())
    headers = {"User-Agent": "WebLink-Project-Importer", "Accept": "application/vnd.github+json"}
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    metadata_url = f"https://api.github.com/repos/{urllib.parse.quote(owner)}/{urllib.parse.quote(repository)}"
    try:
        request = urllib.request.Request(metadata_url, headers=headers)
        with opener.open(request, timeout=12) as response:
            metadata = json.loads(response.read(65_537))
        if not isinstance(metadata, dict) or (metadata.get("private") is True and not access_token):
            raise GitHubRepositoryNotFound
        is_private = metadata.get("private") is True
        default_branch = metadata.get("default_branch")
        if branch is None:
            if not isinstance(default_branch, str) or not default_branch:
                raise GitHubRepositoryNotFound
            branch = default_branch
        commit_sha = latest_github_commit_sha(owner, repository, branch, access_token)
        branch_path = urllib.parse.quote(commit_sha, safe="")
        archive_url = f"https://api.github.com/repos/{urllib.parse.quote(owner)}/{urllib.parse.quote(repository)}/zipball/{branch_path}"
        request = urllib.request.Request(archive_url, headers=headers)
        with opener.open(request, timeout=20) as response:
            final_url = urllib.parse.urlsplit(response.geturl())
            if final_url.scheme != "https" or final_url.hostname not in {"api.github.com", "codeload.github.com"}:
                raise GitHubRepositoryNotFound
            length = response.headers.get("Content-Length")
            if length and int(length) > MAX_ARCHIVE_BYTES:
                raise GitHubRepositoryTooLarge
            archive = response.read(MAX_ARCHIVE_BYTES + 1)
        if len(archive) > MAX_ARCHIVE_BYTES:
            raise GitHubRepositoryTooLarge
        return GitHubArchive(archive, owner, repository, branch, commit_sha, is_private)
    except GitHubRepositoryTooLarge:
        raise
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        if isinstance(exc, urllib.error.HTTPError) and exc.code in (404, 422):
            raise GitHubRepositoryNotFound from exc
        if isinstance(exc, urllib.error.HTTPError) and exc.code == 410:
            raise GitHubRepositoryNotFound from exc
        raise GitHubRepositoryNotFound from exc


def latest_github_commit_sha(owner: str, repository: str, branch: str, access_token: str | None = None) -> str:
    headers = {
        "User-Agent": "WebLink-Project-Importer",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"
    url = (
        f"https://api.github.com/repos/{urllib.parse.quote(owner)}/"
        f"{urllib.parse.quote(repository)}/commits/{urllib.parse.quote(branch, safe='/')}"
    )
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=12) as response:
            payload = json.loads(response.read(65_537))
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
        raise GitHubRepositoryNotFound from exc
    sha = payload.get("sha") if isinstance(payload, dict) else None
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-fA-F]{40}", sha):
        raise GitHubRepositoryNotFound
    return sha


class ProjectMemberNotFound(Exception):
    pass


class ProjectMemberAlreadyExists(Exception):
    pass


class ProjectUserNotFound(Exception):
    pass


class ProjectOwnerRequired(Exception):
    pass


class ProjectOwnerCannotBeRemoved(Exception):
    pass


class ProjectInvitationNotFound(Exception):
    pass


class ProjectInvitationEmailMismatch(Exception):
    pass


class ProjectInvitationAlreadyExists(Exception):
    pass


def _record_team_activity(db: Session, project_id: UUID, user: User, message: str) -> None:
    db.add(ProjectTeamActivity(
        project_id=project_id,
        actor_id=user.id,
        actor_name=(user.display_name or user.email)[:120],
        message=message[:240],
    ))


def list_project_team_activity(db: Session, user: User, project_id: UUID) -> list[ProjectTeamActivityResponse]:
    project, role = repository.get_access(db, project_id, user.id)
    if project is None or role is None:
        raise ProjectNotFound
    entries = db.query(ProjectTeamActivity).filter(
        ProjectTeamActivity.project_id == project_id,
    ).order_by(ProjectTeamActivity.created_at.desc(), ProjectTeamActivity.id.desc()).limit(100).all()
    return [ProjectTeamActivityResponse.model_validate(entry) for entry in entries]


def create_project_invitation(db: Session, user: User, project_id: UUID, payload: ProjectInvitationCreateRequest) -> ProjectInvitationCreateResponse:
    project, role = repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    if role != "OWNER" or project.owner_id != user.id:
        raise ProjectOwnerRequired
    invited_user = repository.find_active_user_by_email(db, payload.email)
    if invited_user and repository.get_member(db, project_id, invited_user.id):
        raise ProjectMemberAlreadyExists
    existing_invitation = db.query(ProjectInvitation).filter(
        ProjectInvitation.project_id == project_id,
        ProjectInvitation.email == payload.email,
    ).first()
    if existing_invitation:
        db.query(ProjectInvitation).filter(
            ProjectInvitation.project_id == project_id,
            ProjectInvitation.email == payload.email,
        ).delete(synchronize_session=False)
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    db.add(ProjectInvitation(project_id=project_id, email=payload.email, role=payload.role,
        token_hash=hashlib.sha256(token.encode()).hexdigest(), invited_by=user.id, expires_at=expires_at))
    role_name = "편집" if payload.role == "EDITOR" else "보기 전용"
    action = "초대 링크를 다시 발급했습니다" if existing_invitation else "초대 링크를 만들었습니다"
    _record_team_activity(db, project_id, user, f"{payload.email}님에게 {role_name} 권한 {action}.")
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        constraint_name = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        if constraint_name == "uq_project_invitations_project_email":
            raise ProjectInvitationAlreadyExists from exc
        raise
    return ProjectInvitationCreateResponse(token=token, email=payload.email, project_name=project.name, expires_at=expires_at)


def list_project_invitations(db: Session, user: User, project_id: UUID) -> list[ProjectInvitationResponse]:
    project, role = repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    if role != "OWNER" or project.owner_id != user.id:
        raise ProjectOwnerRequired
    now = datetime.now(timezone.utc)
    invitations = db.query(ProjectInvitation).filter(ProjectInvitation.project_id == project_id).order_by(ProjectInvitation.created_at.desc()).all()
    result: list[ProjectInvitationResponse] = []
    for invitation in invitations:
        expires_at = invitation.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        created_at = invitation.created_at or now
        result.append(ProjectInvitationResponse(
            id=invitation.id,
            email=invitation.email,
            role=invitation.role,
            expires_at=expires_at,
            created_at=created_at,
            status="PENDING" if expires_at > now else "EXPIRED",
        ))
    return result


def revoke_project_invitation(db: Session, user: User, project_id: UUID, invitation_id: UUID) -> None:
    project, role = repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    if role != "OWNER" or project.owner_id != user.id:
        raise ProjectOwnerRequired
    invitation = db.query(ProjectInvitation).filter(
        ProjectInvitation.id == invitation_id,
        ProjectInvitation.project_id == project_id,
    ).first()
    if invitation is None:
        raise ProjectInvitationNotFound
    expires_at = invitation.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at > datetime.now(timezone.utc):
        _record_team_activity(db, project_id, user, f"{invitation.email}님에게 보낸 초대를 취소했습니다.")
    db.delete(invitation)
    db.commit()


def accept_project_invitation(db: Session, user: User, token: str) -> ProjectInvitationAcceptResponse:
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    invitation = db.query(ProjectInvitation).filter(ProjectInvitation.token_hash == token_hash).with_for_update().first()
    if invitation is None:
        raise ProjectInvitationNotFound
    expires_at = invitation.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        db.delete(invitation)
        db.commit()
        raise ProjectInvitationNotFound
    if user.email.strip().lower() != invitation.email:
        raise ProjectInvitationEmailMismatch
    project = db.get(Project, invitation.project_id)
    if project is None:
        db.delete(invitation)
        db.commit()
        raise ProjectInvitationNotFound
    if repository.get_member(db, project.id, user.id) is None:
        db.add(ProjectMember(project_id=project.id, user_id=user.id, role=invitation.role))
        role_name = "편집자" if invitation.role == "EDITOR" else "보기 전용"
        _record_team_activity(db, project.id, user, f"초대를 수락하고 {role_name}(으)로 참여했습니다.")
    db.delete(invitation)
    db.commit()
    return ProjectInvitationAcceptResponse(project_id=project.id, project_name=project.name)


def delete_project(db: Session, user: User, project_id: UUID) -> None:
    project, role = repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    if role != "OWNER" or project.owner_id != user.id:
        raise ProjectReadOnly

    db.add(ProjectStorageCleanup(project_id=project_id))
    run_ids = db.query(Run.id).filter(Run.project_id == project_id).subquery()
    db.query(Job).filter(Job.run_id.in_(run_ids)).delete(synchronize_session=False)
    db.query(DebugSession).filter(DebugSession.project_id == project_id).delete(synchronize_session=False)
    db.query(Run).filter(Run.project_id == project_id).delete(synchronize_session=False)
    db.query(ProjectVersion).filter(ProjectVersion.project_id == project_id).delete(synchronize_session=False)
    db.query(ProjectTask).filter(ProjectTask.project_id == project_id).delete(synchronize_session=False)
    db.query(ExecutionSnapshot).filter(ExecutionSnapshot.project_id == project_id).delete(synchronize_session=False)
    db.query(ProjectRevision).filter(ProjectRevision.project_id == project_id).delete(synchronize_session=False)
    db.query(ProjectFile).filter(ProjectFile.project_id == project_id).delete(synchronize_session=False)
    db.query(ProjectDraft).filter(ProjectDraft.project_id == project_id).delete(synchronize_session=False)
    db.query(ProjectMember).filter(ProjectMember.project_id == project_id).delete(synchronize_session=False)
    db.delete(project)
    db.commit()


def _is_sensitive_project_file(path: str) -> bool:
    filename = PurePosixPath(path).name.lower()
    return (
        filename == ".env"
        or (filename.startswith(".env.") and filename != ".env.example")
        or filename in {"id_rsa", "id_ed25519", "credentials.json", "service-account.json"}
        or filename.endswith((".pem", ".key", ".p12", ".pfx"))
    )


def list_projects(db: Session, user: User) -> list[ProjectSummaryResponse]:
    return [
        ProjectSummaryResponse(
            id=project.id,
            name=project.name,
            description=project.description,
            draft_version=draft.version,
            updated_at=project.updated_at,
            role=role,
        )
        for project, draft, role in repository.list_for_user(db, user.id)
    ]


def create_project(db: Session, user: User, payload: ProjectCreateRequest) -> ProjectWorkspaceResponse:
    project = Project(owner_id=user.id, name=payload.name, description=payload.description)
    repository.add_project(db, project)
    db.flush()
    db.add_all(
        [
            ProjectMember(project_id=project.id, user_id=user.id, role="OWNER"),
            ProjectDraft(project_id=project.id, updated_by=user.id, version=0),
        ]
    )
    repository.replace_files(db, project.id, STARTER_FILES)
    repository.save(db)
    return get_workspace(db, user, project.id)


def update_project(
    db: Session, user: User, project_id: UUID, payload: ProjectUpdateRequest
) -> ProjectWorkspaceResponse:
    project, role = repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    if role != "OWNER" or project.owner_id != user.id:
        raise ProjectOwnerRequired
    project.name = payload.name
    project.description = payload.description
    repository.save(db)
    db.refresh(project)
    return get_workspace(db, user, project_id)


def get_workspace(db: Session, user: User, project_id: UUID) -> ProjectWorkspaceResponse:
    project, role = repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    draft = repository.get_draft(db, project.id)
    if draft is None:
        raise ProjectNotFound
    return ProjectWorkspaceResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        draft_version=draft.version,
        updated_at=project.updated_at,
        role=role,
        files=[ProjectFileResponse(path=file.path, content=file.content) for file in repository.list_files(db, project.id)],
        revisions=[ProjectRevisionResponse.model_validate(revision) for revision in repository.list_revisions(db, project.id)],
    )


def _member_response(member: ProjectMember, user: User) -> ProjectMemberResponse:
    return ProjectMemberResponse(
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=member.role,
        created_at=member.created_at,
    )


def list_project_members(db: Session, user: User, project_id: UUID) -> list[ProjectMemberResponse]:
    project, _role = repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    return [_member_response(member, member_user) for member, member_user in repository.list_members(db, project_id)]


def add_project_member(
    db: Session,
    user: User,
    project_id: UUID,
    payload: ProjectMemberAddRequest,
) -> ProjectMemberResponse:
    project, role = repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    if role != 'OWNER' or project.owner_id != user.id:
        raise ProjectOwnerRequired
    member_user = repository.find_active_user_by_email(db, payload.email)
    if member_user is None:
        raise ProjectUserNotFound
    if repository.get_member(db, project_id, member_user.id) is not None:
        raise ProjectMemberAlreadyExists
    member = ProjectMember(project_id=project_id, user_id=member_user.id, role=payload.role)
    db.add(member)
    role_name = "편집자" if payload.role == "EDITOR" else "보기 전용"
    _record_team_activity(db, project_id, user, f"{member_user.display_name or member_user.email}님을 {role_name}로 추가했습니다.")
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ProjectMemberAlreadyExists from exc
    db.refresh(member)
    return _member_response(member, member_user)


def remove_project_member(db: Session, user: User, project_id: UUID, member_user_id: UUID) -> None:
    project, role = repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    if role != 'OWNER' or project.owner_id != user.id:
        raise ProjectOwnerRequired
    member = repository.get_member(db, project_id, member_user_id)
    if member is None:
        raise ProjectMemberNotFound
    if member.role == 'OWNER' or member.user_id == project.owner_id:
        raise ProjectOwnerCannotBeRemoved
    member_user = db.get(User, member_user_id)
    member_name = (member_user.display_name or member_user.email) if member_user else "팀원"
    assigned_tasks = db.query(ProjectTask).filter(
        ProjectTask.project_id == project_id,
        ProjectTask.assignee_id == member_user_id,
    ).all()
    for task in assigned_tasks:
        task.assignee_id = None
        task.updated_by = user.id
        db.add(ProjectTaskActivity(task_id=task.id, actor_id=user.id, message="팀원 제외로 담당자가 해제됐습니다."))
    _record_team_activity(db, project_id, user, f"{member_name}님을 팀에서 제외했습니다.")
    db.delete(member)
    db.commit()


def update_project_member_role(
    db: Session,
    user: User,
    project_id: UUID,
    member_user_id: UUID,
    payload: ProjectMemberRoleUpdateRequest,
) -> ProjectMemberResponse:
    project, role = repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    if role != "OWNER" or project.owner_id != user.id:
        raise ProjectOwnerRequired
    member = repository.get_member(db, project_id, member_user_id)
    if member is None:
        raise ProjectMemberNotFound
    if member.role == "OWNER" or member.user_id == project.owner_id:
        raise ProjectOwnerCannotBeRemoved
    if member.role == payload.role:
        member_user = db.get(User, member_user_id)
        if member_user is None:
            raise ProjectMemberNotFound
        return _member_response(member, member_user)
    previous_role = member.role
    member.role = payload.role
    member_user = db.get(User, member_user_id)
    member_name = (member_user.display_name or member_user.email) if member_user else "팀원"
    old_role_name = "편집자" if previous_role == "EDITOR" else "보기 전용"
    new_role_name = "편집자" if payload.role == "EDITOR" else "보기 전용"
    _record_team_activity(db, project_id, user, f"{member_name}님의 권한을 {old_role_name}에서 {new_role_name}(으)로 변경했습니다.")
    db.commit()
    db.refresh(member)
    if member_user is None:
        raise ProjectMemberNotFound
    return _member_response(member, member_user)


def export_project_archive(db: Session, user: User, project_id: UUID) -> tuple[bytes, str]:
    workspace = get_workspace(db, user, project_id)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file in workspace.files:
            if _is_sensitive_project_file(file.path):
                continue
            archive.writestr(file.path, file.content.encode("utf-8"))

    safe_name = unicodedata.normalize("NFKC", workspace.name)
    safe_name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", safe_name).strip(" .")
    if not safe_name:
        safe_name = "weblink-project"
    return buffer.getvalue(), f"{safe_name[:100]}.zip"


def _read_project_archive(archive_data: bytes) -> list[ProjectFileInput]:
    if not archive_data or len(archive_data) > MAX_ARCHIVE_BYTES:
        raise InvalidProjectArchive
    try:
        archive = zipfile.ZipFile(io.BytesIO(archive_data), mode="r")
    except (zipfile.BadZipFile, OSError, EOFError) as exc:
        raise InvalidProjectArchive from exc

    files: list[ProjectFileInput] = []
    seen_paths: set[str] = set()
    total_bytes = 0
    with archive:
        entries = archive.infolist()
        if not entries or len(entries) > 200:
            raise InvalidProjectArchive
        for info in entries:
            raw_path = info.filename
            normalized_path = raw_path.replace("\\", "/")
            path_parts = normalized_path.rstrip("/").split("/")
            if (
                not normalized_path
                or normalized_path.startswith("/")
                or re.match(r"^[A-Za-z]:", normalized_path)
                or any(part in {"", ".", ".."} for part in path_parts)
            ):
                raise InvalidProjectArchive
            if info.is_dir():
                continue
            if info.flag_bits & 0x1:
                raise InvalidProjectArchive
            member_type = stat.S_IFMT(info.external_attr >> 16)
            if member_type not in {0, stat.S_IFREG}:
                raise InvalidProjectArchive
            if info.file_size < 0 or info.file_size > MAX_DRAFT_BYTES:
                raise InvalidProjectArchive
            try:
                validated_path = ProjectFileInput(path=raw_path, content="").path
            except ValueError as exc:
                raise InvalidProjectArchive from exc
            path_key = unicodedata.normalize("NFC", validated_path).casefold()
            if path_key in seen_paths:
                raise InvalidProjectArchive
            seen_paths.add(path_key)
            if _is_sensitive_project_file(validated_path):
                continue

            content_chunks: list[bytes] = []
            remaining = MAX_DRAFT_BYTES - total_bytes
            try:
                with archive.open(info, mode="r") as source:
                    while True:
                        chunk = source.read(min(64 * 1024, remaining + 1))
                        if not chunk:
                            break
                        remaining -= len(chunk)
                        if remaining < 0:
                            raise InvalidProjectArchive
                        content_chunks.append(chunk)
            except (zipfile.BadZipFile, OSError, EOFError, RuntimeError, NotImplementedError, zlib.error) as exc:
                raise InvalidProjectArchive from exc
            content_bytes = b"".join(content_chunks)
            try:
                content = content_bytes.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise InvalidProjectArchive from exc
            total_bytes += len(content_bytes)
            files.append(ProjectFileInput(path=validated_path, content=content))
            if len(files) > 50:
                raise InvalidProjectArchive

    if not files:
        raise InvalidProjectArchive
    return files


def read_github_archive_files(archive_data: bytes) -> list[ProjectFileInput]:
    files = _read_project_archive(archive_data)
    if len(files) > 50:
        raise InvalidProjectArchive
    _validate_files(files)
    return files


def import_project_archive(
    db: Session,
    user: User,
    payload: ProjectCreateRequest,
    archive_data: bytes,
) -> ProjectWorkspaceResponse:
    files = _validate_files(_read_project_archive(archive_data))
    project = Project(owner_id=user.id, name=payload.name, description=payload.description)
    try:
        repository.add_project(db, project)
        db.flush()
        db.add_all(
            [
                ProjectMember(project_id=project.id, user_id=user.id, role="OWNER"),
                ProjectDraft(project_id=project.id, updated_by=user.id, version=0),
            ]
        )
        repository.replace_files(db, project.id, files)
        snapshot = sorted(files, key=lambda file: file["path"])
        source_hash = hashlib.sha256(
            json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        db.add(
            ProjectRevision(
                project_id=project.id,
                revision_number=1,
                parent_revision_id=None,
                source_hash=source_hash,
                snapshot=snapshot,
                created_by=user.id,
            )
        )
        repository.save(db)
        return get_workspace(db, user, project.id)
    except Exception:
        db.rollback()
        raise


def _validate_files(files: list[ProjectFileInput]) -> list[dict[str, str]]:
    paths = [file.path for file in files]
    if len(paths) != len(set(paths)):
        raise InvalidDraft("A draft cannot contain duplicate file paths")
    if sum(len(file.content.encode("utf-8")) for file in files) > MAX_DRAFT_BYTES:
        raise InvalidDraft("A draft cannot exceed 1 MB")
    return [{"path": file.path, "content": file.content} for file in files]


def save_draft(
    db: Session,
    user: User,
    project_id: UUID,
    payload: SaveDraftRequest,
) -> DraftSavedResponse:
    project, role = repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    if role not in {"OWNER", "EDITOR"}:
        raise ProjectReadOnly
    draft = repository.get_draft(db, project_id)
    if draft is None:
        raise ProjectNotFound
    files = _validate_files(payload.files)
    existing_files = sorted([
        {"path": file.path, "content": file.content}
        for file in repository.list_files(db, project_id)
    ], key=lambda file: file["path"])
    files.sort(key=lambda file: file["path"])
    if files == existing_files:
        return DraftSavedResponse(
            project_id=project_id,
            draft_version=draft.version,
            updated_at=project.updated_at,
        )
    if not repository.advance_draft(db, project_id, payload.expected_version, user.id):
        db.rollback()
        raise DraftConflict
    repository.replace_files(db, project_id, files)
    repository.touch_project(db, project_id)
    repository.save(db)
    db.refresh(project)
    return DraftSavedResponse(
        project_id=project_id,
        draft_version=payload.expected_version + 1,
        updated_at=project.updated_at,
    )


def create_revision(db: Session, user: User, project_id: UUID) -> CreateRevisionResponse:
    project, role = repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    if role not in {"OWNER", "EDITOR"}:
        raise ProjectReadOnly
    files = repository.list_files(db, project_id)
    snapshot = [{"path": file.path, "content": file.content} for file in files]
    source_hash = hashlib.sha256(
        json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    latest = repository.get_latest_revision(db, project_id)
    if latest and latest.source_hash == source_hash:
        return CreateRevisionResponse(revision=ProjectRevisionResponse.model_validate(latest), created=False)
    revision = ProjectRevision(
        project_id=project_id,
        revision_number=latest.revision_number + 1 if latest else 1,
        parent_revision_id=latest.id if latest else None,
        source_hash=source_hash,
        snapshot=snapshot,
        created_by=user.id,
    )
    db.add(revision)
    repository.save(db)
    db.refresh(revision)
    return CreateRevisionResponse(revision=ProjectRevisionResponse.model_validate(revision), created=True)
