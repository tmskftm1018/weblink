from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models.auth import User
from app.schemas.learning import (
    CourseResponse,
    LearningBridgeRequest,
    LearningEnrollmentCreateRequest,
    LearningEnrollmentResponse,
    LearningJourneyUpdateRequest,
    LearningPathSaveRequest,
    LearningProjectLinkRequest,
    LearningProjectRequest,
    LearningProjectSyncRequest,
    LearningRunRequest,
    LearningWorkSaveRequest,
    LearningWorkSubmitRequest,
    LessonAttemptRequest,
    LessonAttemptResponse,
    LessonResponse,
)
from app.services import learning as learning_service
from app.services import learning_curriculum as curriculum_service
from app.services import learning_execution, learning_handoff, learning_project_sync
from app.services import learning_work as work_service
from app.services import learning_path as path_service

router = APIRouter(prefix="/learning", tags=["learning"])
SessionDep = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("/curricula", response_model=list[dict])
def list_curricula(user: CurrentUser) -> list[dict]:
    return curriculum_service.list_published_outlines()


@router.get("/curricula/{course_key}", response_model=dict)
def get_curriculum(course_key: str, user: CurrentUser) -> dict:
    outline = curriculum_service.get_published_outline(course_key)
    if outline is None:
        raise HTTPException(status_code=404, detail="아직 공개되지 않은 학습 과정입니다.")
    return outline


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


@router.get("/enrollments", response_model=list[LearningEnrollmentResponse])
def list_enrollments(db: SessionDep, user: CurrentUser) -> list[LearningEnrollmentResponse]:
    return curriculum_service.list_enrollments(db, user)


@router.post(
    "/enrollments",
    response_model=LearningEnrollmentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_enrollment(
    payload: LearningEnrollmentCreateRequest,
    db: SessionDep,
    user: CurrentUser,
) -> LearningEnrollmentResponse:
    try:
        return curriculum_service.create_enrollment(db, user, payload.course_key, payload.project_id)
    except curriculum_service.CourseUnavailable as exc:
        raise HTTPException(status_code=404, detail="아직 공개되지 않은 학습 과정입니다.") from exc
    except curriculum_service.ProjectNotEditable as exc:
        raise HTTPException(status_code=403, detail="개인 학습에는 본인 소유 프로젝트를 연결해 주세요.") from exc
    except curriculum_service.EnrollmentProjectConflict as exc:
        raise HTTPException(status_code=409, detail="이 과정은 이미 다른 프로젝트에 연결되어 있습니다.") from exc


@router.get("/enrollments/{enrollment_id}", response_model=LearningEnrollmentResponse)
def get_enrollment(enrollment_id: UUID, db: SessionDep, user: CurrentUser) -> LearningEnrollmentResponse:
    record = curriculum_service.get_enrollment(db, user, enrollment_id)
    if record is None:
        raise HTTPException(status_code=404, detail="학습 등록을 찾지 못했습니다.")
    return record


@router.get("/enrollments/{enrollment_id}/workspace")
def learning_workspace(enrollment_id: UUID, db: SessionDep, user: CurrentUser) -> dict:
    return work_service.workspace(db, user, enrollment_id)


@router.get("/enrollments/{enrollment_id}/path")
def learning_path(enrollment_id: UUID, db: SessionDep, user: CurrentUser) -> dict:
    return path_service.get_path(db, user, enrollment_id)


@router.put("/enrollments/{enrollment_id}/path")
def save_learning_path(enrollment_id: UUID, payload: LearningPathSaveRequest, db: SessionDep, user: CurrentUser) -> dict:
    return path_service.save_path(db, user, enrollment_id, payload)


@router.get("/enrollments/{enrollment_id}/portfolio")
def learning_portfolio(enrollment_id: UUID, db: SessionDep, user: CurrentUser) -> dict:
    return work_service.portfolio(db, user, enrollment_id)


@router.post("/enrollments/{enrollment_id}/nodes/{node_id}/project")
def learning_project(enrollment_id: UUID, node_id: str, payload: LearningProjectRequest, db: SessionDep, user: CurrentUser) -> dict:
    return learning_handoff.handoff(db, user, enrollment_id, node_id, payload.expected_version, payload.field)


@router.post("/enrollments/{enrollment_id}/nodes/{node_id}/project/preview")
def preview_learning_project(enrollment_id: UUID, node_id: str, payload: LearningProjectRequest, db: SessionDep, user: CurrentUser) -> dict:
    return learning_project_sync.preview(db, user, enrollment_id, node_id, payload)


@router.put("/enrollments/{enrollment_id}/nodes/{node_id}/project")
def sync_learning_project(enrollment_id: UUID, node_id: str, payload: LearningProjectSyncRequest, db: SessionDep, user: CurrentUser) -> dict:
    try:
        return learning_project_sync.apply(db, user, enrollment_id, node_id, payload)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "프로젝트 버전을 동시에 저장했거나 연결 정보가 바뀌었어요. 변경사항을 새로 비교해 주세요.") from exc


