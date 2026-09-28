from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models.auth import User
from app.schemas.learning import (
    CourseResponse,
    LessonAttemptRequest,
    LessonAttemptResponse,
    LessonResponse,
)
from app.services import learning as learning_service

router = APIRouter(prefix="/learning", tags=["learning"])
SessionDep = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("/courses", response_model=list[CourseResponse])
def list_courses(db: SessionDep, user: CurrentUser) -> list[CourseResponse]:
    return learning_service.list_courses(db, user)


@router.get("/courses/{course_slug}/lessons/{lesson_slug}", response_model=LessonResponse)
def get_lesson(course_slug: str, lesson_slug: str, db: SessionDep, user: CurrentUser) -> LessonResponse:
    lesson = learning_service.get_lesson(db, user, course_slug, lesson_slug)
    if lesson is None:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return lesson


@router.post("/lessons/{lesson_id}/attempts", response_model=LessonAttemptResponse)
def submit_attempt(
    lesson_id: UUID,
    payload: LessonAttemptRequest,
    db: SessionDep,
    user: CurrentUser,
) -> LessonAttemptResponse:
    result = learning_service.submit_attempt(db, user, lesson_id, payload)
    if result is None:
        raise HTTPException(status_code=404, detail="Lesson not found")
    return result
