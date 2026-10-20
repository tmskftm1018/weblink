"""Course jobs carry immutable source only; grader results never come from clients."""

import json
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func, select

from app.content.curriculum.course_runtime_contract import CONTRACTS
from app.models.auth import User
from app.models.learning import LearningExecution


def find(db, enrollment_id, node_id, artifact_hash, field):
    return db.scalar(select(LearningExecution).where(
        LearningExecution.enrollment_id == enrollment_id,
        LearningExecution.node_id == node_id, LearningExecution.artifact_hash == artifact_hash,
        LearningExecution.field == field,
    ))


def queue(db, user, enrollment, work, field):
    if work.node_id not in {"M06", "M07", "M08", "M09", "M10", "M11", "M12"} or field not in {"source", "transfer_source", "baseline_source"} or (field == "transfer_source" and work.node_id not in {"M07", "M10", "M12"}) or (field == "baseline_source" and work.node_id != "M11"):
        raise HTTPException(422, "지원하지 않는 실행 항목입니다.")
    record = find(db, enrollment.id, work.node_id, work.source_hash, field)
    if record is None or record.status == "UNAVAILABLE":
        db.scalar(select(User).where(User.id == user.id).with_for_update())
        active = db.scalar(select(func.count()).select_from(LearningExecution).where(
            LearningExecution.user_id == user.id, LearningExecution.status.in_(["QUEUED", "RUNNING"]),
        ))
        if active >= 2:
            raise HTTPException(429, "이 계정에서 대기·실행 중인 작업이 두 개 있어요. 먼저 실행 중인 작업을 확인해 주세요.")
    if record is None:
        record = LearningExecution(
            enrollment_id=enrollment.id, user_id=user.id, node_id=work.node_id,
            field=field, artifact_hash=work.source_hash, work_version=work.version,
            source=json.dumps({"frontend": work.answers.get(field, ""), "api": work.answers.get({"source": "api_source", "transfer_source": "transfer_api_source", "baseline_source": "baseline_api_source"}[field], "")}, ensure_ascii=False) if work.node_id in {"M10", "M11", "M12"} else work.answers.get(field, ""), status="QUEUED",
        )
        db.add(record)
    elif record.status == "UNAVAILABLE":
        record.status = "QUEUED"
        record.result = None
        record.lease_token = None
        record.created_at = datetime.now(UTC)
    db.commit()
    db.refresh(record)
    return response(record)


def response(record):
    return {
        **(record.result or {"status": record.status, "checks": [], "requests": []}),
        "job_id": str(record.id), "work_version": record.work_version,
        "source_hash": record.artifact_hash,
        "field": record.field, "created_at": record.created_at.replace(tzinfo=UTC) if record.created_at.tzinfo is None else record.created_at,
        "scope": CONTRACTS[record.node_id]["scope"],
    }


def get(db, user, execution_id):
    record = db.scalar(select(LearningExecution).where(LearningExecution.id == execution_id, LearningExecution.user_id == user.id).with_for_update())
    if record is None:
        raise HTTPException(404, "실행 기록을 찾지 못했습니다.")
    created = record.created_at.replace(tzinfo=UTC) if record.created_at.tzinfo is None else record.created_at
    if record.status in {"QUEUED", "RUNNING"} and datetime.now(UTC) - created > timedelta(minutes=2):
        record.status = "UNAVAILABLE"
        record.result = {"status": "UNAVAILABLE", "error": "실행을 완료하지 못했습니다. worker 상태를 확인한 뒤 다시 실행해 주세요.", "checks": [], "requests": []}
        db.commit()
    return response(record)


def history(db, user, enrollment_id, node_id):
    from app.services import learning_work

    enrollment, catalogue, works = learning_work._context(db, user, enrollment_id)
    learning_work._node(catalogue, node_id)
    work = works.get(node_id)
    records = db.scalars(select(LearningExecution).where(
        LearningExecution.enrollment_id == enrollment.id, LearningExecution.user_id == user.id,
        LearningExecution.node_id == node_id,
    ).order_by(LearningExecution.created_at.desc(), LearningExecution.id.desc()).limit(30))
    return [{"id": str(record.id), "field": record.field, "status": record.status,
             "work_version": record.work_version, "created_at": record.created_at.replace(tzinfo=UTC) if record.created_at.tzinfo is None else record.created_at,
             "is_current": bool(work and record.artifact_hash == work.source_hash)} for record in records]
