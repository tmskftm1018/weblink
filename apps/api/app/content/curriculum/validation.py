"""One dependency-free content contract shared by runtime loading and the CLI.

Structural validity is not proof that a course or its registered checks work.
"""

from __future__ import annotations

from pathlib import Path, PurePosixPath
from typing import Any

MISSION_IDS = [f"M{i:02d}" for i in range(1, 13)]
CORE_IDS = [f"C{i:02d}" for i in range(6)]
BRIDGE_IDS = {"B-HTML", "B-JS", "B-ARRAY", "B-REACT", "B-HTTP", "B-PY", "B-SQL", "B-DEBUG"}
TRANSFER_MISSIONS = {"M05", "M07", "M10", "M12"}
PUBLICATION_STATES = {"draft", "partial", "published", "archived"}


class CatalogueError(ValueError):
    pass


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise CatalogueError(message)


def _text(value: Any, where: str) -> None:
    _require(isinstance(value, str) and bool(value.strip()), f"{where}: 필수 문자열입니다")


def _objects(value: Any, where: str) -> list[dict]:
    _require(isinstance(value, list), f"{where}: 목록이어야 합니다")
    _require(all(isinstance(item, dict) for item in value), f"{where}: 항목은 객체여야 합니다")
    return value


def _strings(value: Any, where: str) -> list[str]:
    _require(isinstance(value, list), f"{where}: 문자열 목록이어야 합니다")
    _require(all(isinstance(item, str) and item.strip() for item in value), f"{where}: 빈 값 또는 잘못된 참조입니다")
    _require(len(value) == len(set(value)), f"{where}: 중복 id가 있습니다")
    return value


def _ids(items: list[dict], where: str) -> list[str]:
    return _strings([item.get("id") for item in items], where)


def _relative_path(value: Any, where: str) -> None:
    _text(value, where)
    _require(
        "\\" not in value and ":" not in value and not value.startswith("/"),
        f"{where}: 안전한 상대 POSIX 경로여야 합니다",
    )
    _require(
        all(part not in {"", ".", ".."} for part in value.split("/")),
        f"{where}: 상위/현재 디렉터리 또는 빈 경로는 허용되지 않습니다",
    )
    _require(str(PurePosixPath(value)) == value, f"{where}: 정규화된 경로가 필요합니다")


def _references(values: Any, allowed: set[str], where: str) -> list[str]:
    refs = _strings(values, where)
    _require(all(ref in allowed for ref in refs), f"{where}: 없는 단계 참조가 있습니다")
    return refs


def _check_definition(check: Any, where: str) -> str:
    _require(isinstance(check, dict), f"{where}: 객체가 필요합니다")
    _text(check.get("id"), f"{where}.id")
    _text(check.get("prompt"), f"{where}.prompt")
    choices = _strings(check.get("choices"), f"{where}.choices")
    _require(len(choices) >= 2 and check.get("answer") in choices, f"{where}: 정답/선택지 구성이 잘못되었습니다")
    return check["id"]


