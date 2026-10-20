"""Atomic learning-to-project copies and non-destructive bridge navigation."""

from fastapi import HTTPException
from sqlalchemy import select

from app.models.learning import LearningAssessmentEvidence, LearningProjectExport
from app.models.projects import ProjectRevision
from app.repositories import projects as project_repository
from app.schemas.projects import ProjectCreateRequest
from app.services import learning_curriculum, learning_work, projects
from app.services.learning_project_files import project_files

MANAGED_PATHS = frozenset({"web/src/App.jsx", "api/main.py", ".weblink/original-App.jsx", ".weblink/learning-origin.json"})


def source_origin(enrollment, work, node_id, field, receipt):
    return {"course_id": enrollment.course_key, "content_version": enrollment.content_version,
              "rubric_version": enrollment.rubric_version, "node_id": node_id,
              "field": field, "work_version": work.version, "artifact_hash": work.source_hash,
              "checks": receipt["checks"], "scope": "학습 답안 실행 기록입니다. 생성할 프로젝트의 별도 실행 통과를 뜻하지 않습니다."}


def handoff(db, user, enrollment_id, node_id, expected_version, field):
    enrollment, catalogue, works = learning_work._context(db, user, enrollment_id, lock=True)
    if node_id not in {"M10", "M12"} or field not in {"source", "transfer_source"}:
        raise HTTPException(422, "M10/M12의 본 과제 또는 전이 과제를 선택해 주세요.")
    work = works.get(node_id)
    if work is None or work.version != expected_version:
        raise HTTPException(409, "저장본이 변경되었습니다. 현재 학습 저장본을 확인해 주세요.")
    existing = db.scalar(select(LearningProjectExport).where(
        LearningProjectExport.enrollment_id == enrollment.id,
        LearningProjectExport.node_id == node_id, LearningProjectExport.field == field,
    ))
    if existing:
        project, role = project_repository.get_access(db, existing.project_id, user.id) if existing.project_id else (None, None)
        if project is None or project.owner_id != user.id or role != "OWNER":
            raise HTTPException(409, "이 과제에서 만든 프로젝트가 삭제되었거나 소유권이 변경됐어요. 학습 기록 내려받기로 코드를 보관해 주세요.")
        return {"project_id": str(project.id), "created": False,
                "source_changed": work.source_hash != existing.artifact_hash,
                "revision_id": str(existing.revision_id) if existing.revision_id else None,
                "message": "기존에 만든 프로젝트를 엽니다. 이후 학습 답안이나 프로젝트 수정을 자동 덮어쓰지 않습니다."}
    if node_id not in learning_work._completed(catalogue, works):
        raise HTTPException(409, "본 과제·전이·개념 확인을 현재 저장본으로 제출한 뒤 프로젝트로 이어가세요.")
    api_field = "transfer_api_source" if field == "transfer_source" else "api_source"
    receipt = learning_work._execution(db, enrollment, work, field)
    if receipt.get("status") != "COMPLETED" or not all(check["passed"] for check in receipt.get("checks", [])):
        raise HTTPException(409, "현재 저장본의 실행 결과를 먼저 확인해 주세요.")
    origin = source_origin(enrollment, work, node_id, field, receipt)
    title = ("재고 목록" if node_id == "M10" else "할 일 목록") if field == "transfer_source" else ("나의 게시판" if node_id == "M10" else "나의 메모장")
    files = project_files(work.answers[field], work.answers[api_field], origin)
    workspace = projects.create_project_from_files(db, user,
        ProjectCreateRequest(name=f"{title} · {node_id}", description="WebLink 학습 저장본에서 시작한 개인 React·FastAPI·SQLite 프로젝트"),
        files, commit=False)
    revision = workspace.revisions[0]
    db.add(LearningProjectExport(enrollment_id=enrollment.id, node_id=node_id, field=field,
        artifact_hash=work.source_hash, work_version=work.version, project_id=workspace.id,
        revision_id=revision.id, revision_hash=revision.source_hash,
        baseline_files={item.path: item.content for item in files if item.path in MANAGED_PATHS}))
    db.add(LearningAssessmentEvidence(enrollment_id=enrollment.id, user_id=user.id, mission_id=node_id,
        assessment_id=f"WEB-{node_id}-PROJECT-EXPORT", assessment_type="TRANSFER", status="RECORDED",
        content_version=enrollment.content_version, rubric_version=enrollment.rubric_version,
        revision_id=revision.id, revision_hash=revision.source_hash,
        payload={"artifact_hash": work.source_hash, "work_version": work.version, "field": field,
                 "project_id": str(workspace.id), "scope": "학습 원본에서 프로젝트로 복사한 출처이며 프로젝트 실행 판정은 아닙니다."}))
    if enrollment.project_id is None:
        enrollment.project_id = workspace.id
        enrollment.last_revision_id = revision.id
        enrollment.last_revision_hash = revision.source_hash
        enrollment.last_file_path = "web/src/App.jsx"
        enrollment.last_cursor_line = 1
    db.commit()
    return {"project_id": str(workspace.id), "created": True, "source_changed": False,
            "revision_id": str(revision.id), "message": "학습 코드와 로컬 실행 파일을 개인 프로젝트에 보관했습니다."}


