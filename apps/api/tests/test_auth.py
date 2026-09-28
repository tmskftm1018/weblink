from fastapi.testclient import TestClient


def test_signup_current_user_logout_and_login(client: TestClient) -> None:
    signup = client.post(
        "/api/v1/auth/signup",
        json={"email": "Student@example.com", "display_name": "Student", "password": "a-secure-password"},
    )
    assert signup.status_code == 201
    assert signup.json()["email"] == "student@example.com"
    assert signup.headers.get("set-cookie", "").startswith("weblink_session=")
    assert "httponly" in signup.headers["set-cookie"].lower()

    assert client.get("/api/v1/auth/me").json()["display_name"] == "Student"
    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "student@example.com", "password": "a-secure-password"},
    )
    assert login.status_code == 200
    assert client.get("/api/v1/auth/me").status_code == 200


def test_duplicate_email_and_invalid_login_are_rejected(client: TestClient) -> None:
    payload = {"email": "student@example.com", "display_name": "Student", "password": "a-secure-password"}
    assert client.post("/api/v1/auth/signup", json=payload).status_code == 201
    assert client.post("/api/v1/auth/signup", json=payload).status_code == 409
    assert client.post(
        "/api/v1/auth/login",
        json={"email": "student@example.com", "password": "wrong-password-123"},
    ).status_code == 401
