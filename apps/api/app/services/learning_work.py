"""Persistent learning artifacts and deterministic planning checks."""

import hashlib
import json
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.content.curriculum.artifact_checks import SUPPORTED_MISSIONS, evaluate, fields_for
from app.content.curriculum.course_runtime_contract import CHECK_IDS as COURSE_CHECK_IDS
from app.content.curriculum.course_runtime_contract import CONTRACTS
from app.content.curriculum.html_form_checks import STARTER_CODE
from app.content.curriculum.js_form_contract import SCOPE as JS_SCOPE
from app.content.curriculum.js_form_contract import STARTER_CODE as JS_STARTER
from app.models.auth import User
from app.models.learning import (
    LearningAssessmentEvidence,
    LearningEnrollment,
    LearningExecution,
    LearningMissionWork,
    LearningProjectExport,
)
from app.services import learning_execution, learning_js
from app.services.learning_curriculum import get_published_catalogue


def _context(db: Session, user: User, enrollment_id: UUID, *, lock: bool = False):
    query = select(LearningEnrollment).where(
        LearningEnrollment.id == enrollment_id, LearningEnrollment.user_id == user.id,
    )
    enrollment = db.scalar(query.with_for_update() if lock else query)
    if enrollment is None:
        raise HTTPException(404, "학습 등록을 찾지 못했습니다.")
    catalogue = get_published_catalogue(enrollment.course_key)
    if catalogue is None or catalogue["content_version"] != enrollment.content_version or catalogue["rubric_version"] != enrollment.rubric_version:
        raise HTTPException(409, "학습 과정 버전이 변경되었습니다. 과정 목록에서 현재 버전을 열어 주세요.")
    works = {work.node_id: work for work in db.scalars(select(LearningMissionWork).where(LearningMissionWork.enrollment_id == enrollment.id))}
    return enrollment, catalogue, works


def _node(catalogue: dict, node_id: str) -> dict:
    node = next((node for node in [*catalogue["missions"], *catalogue["core_lessons"]] if node["id"] == node_id), None)
    # Runtime handlers are an allowlist. A registry path alone never enables a task.
    if node is None or (node_id.startswith("M") and (node.get("publication_state") != "published" or node_id not in SUPPORTED_MISSIONS)):
        raise HTTPException(404, "아직 준비 중인 학습입니다.")
    return node


def _passed(work: LearningMissionWork | None) -> bool:
    return bool(work and work.submitted_hash == work.source_hash and work.feedback and work.feedback.get("passed"))


def _completed(catalogue: dict, works: dict) -> set[str]:
    completed: set[str] = set()
    for node in catalogue["missions"]:
        work = works.get(node["id"])
        dependencies = {parent: works[parent].source_hash for parent in node["prerequisites"] if parent in works}
        if (
            _passed(work) and set(node["prerequisites"]).issubset(completed)
            and work.feedback.get("prerequisite_hashes", {}) == dependencies
        ):
            completed.add(node["id"])
    return completed


def _work_response(work: LearningMissionWork | None, *, blocked: bool = False) -> dict:
    if work is None:
        return {"version": 0, "answers": {}, "status": "NOT_STARTED", "feedback": None, "updated_at": None, "reopened": False}
    stale = work.submitted_hash is not None and (work.submitted_hash != work.source_hash or blocked)
    state = "STALE" if stale else "PASSED" if _passed(work) else "NEEDS_WORK" if work.feedback else "DRAFT"
    return {
        "version": work.version, "answers": work.answers, "status": state,
        "feedback": work.feedback, "updated_at": work.updated_at,
        "reopened": work.retrieved_version == work.version,
    }


