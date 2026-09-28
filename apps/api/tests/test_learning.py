from fastapi.testclient import TestClient


def create_student(client: TestClient, email: str = "learner@example.com") -> None:
    response = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "display_name": "Learner", "password": "a-secure-password"},
    )
    assert response.status_code == 201


def test_learning_requires_authentication(client: TestClient) -> None:
    assert client.get("/api/v1/learning/courses").status_code == 401
    assert client.get("/api/v1/learning/courses/software-basics/lessons/input-process-output").status_code == 401


def test_attempts_save_progress_evidence_and_keep_it_private(client: TestClient) -> None:
    create_student(client)
    response = client.get("/api/v1/learning/courses")
    assert response.status_code == 200
    course = response.json()[0]
    assert course["total_lessons"] == 1
    assert course["lessons"][0]["status"] == "NOT_STARTED"

    lesson_response = client.get("/api/v1/learning/courses/software-basics/lessons/input-process-output")
    assert lesson_response.status_code == 200
    lesson = lesson_response.json()
    assert [concept["slug"] for concept in lesson["concepts"]] == ["input", "process", "output"]

    partial = client.post(
        f"/api/v1/learning/lessons/{lesson['id']}/attempts",
        json={"input": "사용자의 이름", "process": "그대로 보여준다", "output": "안녕, 민지!"},
    )
    assert partial.status_code == 200
    assert partial.json()["status"] == "IN_PROGRESS"
    assert partial.json()["attempts_count"] == 1
    assert partial.json()["feedback"]["process"]["correct"] is False

    completed = client.post(
        f"/api/v1/learning/lessons/{lesson['id']}/attempts",
        json={"input": "사용자의 이름", "process": "인사말과 이름을 이어 붙인다", "output": "안녕, 민지!"},
    )
    assert completed.status_code == 200
    assert completed.json()["completed"] is True
    assert completed.json()["status"] == "COMPLETED"

    # A later incorrect attempt must not undo a completed lesson.
    repeated = client.post(
        f"/api/v1/learning/lessons/{lesson['id']}/attempts",
        json={"input": "사용자의 이름", "process": "잘 모르겠어요", "output": "모르겠어요"},
    )
    assert repeated.json()["status"] == "COMPLETED"

    create_student(client, "another@example.com")
    other_course = client.get("/api/v1/learning/courses").json()[0]
    assert other_course["completed_lessons"] == 0
    assert other_course["lessons"][0]["status"] == "NOT_STARTED"
