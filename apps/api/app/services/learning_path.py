"""Advisory paths reuse M01 diagnostics and never change mission completion."""

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.content.curriculum.artifact_checks import DIAGNOSTIC_ANSWERS, M01_FIELDS, diagnostic_recommendation
from app.models.auth import User
from app.models.learning import LearningEnrollment, LearningMissionWork
from app.schemas.learning import LearningPathSaveRequest
from app.services.learning_curriculum import get_published_catalogue

LEVELS = [
    {"id": "BEGINNER", "title": "입문 · 처음부터", "description": "기초 연습과 자세한 안내를 보며 한 단계씩 진행해요."},
    {"id": "PRACTICED", "title": "기본 · 연결 연습", "description": "문법을 조금 알아요. 필요한 개념을 복습하며 화면·API·DB를 연결해요."},
    {"id": "EXPERIENCED", "title": "경험자 · 미션 중심", "description": "직접 만들어 본 경험이 있어요. 목표와 관찰 기준을 중심으로 진행해요."},
]
EXPERIENCE_LEVELS = {"처음 배워요": "BEGINNER", "조금 만들어 봤어요": "PRACTICED", "직접 프로젝트를 해봤어요": "EXPERIENCED"}


def _context(db: Session, user: User, enrollment_id: UUID) -> LearningEnrollment:
    record = db.scalar(select(LearningEnrollment).where(
        LearningEnrollment.id == enrollment_id, LearningEnrollment.user_id == user.id,
    ))
    if record is None:
        raise HTTPException(404, "학습 등록을 찾지 못했습니다.")
    catalogue = get_published_catalogue(record.course_key)
    if catalogue is None or catalogue["content_version"] != record.content_version or catalogue["rubric_version"] != record.rubric_version:
        raise HTTPException(409, "학습 과정 버전이 변경되었습니다. 현재 과정을 다시 열어 주세요.")
    return record


def _response(db: Session, record: LearningEnrollment) -> dict:
    work = db.scalar(select(LearningMissionWork).where(
        LearningMissionWork.enrollment_id == record.id, LearningMissionWork.node_id == "M01",
    ))
    answers = work.answers if work else {}
    experience = EXPERIENCE_LEVELS.get(answers.get("experience"))
    fields = {field["id"]: field for field in M01_FIELDS}
    answered = [key for key in DIAGNOSTIC_ANSWERS if answers.get(key) in fields[key]["choices"]]
    complete = len(answered) == len(DIAGNOSTIC_ANSWERS)
    recommendation = diagnostic_recommendation(answers) if complete else None
    recommended = ("BEGINNER" if recommendation["foundation_ids"] else "EXPERIENCED" if experience == "EXPERIENCED" else "PRACTICED") if recommendation else experience
    chosen = (record.path_preferences or {}).get("level")
    level = chosen or experience
    foundations = ["C00", "C01", "C02", "C03", "C04", "C05"] if level == "BEGINNER" else recommendation["foundation_ids"] if recommendation else ["C02", "C04", "C05"] if level == "PRACTICED" else []
    return {
        "version": record.path_version, "level": level,
        "source": "SELECTED" if chosen else "M01" if experience else "UNSET",
        "recommended_level": recommended, "foundation_ids": foundations, "levels": LEVELS,
        "diagnostic_status": "COMPLETE" if complete else "PARTIAL" if answered else "NOT_STARTED",
        "diagnostic_version": work.version if work else 0,
        "review": [{"id": key, "label": fields[key]["label"], "correct": answers.get(key) == expected,
                    "explanation": f"핵심 개념: {expected}"} for key, expected in DIAGNOSTIC_ANSWERS.items()] if complete else [],
    }


def get_path(db: Session, user: User, enrollment_id: UUID) -> dict:
    return _response(db, _context(db, user, enrollment_id))


def save_path(db: Session, user: User, enrollment_id: UUID, payload: LearningPathSaveRequest) -> dict:
    record = _context(db, user, enrollment_id)
    current = _response(db, record)
    level = payload.level or current["recommended_level"] or "BEGINNER"
    result = db.execute(update(LearningEnrollment).where(
        LearningEnrollment.id == record.id, LearningEnrollment.user_id == user.id,
        LearningEnrollment.path_version == payload.expected_version,
    ).values(path_preferences={"level": level}, path_version=payload.expected_version + 1))
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "다른 창에서 학습 경로를 바꿨어요. 서버 설정을 다시 불러온 뒤 선택해 주세요.")
    db.commit()
    db.refresh(record)
    return _response(db, record)
