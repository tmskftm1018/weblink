from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models.projects import Project, ProjectDraft, ProjectFile, ProjectMember, ProjectRevision


def list_for_user(db: Session, user_id: UUID) -> list[tuple[Project, ProjectDraft]]:
    return list(
        db.execute(
            select(Project, ProjectDraft)
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .join(ProjectDraft, ProjectDraft.project_id == Project.id)
            .where(ProjectMember.user_id == user_id)
            .order_by(Project.updated_at.desc())
        ).all()
    )


def get_access(db: Session, project_id: UUID, user_id: UUID) -> tuple[Project | None, str | None]:
    row = db.execute(
        select(Project, ProjectMember.role)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(Project.id == project_id, ProjectMember.user_id == user_id)
    ).first()
    return (row[0], row[1]) if row else (None, None)


def get_draft(db: Session, project_id: UUID) -> ProjectDraft | None:
    return db.scalar(select(ProjectDraft).where(ProjectDraft.project_id == project_id))


def list_files(db: Session, project_id: UUID) -> list[ProjectFile]:
    return list(
        db.scalars(
            select(ProjectFile).where(ProjectFile.project_id == project_id).order_by(ProjectFile.path)
        )
    )


def list_revisions(db: Session, project_id: UUID) -> list[ProjectRevision]:
    return list(
        db.scalars(
            select(ProjectRevision)
            .where(ProjectRevision.project_id == project_id)
            .order_by(ProjectRevision.revision_number.desc())
        )
    )


def get_latest_revision(db: Session, project_id: UUID) -> ProjectRevision | None:
    return db.scalar(
        select(ProjectRevision)
        .where(ProjectRevision.project_id == project_id)
        .order_by(ProjectRevision.revision_number.desc())
        .limit(1)
    )


def advance_draft(
    db: Session,
    project_id: UUID,
    expected_version: int,
    updated_by: UUID,
) -> bool:
    result = db.execute(
        update(ProjectDraft)
        .where(ProjectDraft.project_id == project_id, ProjectDraft.version == expected_version)
        .values(version=ProjectDraft.version + 1, updated_by=updated_by)
        .execution_options(synchronize_session=False)
    )
    return result.rowcount == 1


def replace_files(db: Session, project_id: UUID, files: list[dict[str, str]]) -> None:
    db.query(ProjectFile).filter(ProjectFile.project_id == project_id).delete(synchronize_session=False)
    db.add_all(ProjectFile(project_id=project_id, **file) for file in files)


def touch_project(db: Session, project_id: UUID) -> None:
    db.execute(update(Project).where(Project.id == project_id).values(updated_at=func.now()))


def add_project(db: Session, project: Project) -> None:
    db.add(project)


def save(db: Session) -> None:
    db.commit()