def validate_catalogue(
    data: Any, *, base_dir: Path, test_registry: dict[str, str] | None = None,
) -> None:
    _require(isinstance(data, dict), "커리큘럼 최상위 값은 객체여야 합니다")
    for field in ("course_id", "title", "description", "content_version", "rubric_version"):
        _text(data.get(field), field)
    _require(isinstance(data.get("publication_state"), str) and data["publication_state"] in PUBLICATION_STATES, "알 수 없는 과정 공개 상태입니다")
    sections = {key: _objects(data.get(key), key) for key in ("units", "core_lessons", "bridges", "missions", "transfer_checks")}
    units, core, bridges, missions, transfers = (sections[key] for key in sections)
    ids = {key: _ids(items, key) for key, items in sections.items()}
    _require(ids["missions"] == MISSION_IDS, "미션은 M01~M12 순서로 정확히 있어야 합니다")
    _require(ids["core_lessons"] == CORE_IDS, "기초 수업은 C00~C05 순서로 있어야 합니다")
    _require(set(ids["bridges"]) == BRIDGE_IDS, "필수 브리지 ID가 누락되거나 잘못되었습니다")
    all_ids = [value for values in ids.values() for value in values]
    _require(len(all_ids) == len(set(all_ids)), "영역 간 중복 id가 있습니다")
    _require(bool(units), "최소 한 개의 단원이 필요합니다")
    if data["publication_state"] == "published":
        _require(all(m.get("publication_state") == "published" for m in missions), "게시 과정에는 게시 상태인 미션만 포함할 수 있습니다")
    if data["publication_state"] == "partial":
        available = {m["id"] for m in missions if m.get("publication_state") == "published"}
        _require(bool(available), "부분 공개에는 게시 상태인 미션이 필요합니다")
        _require(all(set(m.get("prerequisites", [])).issubset(available) for m in missions if m["id"] in available), "공개 미션의 선수 미션도 공개되어야 합니다")

    node_ids = set(ids["units"] + ids["core_lessons"] + ids["bridges"] + ids["missions"])
    unit_assignment: dict[str, str] = {}
    for unit in units:
        _text(unit.get("title"), f"{unit['id']}.title")
        for mid in _references(unit.get("mission_ids"), set(MISSION_IDS), f"{unit['id']}.mission_ids"):
            _require(mid not in unit_assignment, f"{mid}: 둘 이상의 단원에 배치되었습니다")
            unit_assignment[mid] = unit["id"]

    question_ids = []
    for lesson in [*core, *missions]:
        lid = lesson["id"]
        for field in ("title", "objective", "prediction", "recovery"):
            _text(lesson.get(field), f"{lid}.{field}")
        practice = lesson.get("micro_practice")
        _require(isinstance(practice, dict), f"{lid}: micro_practice 객체가 필요합니다")
        for field in ("task", "expected_observation"):
            _text(practice.get(field), f"{lid}.micro_practice.{field}")
        response = lesson.get("learner_response")
        _require(isinstance(response, dict), f"{lid}: learner_response 객체가 필요합니다")
        for field in ("kind", "prompt"):
            _text(response.get(field), f"{lid}.learner_response.{field}")
        hints = lesson.get("hints")
        _require(isinstance(hints, dict) and set(hints) == {"H1", "H2", "H3", "H4"}, f"{lid}: H1~H4 힌트가 필요합니다")
        for level, hint in hints.items():
            _text(hint, f"{lid}.{level}")
        question_ids.append(_check_definition(lesson.get("concept_check"), f"{lid}.concept_check"))
        _references(lesson.get("next"), node_ids, f"{lid}.next")
    _strings(question_ids, "concept_check ids")

    for bridge in bridges:
        bid = bridge["id"]
        for field in ("title", "objective", "expected_observation"):
            _text(bridge.get(field), f"{bid}.{field}")
        _require(bridge.get("return_to") in MISSION_IDS, f"{bid}: 추천 미션 참조가 잘못되었습니다")
        _references(bridge.get("prerequisites"), set(CORE_IDS), f"{bid}.prerequisites")

    transfer_by_id = {item["id"]: item for item in transfers}
    _require(all(item.get("mission_id") in MISSION_IDS for item in transfers), "전이 과제의 미션 참조가 잘못되었습니다")
    _require({item["mission_id"] for item in transfers} == TRANSFER_MISSIONS, "M05/M07/M10/M12 전이 과제가 필요합니다")
    for transfer in transfers:
        _text(transfer.get("task"), f"{transfer['id']}.task")
        _require(bool(_strings(transfer.get("success_criteria"), f"{transfer['id']}.success_criteria")), "전이 과제에 성공 기준이 필요합니다")

    graph: dict[str, list[str]] = {}
    if test_registry is not None:
        _require(isinstance(test_registry, dict), "테스트 레지스트리는 객체여야 합니다")
    for mission in missions:
        mid = mission["id"]
        _require(mission.get("unit_id") in ids["units"], f"{mid}: 없는 unit_id")
        _require(unit_assignment.get(mid) == mission["unit_id"], f"{mid}: 단원 배치가 일치하지 않습니다")
        _require(isinstance(mission.get("publication_state"), str) and mission["publication_state"] in PUBLICATION_STATES, f"{mid}: 알 수 없는 공개 상태입니다")
        graph[mid] = _references(mission.get("prerequisites"), set(MISSION_IDS), f"{mid}.prerequisites")
        _references(mission.get("foundation_ids"), set(CORE_IDS), f"{mid}.foundation_ids")
        _references(mission.get("recommended_bridge_ids"), BRIDGE_IDS, f"{mid}.recommended_bridge_ids")
        for path in _strings(mission.get("target_files"), f"{mid}.target_files"):
            _relative_path(path, f"{mid}.target_files")
        if mission.get("starter_workspace") is not None:
            _relative_path(mission["starter_workspace"], f"{mid}.starter_workspace")
        test_ids = _strings(mission.get("test_ids"), f"{mid}.test_ids")
        artifact_ids = _strings(mission.get("artifact_check_ids"), f"{mid}.artifact_check_ids")
        transfer_ids = _references(mission.get("transfer_check_ids"), set(transfer_by_id), f"{mid}.transfer_check_ids")
        _require(all(transfer_by_id[tid]["mission_id"] == mid for tid in transfer_ids), f"{mid}: 다른 미션의 전이 과제입니다")
        if mid in TRANSFER_MISSIONS:
            _require(bool(transfer_ids), f"{mid}: 전이 과제가 필요합니다")
        if mission["publication_state"] == "published":
            required = artifact_ids if mid in {"M01", "M02"} else test_ids
            _require(bool(required), f"{mid}: 게시 전 실제 산출물/기능 검사가 필요합니다")
            _require(test_registry is not None, f"{mid}: 테스트 레지스트리가 없습니다")
            for check_id in [*test_ids, *artifact_ids]:
                _require(check_id in test_registry, f"{mid}: 미등록 테스트 {check_id}")
                path = test_registry[check_id]
                _relative_path(path, f"test_registry.{check_id}")
                resolved = (base_dir / path).resolve()
                _require(resolved.is_relative_to(base_dir.resolve()) and resolved.is_file(), f"{mid}: 검사 파일이 없거나 허용 경로 밖입니다")

    visiting, visited = set(), set()

    def visit(node: str) -> None:
        _require(node not in visiting, f"선수 관계에 순환이 있습니다: {node}")
        if node in visited:
            return
        visiting.add(node)
        for parent in graph[node]:
            visit(parent)
        visiting.remove(node)
        visited.add(node)

    for node in graph:
        visit(node)
