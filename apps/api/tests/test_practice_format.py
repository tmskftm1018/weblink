import pytest
from sqlalchemy import select

from app.content.curriculum import assignments
from app.content.curriculum.artifact_checks import ROLE_ANSWERS, evaluate, fields_for
from app.content.curriculum.practice_guides import guide_for
from app.db.session import get_db
from app.models.learning import LearningMissionWork
from app.services.learning_curriculum import get_published_catalogue


def register(client, email="practice@example.com"):
    assert client.post("/api/v1/auth/signup", json={"email": email, "display_name": "실습 확인", "password": "a-secure-password"}).status_code == 201
    response = client.post("/api/v1/learning/enrollments", json={"course_key": "WEB-FS-01"})
    assert response.status_code == 201
    return f"/api/v1/learning/enrollments/{response.json()['id']}"


def test_optional_notes_do_not_replace_code_or_concept_checks():
    node = next(node for node in get_published_catalogue("WEB-FS-01")["missions"] if node["id"] == "M03")
    assignment = assignments.new_assignment("M03", "BEGINNER", 0)
    fields = assignments.fields_for_assignment(fields_for(node), assignment, "M03")
    answers = {"source": '<form><label for="title">제목</label><input id="title" name="title"><label for="content">내용</label><textarea id="content" name="content"></textarea><button type="submit">저장</button></form>', "concept_answer": node["concept_check"]["answer"]}
    required = assignments.required_fields(fields, assignment, answers, "M03")
    assert evaluate(node, answers, reopened=True, fields=required)["passed"]
    assert "source" in evaluate(node, {**answers, "source": "<form></form>"}, reopened=True, fields=required)["issues"]
    assert "concept_answer" in evaluate(node, {**answers, "concept_answer": "wrong"}, reopened=True, fields=required)["issues"]
    old = {**assignment, "version": "level-v1"}
    assert not any(field.get("practice_note") for field in assignments.fields_for_assignment(fields_for(node), old, "M03"))


def test_planning_uses_roles_without_six_repeated_written_answers():
    node = next(node for node in get_published_catalogue("WEB-FS-01")["missions"] if node["id"] == "M02")
    assignment = assignments.new_assignment("M02", "BEGINNER", 0)
    fields = assignments.required_fields(assignments.fields_for_assignment(fields_for(node), assignment, "M02"), assignment, {}, "M02")
    answers = {**ROLE_ANSWERS, "concept_answer": node["concept_check"]["answer"]}
    assert evaluate(node, answers, reopened=True, fields=fields)["passed"]
    assert "api_role" in evaluate(node, {**answers, "api_role": "wrong"}, reopened=True, fields=fields)["issues"]


@pytest.mark.parametrize("node_id", ["M01", "M02", "M11", "M12"])
def test_practice_instructions_preserve_legacy_and_manifest(node_id):
    node = next(item for item in get_published_catalogue("WEB-FS-01")["missions"] if item["id"] == node_id)
    assignment = assignments.new_assignment(node_id, "BEGINNER", 0)
    original_task = node["student_task"]
    display = assignments.presentation(node, assignment)
    assert display["student_task"] != original_task
    assert node["student_task"] == original_task
    assert display["concept_check"] == node["concept_check"]
    assert set(display["hints"]) == set(node["hints"])
    assert assignments.presentation(node, None) is node
    assert assignments.presentation(node, {**assignment, "version": "level-v1"}) is node


def test_practice_node_and_all_hint_levels_use_current_instructions(client):
    base = register(client, "practice-guidance@example.com")
    details = client.get(base + "/nodes/M02").json()
    assert "역할과 개념 답을 선택" in details["task"]
    assert "역할을 구분" in details["objective"]
    for level in range(1, 5):
        response = client.get(base + f"/nodes/M02/hint?level={level}")
        assert response.status_code == 200, response.text
        assert response.json()["text"]
    details = client.get(base + "/nodes/M12").json()
    assert "요구사항 메모는 선택" in details["task"]
    assert "요구사항 메모는 선택" in client.get(base + "/nodes/M12/hint?level=4").json()["text"]


def test_required_transfer_keeps_code_but_not_optional_writing():
    node = next(node for node in get_published_catalogue("WEB-FS-01")["missions"] if node["id"] == "M12")
    for level in ("BEGINNER", "PRACTICED", "EXPERIENCED"):
        assignment = assignments.new_assignment("M12", level, 0)
        fields = assignments.fields_for_assignment(fields_for(node), assignment, "M12")
        required = {field["id"] for field in assignments.required_fields(fields, assignment, {}, "M12")}
        assert {"source", "api_source", "transfer_source", "transfer_api_source", "architecture_explanation"} <= required
        assert not {"prediction", "observation", "transfer_explanation", "requirement_create", "requirement_restore"} & required
        assert guide_for("M12", level)
    assert guide_for("M05", "BEGINNER")["steps"] != guide_for("M05", "EXPERIENCED")["steps"]


