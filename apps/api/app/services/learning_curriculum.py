"""Versioned enrollment and journey services for published course manifests."""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.content.curriculum.validation import validate_catalogue
from app.models.auth import User
from app.models.learning import LearningEnrollment
from app.models.projects import ProjectRevision
from app.repositories import projects as project_repository
from app.schemas.learning import LearningEnrollmentResponse

APP_ROOT = Path(__file__).resolve().parents[1]
API_ROOT = APP_ROOT.parent
CURRICULUM_ROOT = APP_ROOT / "content" / "curriculum"
COURSE_FILES = {"web-fs-01": "web-fs-01.json"}
COURSE_KEY_PATTERN = re.compile(r"^[A-Za-z0-9-]{1,80}$")
logger = logging.getLogger(__name__)


class CourseUnavailable(Exception):
    pass


class ProjectNotEditable(Exception):
    pass


class EnrollmentNotFound(Exception):
    pass


class EnrollmentProjectConflict(Exception):
    pass


class InvalidJourney(Exception):
    pass


def get_published_catalogue(course_key: str) -> dict | None:
    """Use the CLI's content contract; structural validity does not prove test success."""
    if not COURSE_KEY_PATTERN.fullmatch(course_key):
        return None
    filename = COURSE_FILES.get(course_key.casefold())
    if filename is None:
        return None
    catalogue_path = CURRICULUM_ROOT / filename
    registry_path = CURRICULUM_ROOT / "test-registry.json"
    try:
        catalogue = json.loads(catalogue_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(catalogue, dict) or catalogue.get("publication_state") not in {"published", "partial"}:
        return None
    try:
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
        validate_catalogue(catalogue, base_dir=API_ROOT, test_registry=registry)
    except (OSError, ValueError) as exc:
        logger.warning("Published curriculum %s failed structural validation: %s", filename, exc)
        return None
    if catalogue["course_id"].casefold() != course_key.casefold():
        return None
    return catalogue


def _manifest_nodes(catalogue: dict) -> tuple[set[str], dict[str, set[str]]]:
    node_ids = {item["id"] for key in ("core_lessons", "missions") for item in catalogue[key]}
    recommended = {item["id"]: set(item.get("recommended_bridge_ids", [])) for item in catalogue["missions"]}
    return node_ids, recommended


def _owns_project(db: Session, user: User, project_id: UUID) -> bool:
    project, role = project_repository.get_access(db, project_id, user.id)
    return project is not None and project.owner_id == user.id and role == "OWNER"


def _attach_project(
    db: Session, enrollment: LearningEnrollment, project_id: UUID | None,
) -> LearningEnrollmentResponse:
    if project_id is not None:
        if enrollment.project_id not in {None, project_id}:
            raise EnrollmentProjectConflict
        if enrollment.project_id is None:
            enrollment.project_id = project_id
    db.commit()
    db.refresh(enrollment)
    return _response(enrollment)


def _public_outline(catalogue: dict) -> dict:
    """Return navigation metadata only; never expose answer keys or hidden hint tiers."""
    return {
        "course_id": catalogue["course_id"],
        "title": catalogue["title"],
        "description": catalogue["description"],
        "content_version": catalogue["content_version"],
        "release_state": catalogue["publication_state"],
        "units": [
            {
                "id": unit["id"],
                "title": unit["title"],
                "mission_ids": list(unit["mission_ids"]),
            }
            for unit in catalogue["units"]
        ],
        "missions": [
            {"id": mission["id"], "unit_id": mission["unit_id"], "title": mission["title"], "available": mission["publication_state"] == "published"}
            for mission in catalogue["missions"]
        ],
    }


def list_published_outlines() -> list[dict]:
    outlines = []
    for course_key in COURSE_FILES:
        catalogue = get_published_catalogue(course_key)
        if catalogue is not None:
            outlines.append(_public_outline(catalogue))
    return outlines


def get_published_outline(course_key: str) -> dict | None:
    catalogue = get_published_catalogue(course_key)
    return _public_outline(catalogue) if catalogue is not None else None


def _response(enrollment: LearningEnrollment) -> LearningEnrollmentResponse:
    return LearningEnrollmentResponse.model_validate(enrollment)


def list_enrollments(db: Session, user: User) -> list[LearningEnrollmentResponse]:
    records = db.scalars(
        select(LearningEnrollment)
        .where(LearningEnrollment.user_id == user.id)
        .order_by(LearningEnrollment.updated_at.desc())
    )
    return [_response(record) for record in records]


def get_enrollment(db: Session, user: User, enrollment_id: UUID) -> LearningEnrollmentResponse | None:
    record = db.scalar(
        select(LearningEnrollment).where(
            LearningEnrollment.id == enrollment_id,
            LearningEnrollment.user_id == user.id,
        )
    )
    return _response(record) if record else None


def create_enrollment(
    db: Session,
    user: User,
    course_key: str,
    project_id: UUID | None,
) -> LearningEnrollmentResponse:
    catalogue = get_published_catalogue(course_key)
    if catalogue is None:
        raise CourseUnavailable

    if project_id is not None and not _owns_project(db, user, project_id):
        raise ProjectNotEditable

    canonical_key = catalogue["course_id"]
    content_version = catalogue["content_version"]
    existing = db.scalar(
        select(LearningEnrollment).where(
            LearningEnrollment.user_id == user.id,
            LearningEnrollment.course_key == canonical_key,
            LearningEnrollment.content_version == content_version,
        ).with_for_update()
    )
    if existing:
        return _attach_project(db, existing, project_id)

    first_mission = catalogue["missions"][0]
    record = LearningEnrollment(
        user_id=user.id,
        course_key=canonical_key,
        content_version=content_version,
        rubric_version=catalogue["rubric_version"],
        project_id=project_id,
        current_node_id=first_mission["id"],
    )
    db.add(record)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(LearningEnrollment).where(
                LearningEnrollment.user_id == user.id,
                LearningEnrollment.course_key == canonical_key,
                LearningEnrollment.content_version == content_version,
            ).with_for_update()
        )
        if existing is None:
            raise
        return _attach_project(db, existing, project_id)
    db.refresh(record)
    return _response(record)


