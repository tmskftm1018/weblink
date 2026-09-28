from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.auth import User
from app.models.debugging import DebugSession
from app.repositories import execution as execution_repository
from app.repositories import projects as project_repository
from app.schemas.debugging import DebugSessionCreate, DebugSessionResponse


class DebugSessionNotFound(Exception):
    pass


class RunNotReady(Exception):
    pass


def save_debug_session(
    db: Session, user: User, project_id: UUID, run_id: UUID, payload: DebugSessionCreate
) -> DebugSessionResponse:
    project, _role = project_repository.get_access(db, project_id, user.id)
    if project is None:
        raise DebugSessionNotFound
    run = execution_repository.get_run(db, project_id, run_id, user.id)
    if run is None:
        raise DebugSessionNotFound
    if run.status not in {"FAILED", "SUCCEEDED"}:
        raise RunNotReady
    session = db.scalar(select(DebugSession).where(DebugSession.run_id == run.id))
    if session is None:
        session = DebugSession(
            project_id=project_id,
            run_id=run.id,
            user_id=user.id,
            actual_output=run.stdout,
            error_text=run.stderr or (run.failure_category or ""),
            logs="\n".join(part for part in (run.stdout, run.stderr) if part),
            hypothesis=payload.hypothesis.strip(),
            expected_output=payload.expected_output,
        )
        db.add(session)
    else:
        session.hypothesis = payload.hypothesis.strip()
        session.expected_output = payload.expected_output
    db.commit()
    db.refresh(session)
    return DebugSessionResponse.model_validate(session)


def get_debug_session(
    db: Session, user: User, project_id: UUID, run_id: UUID
) -> DebugSessionResponse:
    project, _role = project_repository.get_access(db, project_id, user.id)
    if project is None or execution_repository.get_run(db, project_id, run_id, user.id) is None:
        raise DebugSessionNotFound
    session = db.scalar(select(DebugSession).where(
        DebugSession.project_id == project_id,
        DebugSession.run_id == run_id,
        DebugSession.user_id == user.id,
    ))
    if session is None:
        raise DebugSessionNotFound
    return DebugSessionResponse.model_validate(session)
