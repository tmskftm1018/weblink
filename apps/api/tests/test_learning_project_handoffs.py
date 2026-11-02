"""Project-link fixtures only: no invented execution receipts or passed grades."""

from uuid import UUID

from sqlalchemy import select

from app.db.session import get_db
from app.models.learning import LearningMissionWork, LearningProjectExport


def register(client, email="handoff-state@example.com"):
    assert client.post("/api/v1/auth/signup", json={"email": email, "display_name": "연결 확인", "password": "a-secure-password"}).status_code == 201
    enrollment = client.post("/api/v1/learning/enrollments", json={"course_key": "WEB-FS-01"}).json()
    return f"/api/v1/learning/enrollments/{enrollment['id']}"


def saved_mission(client, base):
    node = client.get(base + "/nodes/M10").json()
    response = client.put(base + "/nodes/M10/work", json={"expected_version": 0, "expected_assignment_key": node["assignment"]["key"], "answers": {"source": "saved unsubmitted React code"}})
    assert response.status_code == 200
    return node["assignment"]["key"]


def link_fixture(client, base, project_id):
    dependency = client.app.dependency_overrides[get_db]()
    db = next(dependency)
    try:
        enrollment_id = UUID(base.rsplit("/", 1)[1])
        work = db.scalar(select(LearningMissionWork).where(LearningMissionWork.enrollment_id == enrollment_id, LearningMissionWork.node_id == "M10"))
        db.add(LearningProjectExport(enrollment_id=enrollment_id, node_id="M10", field="source", artifact_hash=work.source_hash,
                                     work_version=work.version, project_id=UUID(project_id), revision_hash="0" * 64))
        db.commit()
    finally:
        dependency.close()


def test_unsubmitted_mission_explains_creation_requirements(client):
    base = register(client)
    node = client.get(base + "/nodes/M10").json()
    assert {item["field"] for item in node["project_handoffs"]} == {"source", "transfer_source"}
    assert all(not item["can_open"] and not item["can_create"] and item["reason"] for item in node["project_handoffs"])
    assert client.get(base + "/nodes/M03").json()["project_handoffs"] == []


def test_existing_project_opens_after_draft_change_without_duplicate_or_grade(client):
    base = register(client)
    key = saved_mission(client, base)
    project = client.post("/api/v1/projects", json={"name": "기존 게시판"}).json()
    link_fixture(client, base, project["id"])
    first = client.get(base + "/nodes/M10").json()["project_handoffs"][0]
    assert first["can_open"] and not first["can_create"] and not first["source_changed"]
    assert client.put(base + "/nodes/M10/work", json={"expected_version": 1, "expected_assignment_key": key, "answers": {"source": "changed and still unsubmitted React code"}}).status_code == 200
    details = client.get(base + "/nodes/M10").json()
    assert details["work"]["feedback"] is None
    assert details["project_handoffs"][0]["source_changed"]
    response = client.post(base + "/nodes/M10/project", json={"expected_version": 2, "field": "source"})
    assert response.status_code == 200, response.text
    assert response.json()["project_id"] == project["id"] and not response.json()["created"]
    assert len(client.get("/api/v1/projects").json()) == 1


def test_unowned_export_link_does_not_expose_project_or_allow_recreation(client):
    base = register(client)
    saved_mission(client, base)
    register(client, "other-handoff@example.com")
    other = client.post("/api/v1/projects", json={"name": "다른 계정의 비공개 프로젝트"}).json()
    assert client.post("/api/v1/auth/login", json={"email": "handoff-state@example.com", "password": "a-secure-password"}).status_code == 200
    link_fixture(client, base, other["id"])
    state = client.get(base + "/nodes/M10").json()["project_handoffs"][0]
    assert not state["can_open"] and not state["can_create"]
    assert state["project_id"] is None and state["project_name"] is None
    assert "열 수 없어요" in state["reason"]