def update_journey(
    db: Session,
    user: User,
    enrollment_id: UUID,
    *,
    current_node_id: str,
    active_bridge_id: str | None,
    revision_id: UUID | None,
    file_path: str | None = None,
    cursor_line: int | None = None,
) -> LearningEnrollmentResponse:
    record = db.scalar(
        select(LearningEnrollment).where(
            LearningEnrollment.id == enrollment_id,
            LearningEnrollment.user_id == user.id,
        ).with_for_update()
    )
    if record is None:
        raise EnrollmentNotFound
    catalogue = get_published_catalogue(record.course_key)
    if (
        catalogue is None or catalogue["content_version"] != record.content_version
        or catalogue["rubric_version"] != record.rubric_version
    ):
        raise CourseUnavailable

    nodes, recommended = _manifest_nodes(catalogue)
    if current_node_id not in nodes:
        raise InvalidJourney
    if record.active_bridge_id is not None:
        # The stored origin is authoritative, including on repeated saves inside a bridge.
        if current_node_id != record.return_mission_id:
            raise InvalidJourney
        if active_bridge_id not in {None, record.active_bridge_id}:
            raise InvalidJourney
    elif active_bridge_id is not None:
        if (
            current_node_id != record.current_node_id
            or active_bridge_id not in recommended.get(current_node_id, set())
        ):
            raise InvalidJourney

    leaving_bridge = record.active_bridge_id is not None and active_bridge_id is None
    if leaving_bridge:
        if record.return_revision_id is None or file_path is not None or cursor_line is not None:
            raise InvalidJourney
        if revision_id not in {None, record.return_revision_id}:
            raise InvalidJourney
        revision_id = record.return_revision_id

    revision: ProjectRevision | None = None
    effective_revision_id = revision_id
    if (file_path is not None or active_bridge_id is not None) and effective_revision_id is None:
        effective_revision_id = record.last_revision_id
    if effective_revision_id is not None:
        if record.project_id is None or not _owns_project(db, user, record.project_id):
            raise InvalidJourney
        revision = db.scalar(
            select(ProjectRevision).where(
                ProjectRevision.id == effective_revision_id,
                ProjectRevision.project_id == record.project_id,
            )
        )
        if revision is None:
            raise InvalidJourney
    if file_path is not None and (
        revision is None or file_path not in {item.get("path") for item in revision.snapshot}
    ):
        raise InvalidJourney

    entering_bridge = record.active_bridge_id is None and active_bridge_id is not None
    if entering_bridge and revision is None:
        raise InvalidJourney

    record.current_node_id = current_node_id
    if revision is not None:
        record.last_revision_id = revision.id
        record.last_revision_hash = revision.source_hash
        if file_path is None and record.last_file_path not in {item.get("path") for item in revision.snapshot}:
            record.last_file_path = None
            record.last_cursor_line = None
    if file_path is not None:
        record.last_file_path = file_path
        record.last_cursor_line = cursor_line
    if entering_bridge:
        record.return_mission_id = record.current_node_id
        record.return_revision_id = record.last_revision_id
        record.return_revision_hash = record.last_revision_hash
        record.return_file_path = record.last_file_path
        record.return_cursor_line = record.last_cursor_line
    elif leaving_bridge:
        record.last_file_path = record.return_file_path
        record.last_cursor_line = record.return_cursor_line
        record.return_mission_id = None
        record.return_revision_id = None
        record.return_revision_hash = None
        record.return_file_path = None
        record.return_cursor_line = None
    record.active_bridge_id = active_bridge_id
    db.commit()
    db.refresh(record)
    return _response(record)
