from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.auth import User
from app.models.projects import Project, ProjectRevision, ProjectVersion
from app.repositories import projects as repository
from app.schemas.versions import (
    ProjectVersionCreate,
    ProjectVersionDetailResponse,
    ProjectVersionResponse,
    VersionRestoreResponse,
)


class ProjectNotFound(Exception):
    pass


class RevisionNotFound(Exception):
    pass


class VersionNotFound(Exception):
    pass


def get_version(
    db: Session, user: User, project_id: UUID, version_id: UUID
) -> ProjectVersionDetailResponse:
    project, _role = repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    version = db.scalar(select(ProjectVersion).where(
        ProjectVersion.project_id == project_id, ProjectVersion.id == version_id
    ))
    if version is None:
        raise VersionNotFound
    revision = db.get(ProjectRevision, version.source_revision_id)
    if revision is None:
        raise VersionNotFound
    return ProjectVersionDetailResponse(
        **ProjectVersionResponse.model_validate(version).model_dump(), files=revision.snapshot
    )


class ProjectReadOnly(Exception):
    pass


class DraftConflict(Exception):
    pass


def list_versions(db: Session, user: User, project_id: UUID) -> list[ProjectVersionResponse]:
    project, _role = repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    versions = db.scalars(
        select(ProjectVersion).where(ProjectVersion.project_id == project_id)
        .order_by(ProjectVersion.version_number.desc())
    )
    return [ProjectVersionResponse.model_validate(version) for version in versions]


def save_version(
    db: Session, user: User, project_id: UUID, payload: ProjectVersionCreate
) -> ProjectVersionResponse:
    project, role = repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    if role not in {"OWNER", "EDITOR"}:
        raise ProjectReadOnly
    revision = db.scalar(select(ProjectRevision).where(
        ProjectRevision.id == payload.revision_id,
        ProjectRevision.project_id == project_id,
    ))
    if revision is None:
        raise RevisionNotFound
    # Serialize per-project numbering under a row lock; the unique constraint is the final guard.
    db.scalar(select(Project).where(Project.id == project_id).with_for_update())
    same_snapshot = db.scalar(
        select(ProjectVersion)
        .where(
            ProjectVersion.project_id == project_id,
            ProjectVersion.source_revision_id == revision.id,
        )
        .order_by(ProjectVersion.version_number.desc())
        .limit(1)
    )
    if same_snapshot is not None:
        return ProjectVersionResponse.model_validate(same_snapshot)
    latest_number = db.scalar(
        select(func.max(ProjectVersion.version_number)).where(ProjectVersion.project_id == project_id)
    ) or 0
    version = ProjectVersion(
        project_id=project_id,
        version_number=latest_number + 1,
        source_revision_id=revision.id,
        name=payload.name.strip(),
        description=payload.description,
        runtime_spec=payload.runtime_spec.model_dump(),
        created_by=user.id,
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return ProjectVersionResponse.model_validate(version)


def delete_version(db: Session, user: User, project_id: UUID, version_id: UUID) -> None:
    project, role = repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    if role not in {"OWNER", "EDITOR"}:
        raise ProjectReadOnly
    version = db.scalar(select(ProjectVersion).where(
        ProjectVersion.project_id == project_id, ProjectVersion.id == version_id
    ))
    if version is None:
        raise VersionNotFound
    db.delete(version)
    db.commit()


def restore_version(
    db: Session, user: User, project_id: UUID, version_id: UUID
) -> VersionRestoreResponse:
    project, role = repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    if role not in {"OWNER", "EDITOR"}:
        raise ProjectReadOnly
    version = db.scalar(select(ProjectVersion).where(
        ProjectVersion.project_id == project_id, ProjectVersion.id == version_id
    ))
    if version is None:
        raise VersionNotFound
    source_revision = db.get(ProjectRevision, version.source_revision_id)
    draft = repository.get_draft(db, project_id)
    if source_revision is None or draft is None:
        raise VersionNotFound
    snapshot = source_revision.snapshot
    if not repository.advance_draft(db, project_id, draft.version, user.id):
        db.rollback()
        raise DraftConflict
    repository.replace_files(db, project_id, snapshot)
    repository.touch_project(db, project_id)
    latest = repository.get_latest_revision(db, project_id)
    revision = ProjectRevision(
        project_id=project_id,
        revision_number=latest.revision_number + 1 if latest else 1,
        parent_revision_id=latest.id if latest else None,
        source_hash=source_revision.source_hash,
        snapshot=snapshot,
        created_by=user.id,
    )
    db.add(revision)
    db.flush()
    new_draft_version = draft.version + 1
    db.commit()
    return VersionRestoreResponse(
        version=ProjectVersionResponse.model_validate(version),
        restored_revision_id=revision.id,
        restored_revision_number=revision.revision_number,
        draft_version=new_draft_version,
    )
