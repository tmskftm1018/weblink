import hashlib
import json
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.auth import User
from app.models.projects import Project, ProjectDraft, ProjectMember, ProjectRevision
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
