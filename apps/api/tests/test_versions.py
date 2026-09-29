from fastapi.testclient import TestClient


def test_version_restore_creates_a_new_revision_and_restores_draft(client: TestClient) -> None:
    signup = client.post(
        "/api/v1/auth/signup",
        json={"email": "versions@example.com", "display_name": "Versions", "password": "a-secure-password"},
    )
    assert signup.status_code == 201
    project = client.post("/api/v1/projects", json={"name": "Version history"}).json()
    project_id = project["id"]
    first_revision = client.post(f"/api/v1/projects/{project_id}/revisions").json()["revision"]
    saved = client.post(
        f"/api/v1/projects/{project_id}/versions",
        json={"revision_id": first_revision["id"], "name": "Known good", "description": "initial version"},
    )
    assert saved.status_code == 201
    version = saved.json()
    assert version["version_number"] == 1
    repeated_save = client.post(
        f"/api/v1/projects/{project_id}/versions",
        json={"revision_id": first_revision["id"], "name": "Another copy"},
    )
    assert repeated_save.status_code == 201
    assert repeated_save.json()["id"] == version["id"]
    assert len(client.get(f"/api/v1/projects/{project_id}/versions").json()) == 1

    changed_files = [dict(file, content=file["content"] + "# changed\n") for file in project["files"]]
    updated = client.put(
        f"/api/v1/projects/{project_id}/draft",
        json={"expected_version": 0, "files": changed_files},
    )
    assert updated.status_code == 200
    second_revision = client.post(f"/api/v1/projects/{project_id}/revisions").json()["revision"]
    assert second_revision["id"] != first_revision["id"]

    details = client.get(f"/api/v1/projects/{project_id}/versions/{version['id']}")
    assert details.status_code == 200
    assert details.json()["files"] == project["files"]

    restored = client.post(f"/api/v1/projects/{project_id}/versions/{version['id']}/restore")
    assert restored.status_code == 200
    assert restored.json()["restored_revision_number"] == 3
    workspace = client.get(f"/api/v1/projects/{project_id}").json()
    assert workspace["files"] == project["files"]
    assert [revision["revision_number"] for revision in workspace["revisions"]] == [3, 2, 1]
    versions = client.get(f"/api/v1/projects/{project_id}/versions")
    assert versions.status_code == 200
    assert len(versions.json()) == 1

    deleted = client.delete(f"/api/v1/projects/{project_id}/versions/{version['id']}")
    assert deleted.status_code == 204
    assert client.get(f"/api/v1/projects/{project_id}/versions").json() == []
