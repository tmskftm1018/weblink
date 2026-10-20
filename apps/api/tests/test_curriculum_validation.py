"""Dependency-free tests for the draft curriculum catalogue validator."""

from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path

from app.content.curriculum.validation import CatalogueError, validate_catalogue

CATALOGUE = Path(__file__).resolve().parents[1] / "app/content/curriculum/web-fs-01.json"


class CurriculumValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.original = json.loads(CATALOGUE.read_text(encoding="utf-8"))
        # Negative contract cases use a draft copy so publication registry checks
        # do not mask the particular malformed field under examination.
        cls.original["publication_state"] = "draft"
        for mission in cls.original["missions"]:
            mission["publication_state"] = "draft"

    def assert_invalid(self, mutate, message: str) -> None:
        data = copy.deepcopy(self.original)
        mutate(data)
        with self.assertRaisesRegex(CatalogueError, message):
            validate_catalogue(data, base_dir=CATALOGUE.parents[3])

    def test_current_draft_is_valid(self) -> None:
        validate_catalogue(self.original, base_dir=CATALOGUE.parents[3])

    def test_duplicate_mission_id_is_rejected(self) -> None:
        self.assert_invalid(lambda d: d["missions"][1].update(id="M01"), "중복 id")

    def test_missing_hint_is_rejected(self) -> None:
        self.assert_invalid(lambda d: d["missions"][0]["hints"].pop("H3"), "H1~H4")

    def test_unknown_unit_reference_is_rejected(self) -> None:
        self.assert_invalid(lambda d: d["missions"][0].update(unit_id="U-MISSING"), "없는 unit_id")

    def test_path_traversal_is_rejected(self) -> None:
        self.assert_invalid(lambda d: d["missions"][0]["target_files"].append("../../secrets.txt"), "상위/현재 디렉터리")

    def test_published_mission_requires_registered_real_tests(self) -> None:
        self.assert_invalid(lambda d: d["missions"][0].update(publication_state="published", artifact_check_ids=["A1"]), "테스트 레지스트리")

    def test_published_course_cannot_contain_draft_missions(self) -> None:
        self.assert_invalid(lambda d: d.update(publication_state="published"), "게시 상태인 미션만")

    def test_prerequisite_cycle_is_rejected(self) -> None:
        def mutate(data):
            data["missions"][0]["prerequisites"] = ["M02"]
            data["missions"][1]["prerequisites"] = ["M01"]
        self.assert_invalid(mutate, "순환")

    def test_optional_bridge_cannot_be_a_required_mission(self) -> None:
        self.assert_invalid(lambda d: d["missions"][2]["prerequisites"].append("B-HTML"), "없는 단계 참조")

    def test_every_checkpoint_has_a_real_transfer_description(self) -> None:
        self.assert_invalid(lambda d: d["missions"][4].update(transfer_check_ids=[]), "전이 과제가 필요")
        self.assert_invalid(lambda d: d["transfer_checks"][0].update(task=""), "필수 문자열")

    def test_missing_foundation_is_rejected(self) -> None:
        self.assert_invalid(lambda d: d["core_lessons"].pop(), "C00~C05")

    def test_malformed_data_has_a_domain_error(self) -> None:
        for data in ([], {**self.original, "publication_state": []}, {**self.original, "missions": [None]}):
            with self.subTest(data_type=type(data).__name__), self.assertRaises(CatalogueError):
                validate_catalogue(data, base_dir=CATALOGUE.parents[3])


if __name__ == "__main__":
    unittest.main()
