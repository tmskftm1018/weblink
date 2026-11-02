"""Subject settings persist per enrollment without bypassing learning evidence."""

import pytest


def register(client, email="subjects@example.com"):
    response = client.post("/api/v1/auth/signup", json={
        "email": email, "display_name": "과목 선택 확인", "password": "a-secure-password",
    })
    assert response.status_code == 201
    enrollment = client.post("/api/v1/learning/enrollments", json={"course_key": "WEB-FS-01"})
    assert enrollment.status_code == 201
    return f"/api/v1/learning/enrollments/{enrollment.json()['id']}"


def test_default_and_multiple_subjects_survive_relogin(client):
    base = register(client)
    initial = client.get(base + "/path").json()
    assert initial["subject_ids"] == ["WEB_UI", "SERVER_API", "DATABASE"]
    response = client.put(base + "/path", json={
        "expected_version": 0, "level": "PRACTICED", "subject_ids": ["DATABASE", "SERVER_API"],
    })
    assert response.status_code == 200
    assert response.json()["subject_ids"] == ["SERVER_API", "DATABASE"]
    assert response.json()["level"] == "PRACTICED"
    assert client.post("/api/v1/auth/logout").status_code in {200, 204}
    assert client.post("/api/v1/auth/login", json={"email": "subjects@example.com", "password": "a-secure-password"}).status_code == 200
    reopened = client.get(base + "/path").json()
    assert reopened["subject_ids"] == ["SERVER_API", "DATABASE"]
    assert reopened["version"] == 1


def test_old_level_only_requests_keep_subjects_and_stale_writes_fail(client):
    base = register(client)
    assert client.put(base + "/path", json={"expected_version": 0, "subject_ids": ["DATABASE"]}).status_code == 200
    changed = client.put(base + "/path", json={"expected_version": 1, "level": "EXPERIENCED"})
    assert changed.status_code == 200
    assert changed.json()["subject_ids"] == ["DATABASE"]
    assert client.put(base + "/path", json={"expected_version": 1, "level": "BEGINNER", "subject_ids": ["WEB_UI"]}).status_code == 409
    current = client.get(base + "/path").json()
    assert current["subject_ids"] == ["DATABASE"]
    assert current["level"] == "EXPERIENCED"


@pytest.mark.parametrize("subjects", [[], ["UNKNOWN"], ["WEB_UI", "WEB_UI"], ["WEB_UI"] * 4])
def test_invalid_subjects_do_not_change_settings(client, subjects):
    base = register(client)
    assert client.put(base + "/path", json={"expected_version": 0, "subject_ids": subjects}).status_code == 422
    assert client.get(base + "/path").json()["version"] == 0


def test_subject_change_preserves_work_and_unlock_rules(client):
    base = register(client)
    before = client.get(base + "/workspace").json()
    node = client.get(base + "/nodes/M03").json()
    saved = client.put(base + "/nodes/M03/work", json={
        "expected_version": 0, "answers": {"source": "<form>작성한 코드</form>"},
        "expected_assignment_key": node["assignment"]["key"],
    })
    assert saved.status_code == 200
    assert client.put(base + "/path", json={"expected_version": 0, "level": "BEGINNER", "subject_ids": ["DATABASE"]}).status_code == 200
    reopened = client.get(base + "/nodes/M03").json()
    assert reopened["assignment"]["key"] == node["assignment"]["key"]
    assert reopened["work"]["answers"] == saved.json()["answers"]
    after = client.get(base + "/workspace").json()
    assert [(item["id"], item["unlocked"]) for item in after["missions"]] == [(item["id"], item["unlocked"]) for item in before["missions"]]


def test_subjects_are_private_and_catalogue_points_to_existing_lessons(client):
    base = register(client)
    profile = client.get(base + "/path").json()
    workspace = client.get(base + "/workspace").json()
    missions = {item["id"] for item in workspace["missions"]}
    foundations = {item["id"] for item in workspace["foundations"]}
    for subject in profile["subjects"]:
        assert set(subject["mission_ids"]) <= missions
        assert set(subject["foundation_ids"]) <= foundations
    assert set(profile["common_mission_ids"]) <= missions
    other = register(client, "other-subjects@example.com")
    assert client.get(base + "/path").status_code == 404
    assert client.put(base + "/path", json={"expected_version": 0, "subject_ids": ["WEB_UI"]}).status_code == 404
    assert client.get(other + "/path").json()["version"] == 0