def workspace(db: Session, user: User, enrollment_id: UUID) -> dict:
    enrollment, catalogue, works = _context(db, user, enrollment_id)
    completed = _completed(catalogue, works)
    return {
        "current_node_id": enrollment.current_node_id,
        "completed_ids": sorted(completed),
        "missions": [{
            "id": node["id"], "title": node["title"], "unit_id": node["unit_id"],
            "available": node.get("publication_state") == "published" and node["id"] in SUPPORTED_MISSIONS,
            "unlocked": set(node["prerequisites"]).issubset(completed),
            "status": _work_response(works.get(node["id"]), blocked=not set(node["prerequisites"]).issubset(completed) or (_passed(works.get(node["id"])) and node["id"] not in completed))["status"],
        } for node in catalogue["missions"]],
        "foundations": [{"id": node["id"], "title": node["title"], "status": _work_response(works.get(node["id"]))["status"]} for node in catalogue["core_lessons"]],
    }


def portfolio(db: Session, user: User, enrollment_id: UUID) -> dict:
    """Export only this owner's saved work and matching server receipts."""
    enrollment, catalogue, works = _context(db, user, enrollment_id)
    completed = _completed(catalogue, works)
    executions = list(db.scalars(select(LearningExecution).where(
        LearningExecution.enrollment_id == enrollment.id, LearningExecution.user_id == user.id,
    ).order_by(LearningExecution.created_at)))
    return {
        "format": "weblink-learning-portfolio-v1", "course_id": enrollment.course_key,
        "content_version": enrollment.content_version, "rubric_version": enrollment.rubric_version,
        "completed_ids": sorted(completed), "course_completed": all(node["id"] in completed for node in catalogue["missions"]),
        "scope": "서버에 저장한 답안과 해당 답안 해시의 실행 기록입니다. 인증서나 브라우저 E2E 검증 결과가 아닙니다. 이 파일을 자동으로 복원하거나 새 프로젝트에 등록하지는 않습니다.",
        "project_exports": [{"node_id": item.node_id, "field": item.field,
                             "project_id": str(item.project_id) if item.project_id else None,
                             "revision_id": str(item.revision_id) if item.revision_id else None,
                             "revision_hash": item.revision_hash, "artifact_hash": item.artifact_hash,
                             "work_version": item.work_version, "created_at": item.created_at}
                            for item in db.scalars(select(LearningProjectExport).where(LearningProjectExport.enrollment_id == enrollment.id))],
        "missions": [{
            "id": node["id"], "title": node["title"],
            "work": _work_response(works.get(node["id"]), blocked=node["id"] not in completed and _passed(works.get(node["id"]))),
            "executions": [{"id": str(record.id), "field": record.field, "status": record.status,
                            "artifact_hash": record.artifact_hash, "work_version": record.work_version,
                            "created_at": record.created_at, "result": record.result}
                           for record in executions if record.node_id == node["id"] and node["id"] in works and record.artifact_hash == works[node["id"]].source_hash],
        } for node in catalogue["missions"]],
    }


