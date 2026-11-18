import json

import pytest
from fastapi.testclient import TestClient

from app.content.curriculum import assignments, guided_starters
from app.content.curriculum.course_runtime_contract import CONTRACTS
from app.services.learning_curriculum import get_published_catalogue


def app_from(source, db_file):
    namespace = {"__name__": __name__}
    source = source.replace('"/data/learning.db"', json.dumps(str(db_file)))
    # Trusted application-authored template only; never learner input.
    exec(compile(source, "<guided-template>", "exec"), namespace)  # noqa: S102 - trusted authored scaffold
    return namespace["app"]


def hint_code(node_id, hint):
    node = next(item for item in get_published_catalogue("WEB-FS-01")["missions"] if item["id"] == node_id)
    return assignments.presentation(node, assignments.new_assignment(node_id, "BEGINNER", 0))["hints"][hint]


def test_beginner_revision_preserves_old_starters_and_predecessor_code():
    contract = CONTRACTS["M12"]
    old = assignments.starters("M12", "BEGINNER", contract["starter"], contract["transfer_starter"], contract["starter_files"])
    new = assignments.starters("M12", "BEGINNER", contract["starter"], contract["transfer_starter"], contract["starter_files"], starter_revision=guided_starters.REVISION)
    assert old[0] == contract["starter"]
    assert old[2] == contract["starter_files"]
    assert new[0] != old[0]
    assert "loadRows" in new[0]
    assert "def list_rows" in new[2]["api_source"]
    beginner = assignments.new_assignment("M12", "BEGINNER", 0)
    assert beginner["starter_revision"] == guided_starters.REVISION
    assert beginner["key"] != "practice-v2:BEGINNER:0"
    assert "starter_revision" not in assignments.new_assignment("M12", "PRACTICED", 0)
    board = CONTRACTS["M10"]
    learner_files = {**board["starter_files"], "api_source": "# learner API kept exactly"}
    updated = assignments.starters("M10", "BEGINNER", board["starter"], board["transfer_starter"], learner_files, starter_revision=guided_starters.REVISION)
    assert updated[2]["api_source"] == learner_files["api_source"]
    assert learner_files["transfer_api_source"] == board["starter_files"]["transfer_api_source"]


def test_new_scaffold_key_and_saved_scope_survive_path_changes(client):
    assert client.post("/api/v1/auth/signup", json={"email": "scaffold-test@example.com", "display_name": "테스트", "password": "a-secure-password"}).status_code == 201
    registration = client.post("/api/v1/learning/enrollments", json={"course_key": "WEB-FS-01"}).json()
    base = f"/api/v1/learning/enrollments/{registration['id']}"
    initial = client.get(base + "/nodes/M12").json()
    key = initial["assignment"]["key"]
    assert initial["assignment"]["starter_revision"] == guided_starters.REVISION
    answers = {"source": "# learner screen", "api_source": "# learner API"}
    assert client.put(base + "/nodes/M12/work", json={"expected_version": 0, "expected_assignment_key": "practice-v2:BEGINNER:0", "answers": answers}).status_code == 409
    assert client.put(base + "/nodes/M12/work", json={"expected_version": 0, "expected_assignment_key": key, "answers": answers}).status_code == 200
    assert client.put(base + "/path", json={"expected_version": 0, "level": "EXPERIENCED"}).status_code == 200
    saved = client.get(base + "/nodes/M12").json()
    assert saved["work"]["answers"] == answers
    assert saved["assignment"]["key"] == key
    assert saved["assignment"]["level"] == "BEGINNER"
    assert saved["starter_code"] == initial["starter_code"]
    assert saved["work"]["status"] != "PASSED"


@pytest.mark.parametrize("table,column,maximum,content", [("notes", "text", 200, False), ("tasks", "label", 120, False), ("posts", "title", 80, True), ("items", "name", 40, True)])
def test_scaffold_rejects_invalid_input_and_requires_actual_insert(tmp_path, table, column, maximum, content):
    source = guided_starters.api(table, column, maximum, content=content)
    path = f"/api/{table}"
    db_file = tmp_path / "learning.db"
    with TestClient(app_from(source, db_file)) as client:
        assert client.get(path).json() == []
        assert client.post(path, json={column: " "}).status_code == 422
        assert client.post(path, json={column: "x" * (maximum + 1)}).status_code == 422
        assert client.post(path, json={column: "new"}).status_code == 501
        assert client.get(path).json() == []
    # Complete only the marked DB write using the same small hint shown to learners.
    lines = hint_code("M10" if content else "M12", "H3").splitlines()[1:4]
    origin_table, origin_column = ("posts", "title") if content else ("notes", "text")
    completed = "\n".join("        " + line.replace(origin_table, table).replace(origin_column, column) for line in lines)
    source = source.replace('        raise HTTPException(status_code=501, detail="아직 DB 저장을 연결하지 않았어요.")', completed)
    with TestClient(app_from(source, db_file)) as client:
        payload = {column: "  '; DROP TABLE posts; --  "}
        if content:
            payload["content"] = "본문"
        result = client.post(path, json=payload)
        assert result.status_code == 201
        assert result.json()[column] == payload[column].strip()
        assert result.json()["id"] == 1
        expected = [result.json()]
        assert client.get(path).json() == expected
    with TestClient(app_from(source, db_file)) as restarted:
        assert restarted.get(path).json() == expected
