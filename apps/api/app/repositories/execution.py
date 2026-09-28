from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.execution import ExecutionSnapshot, Job, Run
from app.models.projects import ProjectRevision


def get_revision(db: Session, project_id: UUID, revision_id: UUID) -> ProjectRevision | None:
    return db.scalar(
        select(ProjectRevision).where(
            ProjectRevision.id == revision_id,
            ProjectRevision.project_id == project_id,
        )
    )


def get_run_by_idempotency(db: Session, user_id: UUID, idempotency_key: str) -> Run | None:
    return db.scalar(
        select(Run).where(
            Run.requested_by == user_id,
            Run.idempotency_key == idempotency_key,
        )
    )


def get_run(db: Session, project_id: UUID, run_id: UUID, user_id: UUID) -> Run | None:
    return db.scalar(select(Run).where(
        Run.project_id == project_id, Run.id == run_id, Run.requested_by == user_id
    ))


def list_runs(db: Session, project_id: UUID, user_id: UUID, limit: int = 30) -> list[Run]:
    return list(
        db.scalars(
            select(Run).where(Run.project_id == project_id, Run.requested_by == user_id)
            .order_by(Run.created_at.desc()).limit(limit)
        )
    )


def add_snapshot(db: Session, snapshot: ExecutionSnapshot) -> None:
    db.add(snapshot)


def add_run(db: Session, run: Run) -> None:
    db.add(run)


def add_job(db: Session, job: Job) -> None:
    db.add(job)
