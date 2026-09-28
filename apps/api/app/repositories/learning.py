from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.learning import (
    Concept,
    Course,
    LearningEvidence,
    LearningProgress,
    Lesson,
    LessonConcept,
)


def list_courses(db: Session) -> list[Course]:
    return list(db.scalars(select(Course).order_by(Course.order_index, Course.title)))


def list_lessons(db: Session, course_id: UUID) -> list[Lesson]:
    return list(
        db.scalars(
            select(Lesson)
            .where(Lesson.course_id == course_id, Lesson.is_published.is_(True))
            .order_by(Lesson.order_index, Lesson.title)
        )
    )


def get_course_by_slug(db: Session, slug: str) -> Course | None:
    return db.scalar(select(Course).where(Course.slug == slug))


def get_lesson_by_slug(db: Session, course_id: UUID, slug: str) -> Lesson | None:
    return db.scalar(
        select(Lesson).where(
            Lesson.course_id == course_id,
            Lesson.slug == slug,
            Lesson.is_published.is_(True),
        )
    )


def list_lesson_concepts(db: Session, lesson_id: UUID) -> list[Concept]:
    return list(
        db.scalars(
            select(Concept)
            .join(LessonConcept, LessonConcept.concept_id == Concept.id)
            .where(LessonConcept.lesson_id == lesson_id)
            .order_by(Concept.name)
        )
    )


def list_user_progress(db: Session, user_id: UUID, lesson_ids: list[UUID]) -> list[LearningProgress]:
    if not lesson_ids:
        return []
    return list(
        db.scalars(
            select(LearningProgress).where(
                LearningProgress.user_id == user_id,
                LearningProgress.lesson_id.in_(lesson_ids),
            )
        )
    )


def get_user_progress(db: Session, user_id: UUID, lesson_id: UUID) -> LearningProgress | None:
    return db.scalar(
        select(LearningProgress).where(
            LearningProgress.user_id == user_id,
            LearningProgress.lesson_id == lesson_id,
        )
    )


def get_lesson(db: Session, lesson_id: UUID) -> Lesson | None:
    return db.get(Lesson, lesson_id)


def add_progress(db: Session, progress: LearningProgress) -> None:
    db.add(progress)


def add_evidence(db: Session, evidence: LearningEvidence) -> None:
    db.add(evidence)


def save(db: Session) -> None:
    db.commit()