def test_upgrade_preserves_code_level_and_conflict_guards(client):
    base = register(client)
    node = client.get(base + "/nodes/M05").json()
    answers = {"source": "original code to keep", "observation": "saved observation"}
    assert client.put(base + "/nodes/M05/work", json={"expected_version": 0, "answers": answers, "expected_assignment_key": node["assignment"]["key"]}).status_code == 200
    dependency = client.app.dependency_overrides[get_db]()
    db = next(dependency)
    try:
        work = db.scalar(select(LearningMissionWork).where(LearningMissionWork.node_id == "M05"))
        work.assignment = {**work.assignment, "version": "level-v1", "key": "level-v1:BEGINNER:0"}
        db.commit()
    finally:
        dependency.close()
    url = base + "/nodes/M05/practice-format"
    assert client.post(url, json={"expected_version": 2}).status_code == 409
    upgraded = client.post(url, json={"expected_version": 1})
    assert upgraded.status_code == 200
    result = upgraded.json()
    assert result["work"]["answers"] == answers
    assert result["work"]["version"] == 2
    assert result["work"]["status"] != "PASSED"
    assert result["assignment"]["level"] == "BEGINNER"
    assert result["assignment"]["version"] == "practice-v2"
    assert client.put(base + "/nodes/M05/work", json={"expected_version": 1, "answers": answers, "expected_assignment_key": "level-v1:BEGINNER:0"}).status_code == 409
    register(client, "another-practice@example.com")
    assert client.post(url, json={"expected_version": 2}).status_code == 404


@pytest.mark.parametrize("level", ["BEGINNER", "PRACTICED", "EXPERIENCED"])
def test_first_three_missions_complete_without_optional_notes(client, level):
    base = register(client)
    assert client.put(base + "/path", json={"expected_version": 0, "level": level}).status_code == 200
    catalogue = get_published_catalogue("WEB-FS-01")
    for node_id in ("M01", "M02", "M03"):
        details = client.get(base + "/nodes/" + node_id).json()
        node = next(item for item in catalogue["missions"] if item["id"] == node_id)
        answers = {field["id"]: field["choices"][0] for field in details["fields"] if field["kind"] == "choice" and not field.get("practice_note")}
        answers["concept_answer"] = node["concept_check"]["answer"]
        if node_id == "M03":
            answers["source"] = '<form><label for="title">제목</label><input id="title" name="title"><label for="content">내용</label><textarea id="content" name="content"></textarea><button type="submit">저장</button></form>'
        assert client.put(base + f"/nodes/{node_id}/work", json={"expected_version": 0, "expected_assignment_key": details["assignment"]["key"], "answers": answers}).status_code == 200
        assert client.get(base + f"/nodes/{node_id}").status_code == 200
        response = client.post(base + f"/nodes/{node_id}/submit", json={"expected_version": 1})
        assert response.status_code == 200, response.text
        assert response.json()["feedback"]["passed"], response.text
        assert client.post(base + f"/nodes/{node_id}/practice-format", json={"expected_version": 1}).status_code == 409
    assert len(client.get(base + "/workspace").json()["completed_ids"]) == 3
    first = client.get(base + "/nodes/M01").json()
    goal = next(field for field in first["fields"] if field["id"] == "project_goal")
    changed = {**first["work"]["answers"], "project_goal": goal["choices"][1]}
    assert client.put(base + "/nodes/M01/work", json={"expected_version": 1, "answers": changed, "expected_assignment_key": first["assignment"]["key"]}).status_code == 200
    assert client.get(base + "/nodes/M01").status_code == 200
    assert client.post(base + "/nodes/M01/submit", json={"expected_version": 2}).json()["feedback"]["passed"]
    second = client.get(base + "/nodes/M02").json()
    assert second["work"]["status"] == "STALE"
    assert second["prerequisite_rechecks"] == [{"id": "M01", "title": first["title"], "reason": "CHANGED", "can_open": True}]
    third = client.get(base + "/nodes/M03").json()
    assert third["prerequisite_rechecks"][0]["id"] == "M02"
    assert third["prerequisite_rechecks"][0]["reason"] == "INCOMPLETE"
    assert client.post(base + "/nodes/M02/submit", json={"expected_version": 1}).json()["feedback"]["passed"]
    assert len(client.get(base + "/workspace").json()["completed_ids"]) == 3
    assert client.get(base + "/nodes/M02").json()["prerequisite_rechecks"] == []
