from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Lesson(Base):
    __tablename__ = "lessons"
    __table_args__ = (UniqueConstraint("course_id", "slug", name="uq_lesson_course_slug"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    course_id: Mapped[UUID] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    slug: Mapped[str] = mapped_column(String(80))
    title: Mapped[str] = mapped_column(String(160))
    summary: Mapped[str] = mapped_column(Text)
    learning_objective: Mapped[str] = mapped_column(Text)
    content: Mapped[dict] = mapped_column(JSON)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_published: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Concept(Base):
    __tablename__ = "concepts"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text)


class LessonConcept(Base):
    __tablename__ = "lesson_concepts"
    __table_args__ = (UniqueConstraint("lesson_id", "concept_id", name="uq_lesson_concept"),)

    lesson_id: Mapped[UUID] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"), primary_key=True)
    concept_id: Mapped[UUID] = mapped_column(ForeignKey("concepts.id", ondelete="CASCADE"), primary_key=True)


class LearningProgress(Base):
    __tablename__ = "learning_progress"
    __table_args__ = (UniqueConstraint("user_id", "lesson_id", name="uq_progress_user_lesson"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    lesson_id: Mapped[UUID] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(24), default="NOT_STARTED", nullable=False)
    attempts_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class LearningEvidence(Base):
    __tablename__ = "learning_evidence"

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    lesson_id: Mapped[UUID] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LearningEnrollment(Base):
    """Versioned learner journey for the new curriculum; legacy progress remains untouched."""

    __tablename__ = "learning_enrollments"
    __table_args__ = (
        UniqueConstraint("user_id", "course_key", "content_version", name="uq_learning_enrollment_version"),
        CheckConstraint("status IN ('ACTIVE', 'COMPLETED', 'PAUSED')", name="ck_learning_enrollment_status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    course_key: Mapped[str] = mapped_column(String(80), nullable=False)
    content_version: Mapped[str] = mapped_column(String(40), nullable=False)
    rubric_version: Mapped[str] = mapped_column(String(40), nullable=False)
    project_id: Mapped[UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="ACTIVE", server_default="ACTIVE", nullable=False)
    current_node_id: Mapped[str | None] = mapped_column(String(40))
    path_preferences: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    path_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    active_bridge_id: Mapped[str | None] = mapped_column(String(40))
    return_mission_id: Mapped[str | None] = mapped_column(String(40))
    last_revision_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("project_revisions.id", ondelete="SET NULL"), index=True
    )
    last_revision_hash: Mapped[str | None] = mapped_column(String(64))
    last_file_path: Mapped[str | None] = mapped_column(String(240))
    last_cursor_line: Mapped[int | None] = mapped_column(Integer)
    return_revision_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("project_revisions.id", ondelete="SET NULL", name="fk_learning_enrollments_return_revision")
    )
    return_revision_hash: Mapped[str | None] = mapped_column(String(64))
    return_file_path: Mapped[str | None] = mapped_column(String(240))
    return_cursor_line: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class LearningMissionWork(Base):
    """One editable, versioned artifact per learner enrollment and learning node."""

    __tablename__ = "learning_mission_work"
    __table_args__ = (UniqueConstraint("enrollment_id", "node_id", name="uq_learning_work_node"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    enrollment_id: Mapped[UUID] = mapped_column(ForeignKey("learning_enrollments.id", ondelete="CASCADE"), index=True)
    node_id: Mapped[str] = mapped_column(String(40), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    retrieved_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    answers: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    source_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    submitted_hash: Mapped[str | None] = mapped_column(String(64))
    feedback: Mapped[dict | None] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class LearningExecution(Base):
    __tablename__ = "learning_executions"
    __table_args__ = (
        UniqueConstraint("enrollment_id", "node_id", "artifact_hash", "field", name="uq_learning_execution_input"),
        Index("ix_learning_execution_queue", "status", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    enrollment_id: Mapped[UUID] = mapped_column(ForeignKey("learning_enrollments.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    node_id: Mapped[str] = mapped_column(String(40), nullable=False)
    field: Mapped[str] = mapped_column(String(24), nullable=False)
    artifact_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    work_version: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="QUEUED")
    result: Mapped[dict | None] = mapped_column(JSON)
    lease_token: Mapped[str | None] = mapped_column(String(40))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LearningAssessmentEvidence(Base):
    """A check, concept response, observation, or transfer result tied to exact versions."""

    __tablename__ = "learning_assessment_evidence"
    __table_args__ = (
        CheckConstraint(
            "assessment_type IN ('FUNCTIONAL', 'CONCEPT', 'OBSERVATION', 'TRANSFER')",
            name="ck_learning_assessment_type",
        ),
        CheckConstraint(
            "status IN ('PASSED', 'FAILED', 'UNAVAILABLE', 'STALE', 'RECORDED')",
            name="ck_learning_assessment_status",
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    enrollment_id: Mapped[UUID] = mapped_column(ForeignKey("learning_enrollments.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    mission_id: Mapped[str] = mapped_column(String(40), nullable=False)
    assessment_id: Mapped[str] = mapped_column(String(100), nullable=False)
    assessment_type: Mapped[str] = mapped_column(String(20), nullable=False)
    content_version: Mapped[str] = mapped_column(String(40), nullable=False)
    rubric_version: Mapped[str] = mapped_column(String(40), nullable=False)
    revision_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("project_revisions.id", ondelete="SET NULL"), index=True
    )
    revision_hash: Mapped[str | None] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class LearningProjectExport(Base):
    __tablename__ = "learning_project_exports"
    __table_args__ = (UniqueConstraint("enrollment_id", "node_id", "field", name="uq_learning_project_export"),)

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    enrollment_id: Mapped[UUID] = mapped_column(ForeignKey("learning_enrollments.id", ondelete="CASCADE"), index=True)
    node_id: Mapped[str] = mapped_column(String(40), nullable=False)
    field: Mapped[str] = mapped_column(String(24), nullable=False)
    artifact_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    work_version: Mapped[int] = mapped_column(Integer, nullable=False)
    project_id: Mapped[UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"))
    revision_id: Mapped[UUID | None] = mapped_column(ForeignKey("project_revisions.id", ondelete="SET NULL"))
    revision_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    baseline_files: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
