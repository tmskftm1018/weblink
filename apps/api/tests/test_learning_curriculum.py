"""Actual HTTP/auth checks for curriculum endpoints; no mocked pass results."""

from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.session import get_db
from app.models.auth import User
from app.models.learning import LearningEnrollment


def signup(client: TestClient, email: str) -> None:
    response = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "display_name": "학습자", "password": "a-secure-password"},
    )
    assert response.status_code == 201


def test_curriculum_endpoints_require_real_authentication(client: TestClient) -> None:
    enrollment_id = uuid4()
    assert client.get("/api/v1/learning/curricula").status_code == 401
    assert client.get("/api/v1/learning/enrollments").status_code == 401
    assert client.post("/api/v1/learning/enrollments", json={"course_key": "WEB-FS-01"}).status_code == 401
    assert client.put(
        f"/api/v1/learning/enrollments/{enrollment_id}/journey",
        json={"current_node_id": "M01"},
    ).status_code == 401


def test_partial_course_exposes_only_ready_mission_details(client: TestClient) -> None:
    signup(client, "draft-course@example.com")
    outline = client.get("/api/v1/learning/curricula/WEB-FS-01").json()
    assert outline["release_state"] == "partial"
    assert [mission["id"] for mission in outline["missions"] if mission["available"]] == [f"M{number:02d}" for number in range(1, 13)]
    enrollment = client.post("/api/v1/learning/enrollments", json={"course_key": "WEB-FS-01"}).json()
    path = f"/api/v1/learning/enrollments/{enrollment['id']}/nodes"
    assert client.get(f"{path}/M01").status_code == 200
    assert client.get(f"{path}/M03").status_code == 200
    assert client.get(f"{path}/M04").status_code == 200
    assert client.get(f"{path}/M07").status_code == 200
    assert client.get(f"{path}/M08").status_code == 200


def test_enrollment_read_and_write_are_scoped_to_session_user(client: TestClient) -> None:
    signup(client, "owner-course@example.com")
    # Seed existing saved work; registering an unpublished course through HTTP stays forbidden.
    dependency = client.app.dependency_overrides[get_db]()
    db = next(dependency)
    try:
        owner = db.scalar(select(User).where(User.email == "owner-course@example.com"))
        enrollment = LearningEnrollment(
            user_id=owner.id, course_key="WEB-FS-01", content_version="0.2.0-draft",
            rubric_version="0.2.0-draft", current_node_id="M01",
        )
        db.add(enrollment)
        db.commit()
        enrollment_id = enrollment.id
    finally:
        dependency.close()

    path = f"/api/v1/learning/enrollments/{enrollment_id}"
    assert client.get(path).status_code == 200
    assert len(client.get("/api/v1/learning/enrollments").json()) == 1
    signup(client, "other-course@example.com")
    assert client.get(path).status_code == 404
    assert client.put(path + "/journey", json={"current_node_id": "M03"}).status_code == 404
    assert client.get("/api/v1/learning/enrollments").json() == []