def node_details(db: Session, user: User, enrollment_id: UUID, node_id: str) -> dict:
    _, catalogue, works = _context(db, user, enrollment_id, lock=True)
    node = _node(catalogue, node_id)
    work = works.get(node_id)
    if work:
        work.retrieved_version = work.version
        db.commit()
        db.refresh(work)
    completed = _completed(catalogue, works)
    blocked = not set(node.get("prerequisites", [])).issubset(completed)
    check = node["concept_check"]
    starter_files = dict(CONTRACTS.get(node_id, {}).get("starter_files", {}))
    if node_id == "M10" and works.get("M09"):
        starter_files["api_source"] = works["M09"].answers.get("source", starter_files["api_source"])
    starter_code = STARTER_CODE if node_id == "M03" else JS_STARTER if node_id == "M04" else CONTRACTS.get(node_id, {}).get("starter")
    if node_id == "M11" and works.get("M10"):
        previous = works["M10"].answers
        starter_code = previous.get("source", starter_code)
        starter_files.update({"source": starter_code, "baseline_source": starter_code,
                              "api_source": previous.get("api_source", starter_files["api_source"]),
                              "baseline_api_source": previous.get("api_source", starter_files["baseline_api_source"])})
    return {
        "id": node_id, "title": node["title"], "objective": node["objective"],
        "prediction": node["prediction"], "practice": node["micro_practice"],
        "task": node.get("student_task", node["micro_practice"]["task"]),
        "recovery": node["recovery"], "fields": fields_for(node),
        "concept_check": {key: check[key] for key in ("id", "prompt", "choices")},
        "foundation_ids": node.get("foundation_ids", []),
        "next_ids": node["next"], "unlocked": not blocked,
        "work": _work_response(work, blocked=blocked or (node_id.startswith("M") and _passed(work) and node_id not in completed)),
        "starter_code": starter_code,
        "starter_transfer_code": CONTRACTS.get(node_id, {}).get("transfer_starter"),
        "starter_files": starter_files,
        "runtime": {key: value for key, value in CONTRACTS.get(node_id, {}).items() if key in {"language", "filename", "scope"}},
        "transfer_task": next((item["task"] for item in catalogue["transfer_checks"] if item["mission_id"] == node_id), None),
    }


