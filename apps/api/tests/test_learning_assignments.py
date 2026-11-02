"""Real HTTP persistence/auth and static rubric checks; no mocked run receipts."""

import hashlib
import json

import pytest
from sqlalchemy import select

from app.content.curriculum import assignments
from app.content.curriculum.artifact_checks import evaluate, fields_for
from app.db.session import get_db
from app.models.learning import LearningMissionWork
from app.services.learning_curriculum import get_published_catalogue


def register(client, email="assignment@example.com"):
    assert client.post("/api/v1/auth/signup", json={
        "email": email, "display_name": "경로 확인", "password": "a-secure-password",
    }).status_code == 201
    response = client.post("/api/v1/learning/enrollments", json={"course_key": "WEB-FS-01"})
    assert response.status_code == 201
    return f"/api/v1/learning/enrollments/{response.json()['id']}"


def set_level(client, base, level, version=0):
    response = client.put(base + "/path", json={"expected_version": version, "level": level})
    assert response.status_code == 200, response.text
    return response.json()


def save(client, base, node, answers=None, version=0, key=None):
    return client.put(f"{base}/nodes/{node}/work", json={
        "expected_version": version, "answers": answers or {}, "expected_assignment_key": key,
    })


def test_saved_mission_scope_survives_path_change_and_relogin(client):
    base = register(client)
    set_level(client, base, "BEGINNER")
    details = client.get(base + "/nodes/M03").json()
    saved = save(client, base, "M03", {"source": "<form>저장한 코드</form>"}, key=details["assignment"]["key"])
    assert saved.status_code == 200
    assert saved.json()["assignment"]["level"] == "BEGINNER"
    set_level(client, base, "EXPERIENCED", 1)
    assert client.post("/api/v1/auth/logout").status_code in {200, 204}
    assert client.post("/api/v1/auth/login", json={"email": "assignment@example.com", "password": "a-secure-password"}).status_code == 200
    reopened = client.get(base + "/nodes/M03").json()
    assert reopened["work"]["answers"] == saved.json()["answers"]
    assert reopened["assignment"]["level"] == "BEGINNER"
    assert reopened["assignment"]["pinned"]
    assert client.get(base + "/nodes/M04").json()["assignment"]["level"] == "EXPERIENCED"
    assert client.get(base + "/path").json()["level"] == "EXPERIENCED"


def test_stale_path_and_first_save_do_not_silently_change_assignment(client):
    base = register(client)
    first = client.get(base + "/nodes/M05").json()
    set_level(client, base, "EXPERIENCED")
    stale = client.put(base + "/path", json={"expected_version": 0, "level": "BEGINNER"})
    assert stale.status_code == 409
    assert save(client, base, "M05", key=first["assignment"]["key"]).status_code == 409
    assert client.get(base + "/nodes/M05").json()["work"]["version"] == 0
    current = client.get(base + "/nodes/M05").json()
    assert save(client, base, "M05", key=current["assignment"]["key"]).status_code == 200
    assert save(client, base, "M05", {"source": "a different edit"}, version=0, key=current["assignment"]["key"]).status_code == 409


def test_identical_retry_after_lost_response_reuses_the_saved_version(client):
    base = register(client)
    key = client.get(base + "/nodes/M03").json()["assignment"]["key"]
    answers = {"source": "<form>처음 저장한 코드</form>", "observation": "아직 실행하지 않은 초안입니다."}
    first = save(client, base, "M03", answers, key=key)
    assert first.status_code == 200
    retry = save(client, base, "M03", dict(reversed(list(answers.items()))), key=key)
    assert retry.status_code == 200
    assert retry.json()["version"] == first.json()["version"] == 1
    assert retry.json()["feedback"] is None
    assert save(client, base, "M03", answers, version=2, key=key).status_code == 409
    assert save(client, base, "M03", answers, key="forged-key").status_code == 409
    changed = {**answers, "source": "<form>newer server code</form>"}
    assert save(client, base, "M03", changed, version=1, key=key).status_code == 200
    assert save(client, base, "M03", answers, key=key).status_code == 409
    assert client.get(base + "/nodes/M03").json()["work"]["answers"] == changed


