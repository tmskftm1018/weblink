import hashlib
import json
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.auth import User
from app.models.execution import ExecutionSnapshot, Job, Run
from app.repositories import execution as repository
from app.repositories import projects as project_repository
from app.schemas.runs import RunResponse


class ProjectNotFound(Exception):
    pass


class ProjectReadOnly(Exception):
    pass


class RevisionNotFound(Exception):
    pass


class IdempotencyConflict(Exception):
    pass


def _request_hash(project_id: UUID, revision_id: UUID) -> str:
    value = json.dumps([str(project_id), str(revision_id)], separators=(",", ":")).encode()
    return hashlib.sha256(value).hexdigest()


def _response(run: Run) -> RunResponse:
    return RunResponse.model_validate(run, from_attributes=True)


def create_run(
    db: Session,
    user: User,
    project_id: UUID,
    revision_id: UUID,
    idempotency_key: str,
) -> tuple[RunResponse, bool]:
    project, role = project_repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    if role not in {"OWNER", "EDITOR"}:
        raise ProjectReadOnly
    source_revision = repository.get_revision(db, project_id, revision_id)
    if source_revision is None:
        raise RevisionNotFound

    request_hash = _request_hash(project_id, revision_id)
    prior = repository.get_run_by_idempotency(db, user.id, idempotency_key)
    if prior:
        if prior.request_hash != request_hash:
            raise IdempotencyConflict
        return _response(prior), False

    snapshot = ExecutionSnapshot(
        project_id=project_id,
        revision_id=source_revision.id,
        source_hash=source_revision.source_hash,
        files=source_revision.snapshot,
        created_by=user.id,
    )
    repository.add_snapshot(db, snapshot)
    db.flush()
    run = Run(
        project_id=project_id,
        revision_id=source_revision.id,
        snapshot_id=snapshot.id,
        requested_by=user.id,
        idempotency_key=idempotency_key,
        request_hash=request_hash,
        status="QUEUED",
        stdout="",
        stderr="",
    )
    repository.add_run(db, run)
    db.flush()
    repository.add_job(db, Job(run_id=run.id, status="QUEUED", attempt=0, max_attempts=2, lease_generation=0))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = repository.get_run_by_idempotency(db, user.id, idempotency_key)
        if existing:
            if existing.request_hash != request_hash:
                raise IdempotencyConflict
            return _response(existing), False
        raise
    db.refresh(run)
    return _response(run), True


def get_run(db: Session, user: User, project_id: UUID, run_id: UUID) -> RunResponse:
    project, _role = project_repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    run = repository.get_run(db, project_id, run_id, user.id)
    if run is None:
        raise ProjectNotFound
    return _response(run)


def list_runs(db: Session, user: User, project_id: UUID) -> list[RunResponse]:
    project, _role = project_repository.get_access(db, project_id, user.id)
    if project is None:
        raise ProjectNotFound
    return [_response(run) for run in repository.list_runs(db, project_id, user.id)]