def save_work(db: Session, user: User, enrollment_id: UUID, node_id: str, expected_version: int, answers: dict[str, str]) -> dict:
    _, catalogue, works = _context(db, user, enrollment_id, lock=True)
    node = _node(catalogue, node_id)
    work = works.get(node_id)
    if expected_version != (work.version if work else 0):
        raise HTTPException(409, "다른 창에서 저장된 내용이 있습니다. 현재 입력을 내려받은 뒤 저장본을 다시 열어 주세요.")
    allowed = {field["id"] for field in fields_for(node)} | {"concept_answer"}
    if not set(answers).issubset(allowed):
        raise HTTPException(422, "이 학습에서 사용하지 않는 작성 항목이 있습니다.")
    digest = hashlib.sha256(json.dumps(answers, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    if work is None:
        work = LearningMissionWork(enrollment_id=enrollment_id, node_id=node_id, version=1, retrieved_version=0, answers=answers, source_hash=digest)
        db.add(work)
    elif digest != work.source_hash:
        work.version += 1
        work.answers = answers
        work.source_hash = digest
    db.commit()
    db.refresh(work)
    completed = _completed(catalogue, works)
    return _work_response(work, blocked=not set(node.get("prerequisites", [])).issubset(completed) or (node_id.startswith("M") and _passed(work) and node_id not in completed))


def submit_work(db: Session, user: User, enrollment_id: UUID, node_id: str, expected_version: int) -> dict:
    enrollment, catalogue, works = _context(db, user, enrollment_id, lock=True)
    node = _node(catalogue, node_id)
    work = works.get(node_id)
    if work is None or work.version != expected_version:
        raise HTTPException(409, "현재 저장본과 작성 버전이 다릅니다. 먼저 저장본을 확인해 주세요.")
    if not set(node.get("prerequisites", [])).issubset(_completed(catalogue, works)):
        raise HTTPException(409, "선수 미션을 먼저 확인해 주세요. 기존 작성 내용은 보존됩니다.")
    result = evaluate(node, work.answers, reopened=work.retrieved_version == work.version)
    if node_id in {"M04", "M05", "M06", "M07", "M08", "M09", "M10", "M11", "M12"}:
        execution = _execution(db, enrollment, work, "source")
        if execution["status"] == "UNAVAILABLE":
            db.add(LearningAssessmentEvidence(
                enrollment_id=enrollment.id, user_id=user.id, mission_id=node_id,
                assessment_id=f"WEB-{node_id}-EXECUTION", assessment_type="FUNCTIONAL",
                content_version=enrollment.content_version, rubric_version=enrollment.rubric_version,
                status="UNAVAILABLE", payload={"artifact_hash": work.source_hash, "work_version": work.version},
            ))
            db.commit()
            raise HTTPException(503, "실행기를 사용할 수 없어 제출을 판정하지 않았어요. 저장된 답안과 이전 기록은 유지됩니다.")
        result["checks"] = list(execution.get("checks", []))
        result["execution"] = execution
        result["scope"] = JS_SCOPE if node_id == "M04" else CONTRACTS[node_id]["scope"]
        if execution["status"] != "COMPLETED" or not all(check["passed"] for check in execution["checks"]):
            result["issues"]["source"] = execution.get("error") or "실행 결과의 항목별 안내를 보고 다시 수정해 주세요."
            if execution["status"] != "COMPLETED":
                result["checks"].append({"id": f"WEB-{node_id}-EXECUTION", "label": "실행 완료 여부", "passed": False, "message": result["issues"]["source"]})
        if node_id in {"M05", "M07", "M10", "M12"} and len(work.answers.get("transfer_source", "").strip()) >= 20:
            transfer = _execution(db, enrollment, work, "transfer_source")
            if transfer["status"] == "UNAVAILABLE":
                raise HTTPException(503, "전이 과제 실행을 완료하지 못했어요. 저장본을 보존하고 판정을 보류합니다.")
            passed = transfer["status"] == "COMPLETED" and bool(transfer.get("checks")) and all(check["passed"] for check in transfer["checks"])
            result["transfer"] = transfer
            result["checks"].append({"id": f"WEB-{node_id}-X1", "label": "다른 문제에 적용하기", "passed": passed, "message": "전이 과제 실행 확인 완료" if passed else transfer.get("error") or "전이 과제 실행 결과를 다시 살펴보세요.", "assessment_type": "TRANSFER"})
            if not passed:
                result["issues"]["transfer_source"] = "전이 과제의 실행 항목을 모두 확인해 주세요."
        if node_id == "M11":
            baseline = _execution(db, enrollment, work, "baseline_source")
            if baseline["status"] == "UNAVAILABLE":
                raise HTTPException(503, "실패 재현 환경을 사용할 수 없어 판정을 보류합니다. 저장본은 유지됩니다.")
            failed = baseline["status"] == "CODE_ERROR" or (baseline["status"] == "COMPLETED" and any(not item["passed"] for item in baseline.get("checks", [])))
            changed = any(work.answers.get(old, "").strip() != work.answers.get(new, "").strip() for old, new in [("baseline_source", "source"), ("baseline_api_source", "api_source")])
            if not failed:
                result["issues"]["baseline_source"] = "실패 재현본에서 실제 코드 오류나 실패 항목을 먼저 관찰하세요. 인프라 장애·시간 초과는 재현으로 세지 않습니다."
            if not changed:
                result["issues"]["source"] = "실패 재현본과 다른 수정 코드를 저장하고 다시 실행하세요."
            result["checks"].append({"id": "WEB-M11-DEBUG", "label": "실제 실패 재현과 코드 변경", "passed": failed and changed, "message": "실패 재현 기록과 다른 코드의 재실행을 확인합니다. 원인 설명의 타당성을 자동 평가하지 않습니다."})
            result["baseline"] = {"status": baseline["status"], "checks": baseline.get("checks", []), "error": baseline.get("error")}
        result["passed"] = not result["issues"]
    result["prerequisite_hashes"] = {parent: works[parent].source_hash for parent in node.get("prerequisites", [])}
    if work.submitted_hash != work.source_hash or work.feedback != result:
        work.feedback = result
        work.submitted_hash = work.source_hash
        check_records = result.get("checks") or [{
            "id": f"WEB-{node_id}-EXECUTION" if node_id in {"M04", "M05", "M06", "M07", "M08", "M09", "M10", "M11", "M12"} else (node["artifact_check_ids"] or node["test_ids"])[0] if node_id.startswith("M") else node["concept_check"]["id"],
            "passed": result["passed"], "message": result["scope"],
        }]
        for check in check_records:
            db.add(LearningAssessmentEvidence(
                enrollment_id=enrollment.id, user_id=user.id, mission_id=node_id,
                assessment_id=check["id"], assessment_type=check.get("assessment_type", "FUNCTIONAL" if node_id.startswith("M") else "CONCEPT"),
                content_version=enrollment.content_version, rubric_version=enrollment.rubric_version,
                status="PASSED" if check["passed"] else "FAILED",
                payload={"artifact_hash": work.source_hash, "work_version": work.version, "message": check["message"]},
            ))
        if node_id.startswith("M"):
            db.add(LearningAssessmentEvidence(
                enrollment_id=enrollment.id, user_id=user.id, mission_id=node_id,
                assessment_id=node["concept_check"]["id"], assessment_type="CONCEPT",
                content_version=enrollment.content_version, rubric_version=enrollment.rubric_version,
                status="FAILED" if "concept_answer" in result["issues"] else "PASSED",
                payload={"artifact_hash": work.source_hash, "work_version": work.version},
            ))
    db.commit()
    db.refresh(work)
    return _work_response(work)


def hint(db: Session, user: User, enrollment_id: UUID, node_id: str, level: int) -> dict:
    _, catalogue, _ = _context(db, user, enrollment_id)
    node = _node(catalogue, node_id)
    return {"level": level, "text": node["hints"][f"H{level}"], "recovery": node["recovery"]}


def _execution(db, enrollment, work, field):
    if work.node_id in {"M04", "M05"}:
        return learning_js.execute(work.answers.get(field, ""), work.node_id, "books" if field == "transfer_source" else "board")
    record = learning_execution.find(db, enrollment.id, work.node_id, work.source_hash, field)
    if record is None or record.status in {"QUEUED", "RUNNING"}:
        raise HTTPException(409, "먼저 현재 저장본의 본 과제와 전이 과제를 실행하고 결과를 확인해 주세요.")
    result = record.result or {"status": "UNAVAILABLE"}
    if result.get("status") == "COMPLETED":
        expected = [f"WEB-{work.node_id}-X1-T{index}" for index in range(1, 15 if work.node_id in {"M10", "M12"} else 10)] if field == "transfer_source" else COURSE_CHECK_IDS[work.node_id]
        checks = result.get("checks", [])
        if [check.get("id") for check in checks] != expected or any(type(check.get("passed")) is not bool for check in checks):
            return {"status": "UNAVAILABLE", "checks": []}
    return result


def run_code(db: Session, user: User, enrollment_id: UUID, node_id: str, expected_version: int, field: str = "source") -> dict:
    enrollment, catalogue, works = _context(db, user, enrollment_id, lock=True)
    node = _node(catalogue, node_id)
    if node_id not in {"M04", "M05", "M06", "M07", "M08", "M09", "M10", "M11", "M12"} or field not in {"source", "transfer_source", "baseline_source"} or (field == "transfer_source" and node_id not in {"M05", "M07", "M10", "M12"}) or (field == "baseline_source" and node_id != "M11"):
        raise HTTPException(404, "이 학습에는 해당 실행이 연결되어 있지 않습니다.")
    work = works.get(node_id)
    if work is None or work.version != expected_version:
        raise HTTPException(409, "먼저 현재 코드를 저장한 뒤 다시 실행해 주세요.")
    if not set(node["prerequisites"]).issubset(_completed(catalogue, works)):
        raise HTTPException(409, "선수 미션을 먼저 확인해 주세요.")
    if node_id in {"M06", "M07", "M08", "M09", "M10", "M11", "M12"}:
        return learning_execution.queue(db, user, enrollment, work, field)
    result = _execution(db, enrollment, work, field)
    return {**result, "work_version": work.version, "source_hash": work.source_hash, "scope": JS_SCOPE if node_id == "M04" else CONTRACTS[node_id]["scope"]}
