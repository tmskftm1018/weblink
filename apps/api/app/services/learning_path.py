"""Learning paths reuse M01 diagnostics; saved mission scopes stay pinned."""

from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.content.curriculum.artifact_checks import (
    DIAGNOSTIC_ANSWERS,
    M01_FIELDS,
    diagnostic_recommendation,
)
from app.content.curriculum.assignments import LEVEL_TITLES
from app.models.auth import User
from app.models.learning import LearningEnrollment, LearningMissionWork
from app.schemas.learning import LearningPathSaveRequest
from app.services.learning_curriculum import get_published_catalogue

LEVELS = [
    {"id": "BEGINNER", "title": LEVEL_TITLES["BEGINNER"], "description": "제공 코드와 단계별 안내로 구현해요. 다른 문제 적용은 M12에서 필수예요."},
    {"id": "PRACTICED", "title": LEVEL_TITLES["PRACTICED"], "description": "기본 뼈대에서 직접 연결하고 M10·M12는 다른 문제에도 적용해요."},
    {"id": "EXPERIENCED", "title": LEVEL_TITLES["EXPERIENCED"], "description": "최소 코드에서 직접 구성해요. M05·M07·M10·M12의 다른 문제 적용 과제도 완성해요."},
]
EXPERIENCE_LEVELS = {"처음 배워요": "BEGINNER", "조금 만들어 봤어요": "PRACTICED", "직접 프로젝트를 해봤어요": "EXPERIENCED"}
SUBJECTS = [
    {"id": "WEB_UI", "title": "웹 화면", "description": "HTML 입력 폼, JavaScript 입력 처리, React 화면과 API 호출을 배워요.",
     "mission_ids": ["M03", "M04", "M05", "M10"], "foundation_ids": ["C01", "C02", "C03", "C04"]},
    {"id": "SERVER_API", "title": "서버/API", "description": "FastAPI의 요청·응답, 입력 검증과 DB 연결을 배워요.",
     "mission_ids": ["M06", "M07", "M09", "M10"], "foundation_ids": ["C00", "C02", "C04"]},
    {"id": "DATABASE", "title": "데이터베이스", "description": "SQLite에 데이터를 저장·조회하고 서버와 화면까지 연결해요.",
     "mission_ids": ["M08", "M09", "M10"], "foundation_ids": ["C01", "C03", "C04"]},
]
COMMON_MISSION_IDS = ["M01", "M02", "M11", "M12"]


def selected_subject_ids(record: LearningEnrollment) -> list[str]:
    saved = (record.path_preferences or {}).get("subject_ids")
    return [subject["id"] for subject in SUBJECTS if saved is None or subject["id"] in saved]


def effective_level(record: LearningEnrollment, m01: LearningMissionWork | None) -> str:
    return (record.path_preferences or {}).get("level") or EXPERIENCE_LEVELS.get((m01.answers if m01 else {}).get("experience")) or "BEGINNER"


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
        "subject_ids": selected_subject_ids(record), "subjects": SUBJECTS,
        "common_mission_ids": COMMON_MISSION_IDS,
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
    subject_ids = payload.subject_ids if payload.subject_ids is not None else selected_subject_ids(record)
    preferences = {**(record.path_preferences or {}), "level": level, "subject_ids": subject_ids}
    result = db.execute(update(LearningEnrollment).where(
        LearningEnrollment.id == record.id, LearningEnrollment.user_id == user.id,
        LearningEnrollment.path_version == payload.expected_version,
    ).values(path_preferences=preferences, path_version=payload.expected_version + 1))
    if result.rowcount != 1:
        db.rollback()
        raise HTTPException(409, "다른 창에서 학습 경로를 바꿨어요. 서버 설정을 다시 불러온 뒤 선택해 주세요.")
    db.commit()
    db.refresh(record)
    return _response(db, record)