@router.get("/enrollments/{enrollment_id}/nodes/{node_id}/executions")
def list_learning_executions(enrollment_id: UUID, node_id: str, db: SessionDep, user: CurrentUser) -> list[dict]:
    return learning_execution.history(db, user, enrollment_id, node_id)


@router.get("/enrollments/{enrollment_id}/project-context")
def learning_project_context(enrollment_id: UUID, db: SessionDep, user: CurrentUser) -> dict:
    return learning_handoff.project_context(db, user, enrollment_id)


@router.put("/enrollments/{enrollment_id}/project-context")
def link_learning_project(enrollment_id: UUID, payload: LearningProjectLinkRequest, db: SessionDep, user: CurrentUser) -> dict:
    return learning_handoff.link_project(db, user, enrollment_id, payload.project_id)


@router.post("/enrollments/{enrollment_id}/bridge")
def learning_bridge(enrollment_id: UUID, payload: LearningBridgeRequest, db: SessionDep, user: CurrentUser) -> dict:
    return learning_handoff.bridge(db, user, enrollment_id, payload)


@router.get("/enrollments/{enrollment_id}/nodes/{node_id}")
def learning_node(enrollment_id: UUID, node_id: str, db: SessionDep, user: CurrentUser) -> dict:
    return work_service.node_details(db, user, enrollment_id, node_id)


@router.put("/enrollments/{enrollment_id}/nodes/{node_id}/work")
def save_learning_work(enrollment_id: UUID, node_id: str, payload: LearningWorkSaveRequest, db: SessionDep, user: CurrentUser) -> dict:
    return work_service.save_work(db, user, enrollment_id, node_id, payload.expected_version, payload.answers)


@router.post("/enrollments/{enrollment_id}/nodes/{node_id}/submit")
def submit_learning_work(enrollment_id: UUID, node_id: str, payload: LearningWorkSubmitRequest, db: SessionDep, user: CurrentUser) -> dict:
    return work_service.submit_work(db, user, enrollment_id, node_id, payload.expected_version)


@router.get("/enrollments/{enrollment_id}/nodes/{node_id}/hint")
def learning_hint(enrollment_id: UUID, node_id: str, db: SessionDep, user: CurrentUser, level: int = Query(ge=1, le=4)) -> dict:
    return work_service.hint(db, user, enrollment_id, node_id, level)


@router.post("/enrollments/{enrollment_id}/nodes/{node_id}/run")
def run_learning_code(enrollment_id: UUID, node_id: str, payload: LearningRunRequest, db: SessionDep, user: CurrentUser) -> dict:
    return work_service.run_code(db, user, enrollment_id, node_id, payload.expected_version, payload.field)


@router.get("/executions/{execution_id}")
def get_learning_execution(execution_id: UUID, db: SessionDep, user: CurrentUser) -> dict:
    return learning_execution.get(db, user, execution_id)


@router.put("/enrollments/{enrollment_id}/journey", response_model=LearningEnrollmentResponse)
def update_journey(
    enrollment_id: UUID,
    payload: LearningJourneyUpdateRequest,
    db: SessionDep,
    user: CurrentUser,
) -> LearningEnrollmentResponse:
    try:
        return curriculum_service.update_journey(
            db,
            user,
            enrollment_id,
            current_node_id=payload.current_node_id,
            active_bridge_id=payload.active_bridge_id,
            revision_id=payload.revision_id,
            file_path=payload.file_path,
            cursor_line=payload.cursor_line,
        )
    except curriculum_service.EnrollmentNotFound as exc:
        raise HTTPException(status_code=404, detail="학습 등록을 찾지 못했습니다.") from exc
    except curriculum_service.CourseUnavailable as exc:
        raise HTTPException(status_code=409, detail="학습 과정 버전이 공개 상태가 아니거나 변경되었습니다.") from exc
    except curriculum_service.InvalidJourney as exc:
        raise HTTPException(status_code=422, detail="학습 위치 또는 프로젝트 개정 정보가 올바르지 않습니다.") from exc
