from fastapi.testclient import TestClient


def signup(client: TestClient, email: str) -> None:
    response = client.post(
        "/api/v1/auth/signup",
        json={"email": email, "display_name": "Builder", "password": "a-secure-password"},
    )
    assert response.status_code == 201


def test_project_draft_revision_conflict_and_member_isolation(client: TestClient) -> None:
    signup(client, "owner@example.com")
    created = client.post("/api/v1/projects", json={"name": "Greeting app", "description": "My first project"})
    assert created.status_code == 201
    project = created.json()
    project_id = project["id"]
    assert project["draft_version"] == 0
    assert [file["path"] for file in project["files"]] == ["README.md", "main.py"]

    saved = client.put(
        f"/api/v1/projects/{project_id}/draft",
        json={
            "expected_version": 0,
            "files": [
                {"path": "README.md", "content": "# Greeting app\n"},
                {"path": "main.py", "content": 'print("Hello, Minji!")\n'},
            ],
        },
    )
    assert saved.status_code == 200
    assert saved.json()["draft_version"] == 1

    stale_save = client.put(
        f"/api/v1/projects/{project_id}/draft",
        json={"expected_version": 0, "files": [{"path": "main.py", "content": "stale"}]},
    )
    assert stale_save.status_code == 409

    first_revision = client.post(f"/api/v1/projects/{project_id}/revisions").json()
    assert first_revision["created"] is True
    assert first_revision["revision"]["revision_number"] == 1
    assert len(first_revision["revision"]["source_hash"]) == 64
    same_revision = client.post(f"/api/v1/projects/{project_id}/revisions").json()
    assert same_revision["created"] is False
    assert same_revision["revision"]["id"] == first_revision["revision"]["id"]

    changed = client.put(
        f"/api/v1/projects/{project_id}/draft",
        json={"expected_version": 1, "files": [{"path": "main.py", "content": 'print("Updated")\n'}]},
    )
    assert changed.status_code == 200
    second_revision = client.post(f"/api/v1/projects/{project_id}/revisions").json()["revision"]
    assert second_revision["revision_number"] == 2
    assert second_revision["parent_revision_id"] == first_revision["revision"]["id"]

    signup(client, "viewer@example.com")
    assert client.get(f"/api/v1/projects/{project_id}").status_code == 404
    assert client.get("/api/v1/projects").json() == []


def test_project_file_paths_cannot_escape_project(client: TestClient) -> None:
    signup(client, "safe@example.com")
    project_id = client.post("/api/v1/projects", json={"name": "Safe project"}).json()["id"]
    response = client.put(
        f"/api/v1/projects/{project_id}/draft",
        json={"expected_version": 0, "files": [{"path": "../outside.txt", "content": "unsafe"}]},
    )
    assert response.status_code == 422