def test_workspace_version_check_is_read_only_and_keeps_the_saved_scope(client):
    base = register(client)
    assert save(client, base, "M01", {"goal": "서버에 저장할 목표입니다."}).status_code == 200
    initial = client.get(base + "/workspace").json()
    assert next(item for item in initial["missions"] if item["id"] == "M01")["work_version"] == 1
    dependency = client.app.dependency_overrides[get_db]()
    db = next(dependency)
    try:
        record = db.scalar(select(LearningMissionWork).where(LearningMissionWork.node_id == "M01"))
        assert record.retrieved_version == 0
    finally:
        dependency.close()
    key = client.get(base + "/nodes/M03").json()["assignment"]["key"]
    assert save(client, base, "M03", {"source": "<form>draft</form>"}, key=key).status_code == 200
    set_level(client, base, "EXPERIENCED")
    state = client.get(base + "/workspace").json()
    saved = next(item for item in state["missions"] if item["id"] == "M03")
    assert saved["work_version"] == 1
    assert saved["assignment_title"] == assignments.LEVEL_TITLES["BEGINNER"]
    assert next(item for item in state["missions"] if item["id"] == "M04")["assignment_title"] is None


def test_path_and_assignment_are_owned_by_authenticated_user(client):
    base = register(client)
    other = register(client, "other-assignment@example.com")
    assert other != base
    assert client.get(base + "/path").status_code == 404
    assert client.put(base + "/path", json={"expected_version": 0, "level": "EXPERIENCED"}).status_code == 404
    assert client.get(base + "/nodes/M03").status_code == 404
    assert save(client, base, "M03").status_code == 404
    assert client.post("/api/v1/auth/logout").status_code in {200, 204}
    assert client.get(other + "/path").status_code == 401


