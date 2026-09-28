from fastapi.testclient import TestClient


def test_runs_execute_immutable_revisions_and_are_idempotent(client: TestClient) -> None:
    signup = client.post(
        "/api/v1/auth/signup",
        json={"email": "runner@example.com", "display_name": "Runner", "password": "a-secure-password"},
    )
    assert signup.status_code == 201
    project = client.post("/api/v1/projects", json={"name": "Run me"}).json()
    project_id = project["id"]
    assert client.post(f"/api/v1/projects/{project_id}/runs", json={"revision_id": "00000000-0000-4000-8000-000000000000"}, headers={"Idempotency-Key": "run-key-0001"}).status_code == 404

    revision = client.post(f"/api/v1/projects/{project_id}/revisions").json()["revision"]
    request = {"revision_id": revision["id"]}
    headers = {"Idempotency-Key": "run-key-0001"}
    accepted = client.post(f"/api/v1/projects/{project_id}/runs", json=request, headers=headers)
    assert accepted.status_code == 202
    assert accepted.json()["status"] == "QUEUED"

    duplicate = client.post(f"/api/v1/projects/{project_id}/runs", json=request, headers=headers)
    assert duplicate.status_code == 200
    assert duplicate.json()["id"] == accepted.json()["id"]

    saved = client.put(
        f"/api/v1/projects/{project_id}/draft",
        json={"expected_version": 0, "files": [{"path": "main.py", "content": 'print("new version")'}]},
    )
    assert saved.status_code == 200
    next_revision = client.post(f"/api/v1/projects/{project_id}/revisions").json()["revision"]
    conflict = client.post(
        f"/api/v1/projects/{project_id}/runs",
        json={"revision_id": next_revision["id"]},
        headers=headers,
    )
    assert conflict.status_code == 409
    assert client.get(f"/api/v1/projects/{project_id}/runs").json()["runs"][0]["id"] == accepted.json()["id"]

    another = client.post(
        "/api/v1/auth/signup",
        json={"email": "other-runner@example.com", "display_name": "Other", "password": "a-secure-password"},
    )
    assert another.status_code == 201
    assert client.get(f"/api/v1/projects/{project_id}/runs").status_code == 404
    assert client.get(f"/api/v1/projects/{project_id}/runs/{accepted.json()['id']}").status_code == 404
    assert client.post(
        f"/api/v1/projects/{project_id}/runs/{accepted.json()['id']}/debug-session",
        json={"hypothesis": " 아직 실행 중일 수 있어요", "expected_output": "Hello"},
    ).status_code == 404


def test_debug_session_requires_finished_run(client: TestClient) -> None:
    client.post(
        "/api/v1/auth/signup",
        json={"email": "debugger@example.com", "display_name": "Debugger", "password": "a-secure-password"},
    )
    project = client.post("/api/v1/projects", json={"name": "Debug me"}).json()
    revision = client.post(f"/api/v1/projects/{project['id']}/revisions").json()["revision"]
    run = client.post(
        f"/api/v1/projects/{project['id']}/runs",
        json={"revision_id": revision["id"]},
        headers={"Idempotency-Key": "debug-key-0001"},
    ).json()
    response = client.post(
        f"/api/v1/projects/{project['id']}/runs/{run['id']}/debug-session",
        json={"hypothesis": "문자열의 따옴표가 빠진 것 같아요.", "expected_output": "Hello"},
    )
    assert response.status_code == 409


def test_run_idempotency_header_is_allowed_by_cors(client: TestClient) -> None:
    response = client.options(
        "/api/v1/projects/00000000-0000-4000-8000-000000000000/runs",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,idempotency-key",
        },
    )
    assert response.status_code == 200
    assert "idempotency-key" in response.headers["access-control-allow-headers"].lower()
