import hashlib
import io
import json
import re
import stat
import unicodedata
import zipfile
import zlib
from pathlib import PurePosixPath
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.auth import User
from app.models.debugging import DebugSession
from app.models.execution import ExecutionSnapshot, Job, ProjectStorageCleanup, Run
from app.models.projects import (
    Project,
    ProjectDraft,
    ProjectFile,
    ProjectMember,
    ProjectRevision,
    ProjectVersion,
)
from app.repositories import projects as repository
from app.schemas.projects import (
    CreateRevisionResponse,
    DraftSavedResponse,
    ProjectCreateRequest,
    ProjectFileInput,
    ProjectFileResponse,
    ProjectRevisionResponse,
    ProjectSummaryResponse,
    ProjectWorkspaceResponse,
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
        )
        for project, draft in repository.list_for_user(db, user.id)
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


def get_workspace(db: Session, user: User, project_id: UUID) -> ProjectWorkspaceResponse:
    project, _ = repository.get_access(db, project_id, user.id)
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
        files=[ProjectFileResponse(path=file.path, content=file.content) for file in repository.list_files(db, project.id)],
        revisions=[ProjectRevisionResponse.model_validate(revision) for revision in repository.list_revisions(db, project.id)],
    )


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