def project_context(db, user, enrollment_id):
    enrollment, catalogue, _ = learning_work._context(db, user, enrollment_id)
    linked = []
    for exported in db.scalars(select(LearningProjectExport).where(LearningProjectExport.enrollment_id == enrollment.id)):
        item, item_role = project_repository.get_access(db, exported.project_id, user.id) if exported.project_id else (None, None)
        if item and item.owner_id == user.id and item_role == "OWNER":
            linked.append({"id": str(item.id), "name": item.name})
    project, role = project_repository.get_access(db, enrollment.project_id, user.id) if enrollment.project_id else (None, None)
    if project is None or project.owner_id != user.id or role != "OWNER":
        return {"project_id": None, "projects": linked, "active_bridge_id": None, "bridges": [], "latest": None, "origin": None}
    if not any(item["id"] == str(project.id) for item in linked):
        linked.append({"id": str(project.id), "name": project.name})
    latest = project_repository.get_latest_revision(db, project.id)
    origin_id = enrollment.return_revision_id if enrollment.active_bridge_id else enrollment.last_revision_id
    origin = db.scalar(select(ProjectRevision).where(ProjectRevision.id == origin_id, ProjectRevision.project_id == project.id)) if origin_id else None
    mission = next((node for node in catalogue["missions"] if node["id"] == enrollment.current_node_id), {})
    recommended = set(mission.get("recommended_bridge_ids", []))
    if enrollment.active_bridge_id:
        recommended.add(enrollment.active_bridge_id)

    def snapshot(revision):
        return {"revision_id": str(revision.id), "source_hash": revision.source_hash, "files": revision.snapshot} if revision else None

    return {"project_id": str(project.id), "project_name": project.name, "projects": linked,
            "active_bridge_id": enrollment.active_bridge_id,
            "file_path": enrollment.return_file_path if enrollment.active_bridge_id else enrollment.last_file_path,
            "cursor_line": enrollment.return_cursor_line if enrollment.active_bridge_id else enrollment.last_cursor_line,
            "latest": snapshot(latest), "origin": snapshot(origin),
            "bridges": [{"id": bridge["id"], "title": bridge["title"], "objective": bridge["objective"],
                         "concepts": bridge["key_concepts"], "observation": bridge["expected_observation"],
                         "foundation_ids": bridge["prerequisites"]} for bridge in catalogue["bridges"] if bridge["id"] in recommended]}


def link_project(db, user, enrollment_id, project_id):
    enrollment, _, _ = learning_work._context(db, user, enrollment_id, lock=True)
    if enrollment.active_bridge_id:
        raise HTTPException(409, "원래 코드로 돌아온 뒤 연결 프로젝트를 바꿔 주세요.")
    context = project_context(db, user, enrollment_id)
    if str(project_id) not in {item["id"] for item in context["projects"]}:
        raise HTTPException(404, "이 학습에서 만든 본인 소유 프로젝트를 선택해 주세요.")
    revision = project_repository.get_latest_revision(db, project_id)
    if revision is None:
        raise HTTPException(409, "프로젝트의 저장 버전이 없습니다.")
    enrollment.project_id = project_id
    enrollment.last_revision_id = revision.id
    enrollment.last_revision_hash = revision.source_hash
    paths = {item["path"] for item in revision.snapshot}
    enrollment.last_file_path = "web/src/App.jsx" if "web/src/App.jsx" in paths else next(iter(sorted(paths)), None)
    enrollment.last_cursor_line = 1
    db.commit()
    return project_context(db, user, enrollment_id)


def bridge(db, user, enrollment_id, payload):
    enrollment, _, _ = learning_work._context(db, user, enrollment_id, lock=True)
    context = project_context(db, user, enrollment_id)
    if context["project_id"] is None:
        raise HTTPException(409, "본인 소유의 연결된 프로젝트가 필요합니다.")
    entering = payload.action == "ENTER"
    if entering and payload.bridge_id not in {item["id"] for item in context["bridges"]}:
        raise HTTPException(422, "현재 미션에서 추천하는 기초 설명을 선택해 주세요.")
    if entering and enrollment.active_bridge_id:
        raise HTTPException(409, "이미 기초 설명을 열었어요. 원래 코드로 돌아간 뒤 다시 선택해 주세요.")
    if not entering and not enrollment.active_bridge_id:
        return context
    try:
        learning_curriculum.update_journey(db, user, enrollment_id,
            current_node_id=enrollment.current_node_id,
            active_bridge_id=payload.bridge_id if entering else None,
            revision_id=payload.revision_id if entering else None,
            file_path=payload.file_path if entering else None,
            cursor_line=payload.cursor_line if entering else None)
    except learning_curriculum.InvalidJourney as exc:
        raise HTTPException(409, "프로젝트 버전이나 파일이 변경됐어요. 저장된 버전에서 파일을 다시 선택해 주세요.") from exc
    return project_context(db, user, enrollment_id)
