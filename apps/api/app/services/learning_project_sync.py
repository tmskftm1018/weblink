"""Compare base/project/learning files, then apply an explicitly reviewed merge."""

import hashlib
import json

from fastapi import HTTPException
from sqlalchemy import select

from app.models.learning import LearningAssessmentEvidence, LearningProjectExport
from app.models.projects import ProjectDraft, ProjectRevision
from app.repositories import projects as repository
from app.schemas.projects import ProjectFileInput
from app.services import learning_work, projects
from app.services.learning_handoff import MANAGED_PATHS, source_origin
from app.services.learning_project_files import project_files


def _hash(files):
    snapshot = sorted(files, key=lambda item: item["path"])
    return hashlib.sha256(json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _context(db, user, enrollment_id, node_id, version, field, *, lock=False):
    enrollment, catalogue, works = learning_work._context(db, user, enrollment_id, lock=lock)
    if node_id not in {"M10", "M12"} or field not in {"source", "transfer_source"}:
        raise HTTPException(422, "M10/M12의 본 과제 또는 전이 과제를 선택해 주세요.")
    work = works.get(node_id)
    if work is None or work.version != version:
        raise HTTPException(409, "학습 저장본이 바뀌었어요. 새 저장본으로 다시 비교해 주세요.")
    exported = db.scalar(select(LearningProjectExport).where(
        LearningProjectExport.enrollment_id == enrollment.id,
        LearningProjectExport.node_id == node_id, LearningProjectExport.field == field))
    if exported is None or exported.project_id is None:
        raise HTTPException(409, "먼저 이 과제를 개인 프로젝트로 가져와 주세요.")
    project, role = repository.get_access(db, exported.project_id, user.id)
    if project is None or project.owner_id != user.id or role != "OWNER":
        raise HTTPException(404, "본인 소유의 프로젝트를 찾지 못했어요.")
    draft_query = select(ProjectDraft).where(ProjectDraft.project_id == project.id)
    draft = db.scalar(draft_query.with_for_update() if lock else draft_query)
    if draft is None:
        raise HTTPException(409, "프로젝트 초안을 찾지 못했어요.")
    if node_id not in learning_work._completed(catalogue, works):
        raise HTTPException(409, "변경한 학습 저장본을 실행·제출한 뒤 프로젝트에 반영해 주세요.")
    receipt = learning_work._execution(db, enrollment, work, field)
    if receipt.get("status") != "COMPLETED" or not receipt.get("checks") or not all(check["passed"] for check in receipt["checks"]):
        raise HTTPException(409, "현재 학습 저장본의 실행을 먼저 확인해 주세요.")
    baseline = exported.baseline_files
    if baseline is None:
        revision = db.scalar(select(ProjectRevision).where(ProjectRevision.id == exported.revision_id, ProjectRevision.project_id == project.id))
        if revision is None:
            raise HTTPException(409, "최초 가져오기 버전이 없어 안전하게 비교할 수 없어요. 코드를 내려받아 직접 비교해 주세요.")
        baseline = {item["path"]: item["content"] for item in revision.snapshot if item["path"] in MANAGED_PATHS}
    if set(baseline) != MANAGED_PATHS:
        raise HTTPException(409, "가져오기 기준 파일이 부족해 자동 반영을 보류합니다.")
    origin = source_origin(enrollment, work, node_id, field, receipt)
    api_field = "transfer_api_source" if field == "transfer_source" else "api_source"
    incoming = {item.path: item.content for item in project_files(work.answers[field], work.answers[api_field], origin) if item.path in MANAGED_PATHS}
    current = {item.path: item.content for item in repository.list_files(db, project.id)}
    changes = []
    for path in sorted(MANAGED_PATHS):
        base, local, learned = baseline[path], current.get(path), incoming[path]
        state = "MATCH" if local == learned else "KEEP" if learned == base else "UPDATE" if local == base else "CONFLICT"
        changes.append({"path": path, "state": state, "base": base, "project": local, "learning": learned})
    return enrollment, work, exported, project, draft, current, incoming, changes


def preview(db, user, enrollment_id, node_id, payload):
    _, work, _, project, draft, current, _, changes = _context(db, user, enrollment_id, node_id, payload.expected_version, payload.field)
    return {"project_id": str(project.id), "project_name": project.name,
            "work_version": work.version, "expected_draft_version": draft.version,
            "expected_project_hash": _hash([{"path": path, "content": content} for path, content in current.items()]),
            "changes": changes, "scope": "이전에 가져온 학습 원본·현재 서버 프로젝트·새 학습 답안을 비교합니다. 내 컴퓨터 폴더의 미전송 파일이나 다른 창의 미저장 편집은 포함하지 않습니다. 앱 재실행 통과를 뜻하지 않습니다."}


def apply(db, user, enrollment_id, node_id, payload):
    enrollment, work, exported, project, draft, current, incoming, changes = _context(db, user, enrollment_id, node_id, payload.expected_version, payload.field, lock=True)
    project_hash = _hash([{"path": path, "content": content} for path, content in current.items()])
    if draft.version != payload.expected_draft_version or project_hash != payload.expected_project_hash:
        raise HTTPException(409, "비교한 뒤 프로젝트가 바뀌었어요. 기존 내용은 유지하고 새로 비교해 주세요.")
    conflicts = {item["path"] for item in changes if item["state"] == "CONFLICT"}
    if set(payload.resolutions) != conflicts:
        raise HTTPException(422, "충돌한 파일마다 프로젝트 유지 또는 학습 코드 사용을 선택해 주세요.")
    merged = dict(current)
    for item in changes:
        if item["state"] == "UPDATE" or (item["state"] == "CONFLICT" and payload.resolutions[item["path"]] == "USE_LEARNING"):
            merged[item["path"]] = item["learning"]
    files = [ProjectFileInput(path=path, content=content) for path, content in merged.items()]
    if len(files) > 50:
        raise HTTPException(422, "반영하면 파일이 50개를 넘어요. 기존 파일을 정리한 뒤 다시 비교해 주세요.")
    try:
        validated = projects._validate_files(files)
    except projects.InvalidDraft as exc:
        raise HTTPException(422, "반영할 프로젝트가 1MB 제한을 넘어요. 파일을 정리해 주세요.") from exc
    changed = _hash(validated) != project_hash
    already_applied = not changed and exported.artifact_hash == work.source_hash and exported.baseline_files == incoming
    if already_applied:
        return {"project_id": str(project.id), "changed": False, "draft_version": draft.version, "message": "이미 확인한 학습 변경사항입니다. 프로젝트 파일은 그대로 유지했습니다."}
    if changed:
        # Preserve the server draft too, even if it had never been made a revision.
        projects.create_revision(db, user, project.id, commit=False)
        if not repository.advance_draft(db, project.id, payload.expected_draft_version, user.id):
            raise HTTPException(409, "다른 창에서 프로젝트를 저장했어요. 새로 비교해 주세요.")
        repository.replace_files(db, project.id, validated)
        repository.touch_project(db, project.id)
        db.flush()
    revision = projects.create_revision(db, user, project.id, commit=False).revision
    exported.artifact_hash = work.source_hash
    exported.work_version = work.version
    exported.revision_id = revision.id
    exported.revision_hash = revision.source_hash
    # Store the incoming learning baseline, never the merged project: keeping a
    # local edit must remain a local edit on the next comparison too.
    exported.baseline_files = incoming
    db.add(LearningAssessmentEvidence(enrollment_id=enrollment.id, user_id=user.id, mission_id=node_id,
        assessment_id=f"WEB-{node_id}-PROJECT-SYNC", assessment_type="TRANSFER", status="RECORDED",
        content_version=enrollment.content_version, rubric_version=enrollment.rubric_version,
        revision_id=revision.id, revision_hash=revision.source_hash,
        payload={"artifact_hash": work.source_hash, "field": payload.field, "work_version": work.version,
                 "resolutions": payload.resolutions, "project_id": str(project.id),
                 "scope": "선택한 학습 파일 변경을 반영한 출처 기록이며 프로젝트 실행 판정은 아닙니다."}))
    db.commit()
    return {"project_id": str(project.id), "changed": changed,
            "draft_version": payload.expected_draft_version + int(changed),
            "message": "선택한 파일 변경을 반영하고 코드 버전과 학습 출처를 기록했습니다. 앱을 다시 실행해 확인해 주세요."}