def test_legacy_saved_mission_keeps_its_rubric_and_completion_receipt(client):
    base = register(client)
    node = "M05"
    answers = {"source": "previous saved code", "observation": "기존 답안"}
    digest = hashlib.sha256(json.dumps(answers, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    dependency = client.app.dependency_overrides[get_db]()
    db = next(dependency)
    try:
        from uuid import UUID
        work = LearningMissionWork(enrollment_id=UUID(base.rsplit('/', 1)[-1]), node_id=node,
                                   answers=answers, source_hash=digest, submitted_hash=digest,
                                   feedback={"passed": True, "issues": {}, "prerequisite_hashes": {}})
        db.add(work)
        db.commit()
    finally:
        dependency.close()
    set_level(client, base, "BEGINNER")
    details = client.get(base + f"/nodes/{node}").json()
    assert details["assignment"]["version"] == "legacy"
    assert details["assignment"]["transfer_required"]
    assert details["work"]["answers"] == answers
    assert details["work"]["feedback"]["passed"] is True
    assert not any(field.get("optional") for field in details["fields"])
    dependency = client.app.dependency_overrides[get_db]()
    db = next(dependency)
    try:
        stored = db.scalar(select(LearningMissionWork).where(LearningMissionWork.node_id == node))
        assert stored.assignment is None
        assert stored.submitted_hash == digest
    finally:
        dependency.close()


@pytest.mark.parametrize("node,required", [("M05", False), ("M07", False), ("M10", False), ("M12", True)])
def test_beginner_transfer_scope_is_optional_until_capstone(node, required):
    assignment = assignments.new_assignment(node, "BEGINNER", 0)
    assert assignment["transfer_required"] is required


@pytest.mark.parametrize("level,node,required", [
    ("PRACTICED", "M05", False), ("PRACTICED", "M07", False),
    ("PRACTICED", "M10", True), ("PRACTICED", "M12", True),
    ("EXPERIENCED", "M05", True), ("EXPERIENCED", "M07", True),
    ("EXPERIENCED", "M10", True), ("EXPERIENCED", "M12", True),
])
def test_required_transfer_fields_change_with_scope(level, node, required):
    catalogue = get_published_catalogue("WEB-FS-01")
    mission = next(item for item in catalogue["missions"] if item["id"] == node)
    assignment = assignments.new_assignment(node, level, 0)
    fields = assignments.fields_for_assignment(fields_for(mission), assignment, node)
    answers = {field["id"]: "작성한 내용을 충분한 길이로 남겨 봅니다." * 3 for field in fields if not field["id"].startswith("transfer_")}
    answers.update(concept_answer=mission["concept_check"]["answer"])
    if not required:
        answers["transfer_mode"] = assignments.TRANSFER_LATER
    selected = assignments.required_fields(fields, assignment, answers, node)
    # Static presence checks only. This does not claim a runtime pass.
    result = evaluate(mission, answers, reopened=True, fields=selected)
    assert ("transfer_source" in result["issues"]) is required
    assert assignments.transfer_enabled(assignment, answers, node) is required
    if not required:
        answers["transfer_mode"] = assignments.TRANSFER_TRY
        selected = assignments.required_fields(fields, assignment, answers, node)
        assert "transfer_source" in evaluate(mission, answers, reopened=True, fields=selected)["issues"]


def test_mission_starters_change_without_touching_predecessor_api(client):
    base = register(client)
    beginner = client.get(base + "/nodes/M03").json()
    assert 'name="title"' in beginner["starter_code"]
    set_level(client, base, "PRACTICED")
    practiced = client.get(base + "/nodes/M03").json()
    set_level(client, base, "EXPERIENCED", 1)
    advanced = client.get(base + "/nodes/M03").json()
    assert len({beginner["starter_code"], practiced["starter_code"], advanced["starter_code"]}) == 3
    assert save(client, base, "M09", {"source": "# learner API remains intact"}).status_code == 200
    assert client.get(base + "/nodes/M10").json()["starter_files"]["api_source"] == "# learner API remains intact"


@pytest.mark.parametrize("level", ["BEGINNER", "PRACTICED", "EXPERIENCED"])
def test_html_functional_checks_remain_required_at_every_level(client, level):
    base = register(client)
    set_level(client, base, level)
    catalogue = get_published_catalogue("WEB-FS-01")
    for node_id in ["M01", "M02"]:
        node = next(item for item in catalogue["missions"] if item["id"] == node_id)
        details = client.get(base + f"/nodes/{node_id}").json()
        answers = {field["id"]: field["choices"][0] if field["kind"] == "choice" else field["id"] + " 입력과 처리 및 저장 결과를 실제로 확인합니다." for field in details["fields"]}
        answers["concept_answer"] = node["concept_check"]["answer"]
        assert save(client, base, node_id, answers).status_code == 200
        assert client.get(base + f"/nodes/{node_id}").status_code == 200
        result = client.post(base + f"/nodes/{node_id}/submit", json={"expected_version": 1})
        assert result.status_code == 200, result.text
        assert result.json()["feedback"]["passed"], result.text
    answers = {"source": "<form><input></form>", "prediction": "label과 입력 요소를 연결하면 클릭으로 이동할 수 있어요.",
               "observation": "제목과 내용 입력의 label 연결과 제출 버튼을 확인했습니다.",
               "concept_answer": next(item for item in catalogue["missions"] if item["id"] == "M03")["concept_check"]["answer"]}
    assert save(client, base, "M03", answers).status_code == 200
    result = client.post(base + "/nodes/M03/submit", json={"expected_version": 1})
    assert result.status_code == 200
    assert result.json()["feedback"]["passed"] is False
    assert "source" in result.json()["feedback"]["issues"]
    answers["source"] = '<form><label for="title">제목</label><input id="title" name="title"><label for="content">내용</label><textarea id="content" name="content"></textarea><button type="submit">저장</button></form>'
    assert save(client, base, "M03", answers, version=1).status_code == 200
    result = client.post(base + "/nodes/M03/submit", json={"expected_version": 2})
    assert result.status_code == 200
    assert result.json()["feedback"]["passed"], result.text
    assert "M03" in client.get(base + "/workspace").json()["completed_ids"]
