"""Content-loader and SQLite integration tests; no student code is executed.

Temporary registry files test path validation only, not lesson correctness/readiness.
"""

from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session

from app.db.base import Base
from app.models.auth import User
from app.models.learning import LearningAssessmentEvidence, LearningEnrollment
from app.models.projects import Project, ProjectMember, ProjectRevision
from app.schemas.learning import LearningEnrollmentCreateRequest, LearningJourneyUpdateRequest
from app.services import learning_curriculum as service


class LearningCurriculumTests(unittest.TestCase):
    def setUp(self) -> None:
        source = service.APP_ROOT / "content/curriculum/web-fs-01.json"
        self.catalogue = json.loads(source.read_text(encoding="utf-8"))
        self.catalogue.update(publication_state="published", content_version="1.0", rubric_version="1.0")
        registry = {}
        for mission in self.catalogue["missions"]:
            mission["publication_state"] = "published"
            field = "artifact_check_ids" if mission["id"] in {"M01", "M02"} else "test_ids"
            mission[field] = [f"{mission['id']}-fixture-check"]
            registry[mission[field][0]] = "checks.py"
        self.temp = tempfile.TemporaryDirectory(prefix=".weblink-test-", dir=service.API_ROOT)
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.catalogue_path = root / "web-fs-01.json"
        self.registry_path = root / "test-registry.json"
        self.write_catalogue()
        self.registry_path.write_text(json.dumps(registry), encoding="utf-8")
        (root / "checks.py").write_text("# Registry path fixture, not an executed lesson check.\n", encoding="utf-8")
        self.paths = patch.multiple(service, CURRICULUM_ROOT=root, API_ROOT=root)
        self.paths.start()

        self.engine = create_engine("sqlite+pysqlite:///:memory:")

        @event.listens_for(self.engine, "connect")
        def enable_foreign_keys(connection, _record) -> None:
            connection.execute("PRAGMA foreign_keys=ON")

        Base.metadata.create_all(self.engine)
        self.db = Session(self.engine, expire_on_commit=False)
        self.user = User(email="learner@example.com", display_name="학습자")
        self.db.add(self.user)
        self.db.flush()
        self.project = Project(owner_id=self.user.id, name="학습 공간", description="")
        self.db.add(self.project)
        self.db.flush()
        self.db.add(ProjectMember(project_id=self.project.id, user_id=self.user.id, role="OWNER"))
        self.origin = self.add_revision(self.project.id, 1, "project/index.html", "original")
        self.db.commit()

    def tearDown(self) -> None:
        self.db.close()
        self.engine.dispose()
        self.paths.stop()
        self.temp.cleanup()

    def write_catalogue(self) -> None:
        self.catalogue_path.write_text(json.dumps(self.catalogue), encoding="utf-8")

    def add_revision(self, project_id, number, path, content) -> ProjectRevision:
        revision = ProjectRevision(
            project_id=project_id, revision_number=number,
            source_hash=hashlib.sha256(content.encode()).hexdigest(),
            snapshot=[{"path": path, "content": content}], created_by=self.user.id,
        )
        self.db.add(revision)
        self.db.flush()
        return revision

    def enroll(self):
        return service.create_enrollment(self.db, self.user, "WEB-FS-01", self.project.id)

    def move(self, enrollment_id, node, bridge=None, revision=None, **position):
        return service.update_journey(
            self.db, self.user, enrollment_id, current_node_id=node,
            active_bridge_id=bridge,
            revision_id=revision, **position,
        )

    def test_real_loader_uses_same_contract_and_api_root_as_cli(self) -> None:
        loaded = service.get_published_catalogue("WEB-FS-01")
        self.assertEqual(loaded["course_id"], "WEB-FS-01")
        self.catalogue["units"][0]["mission_ids"].append("M99")
        self.write_catalogue()
        with self.assertLogs(service.logger, level="WARNING"):
            self.assertIsNone(service.get_published_catalogue("WEB-FS-01"))

    def test_draft_and_missing_registry_cannot_enroll(self) -> None:
        self.catalogue["publication_state"] = "draft"
        self.write_catalogue()
        self.assertEqual(service.list_published_outlines(), [])
        with self.assertRaises(service.CourseUnavailable):
            self.enroll()
        self.catalogue["publication_state"] = "published"
        self.write_catalogue()
        self.registry_path.unlink()
        with self.assertLogs(service.logger, level="WARNING"):
            self.assertIsNone(service.get_published_catalogue("WEB-FS-01"))

    def test_outline_does_not_expose_answers_or_hint_tiers(self) -> None:
        outline = service.get_published_outline("WEB-FS-01")
        self.assertEqual(len(outline["missions"]), 12)
        encoded = json.dumps(outline)
        for private_key in ("answer", "hints", "concept_check", "H4"):
            self.assertNotIn(private_key, encoded)

    def test_registration_is_idempotent_and_cannot_switch_projects(self) -> None:
        first = self.enroll()
        second = self.enroll()
        self.assertEqual(first.id, second.id)
        other = Project(owner_id=self.user.id, name="다른 공간", description="")
        self.db.add(other)
        self.db.flush()
        self.db.add(ProjectMember(project_id=other.id, user_id=self.user.id, role="OWNER"))
        self.db.commit()
        with self.assertRaises(service.EnrollmentProjectConflict):
            service.create_enrollment(self.db, self.user, "WEB-FS-01", other.id)

    def test_editor_cannot_claim_another_persons_project_as_personal_workspace(self) -> None:
        editor = User(email="editor@example.com", display_name="편집자")
        self.db.add(editor)
        self.db.flush()
        self.db.add(ProjectMember(project_id=self.project.id, user_id=editor.id, role="EDITOR"))
        self.db.commit()
        with self.assertRaises(service.ProjectNotEditable):
            service.create_enrollment(self.db, editor, "WEB-FS-01", self.project.id)

    def test_other_user_cannot_read_or_update_enrollment(self) -> None:
        enrollment = self.enroll()
        other = User(email="other@example.com", display_name="다른 사용자")
        self.db.add(other)
        self.db.commit()
        self.assertIsNone(service.get_enrollment(self.db, other, enrollment.id))
        self.assertEqual(service.list_enrollments(self.db, other), [])
        with self.assertRaises(service.EnrollmentNotFound):
            service.update_journey(
                self.db, other, enrollment.id, current_node_id="M03",
                active_bridge_id=None, revision_id=None,
            )

    def test_bridge_origin_survives_new_revision_and_session(self) -> None:
        enrollment = self.enroll()
        self.move(enrollment.id, "M03", revision=self.origin.id, file_path="project/index.html", cursor_line=7)
        entered = self.move(enrollment.id, "M03", bridge="B-HTML")
        self.assertEqual(entered.return_revision_id, self.origin.id)
        bridge_work = self.add_revision(self.project.id, 2, "bridge/example.html", "practice")
        self.db.commit()
        self.move(enrollment.id, "M03", bridge="B-HTML", revision=bridge_work.id, file_path="bridge/example.html", cursor_line=2)
        with Session(self.engine) as reopened:
            stored = service.get_enrollment(reopened, self.user, enrollment.id)
            self.assertEqual(stored.last_revision_id, bridge_work.id)
            self.assertEqual(stored.return_revision_id, self.origin.id)
            self.assertEqual(stored.return_file_path, "project/index.html")
            self.assertEqual(stored.return_cursor_line, 7)
        with self.assertRaises(service.InvalidJourney):
            self.move(enrollment.id, "M03", revision=bridge_work.id)
        restored = self.move(enrollment.id, "M03")
        self.assertEqual(restored.last_revision_id, self.origin.id)
        self.assertEqual(restored.last_revision_hash, self.origin.source_hash)
        self.assertEqual((restored.last_file_path, restored.last_cursor_line), ("project/index.html", 7))
        self.assertIsNone(restored.active_bridge_id)

    def test_http_bridge_returns_to_actual_m07_origin(self) -> None:
        enrollment = self.enroll()
        self.move(enrollment.id, "M07", revision=self.origin.id)
        self.move(enrollment.id, "M07", bridge="B-HTTP")
        with self.assertRaises(service.InvalidJourney):
            self.move(enrollment.id, "M06")
        restored = self.move(enrollment.id, "M07")
        self.assertEqual(restored.current_node_id, "M07")

    def test_cross_project_revision_and_unknown_file_are_rejected(self) -> None:
        enrollment = self.enroll()
        other = Project(owner_id=self.user.id, name="다른 프로젝트", description="")
        self.db.add(other)
        self.db.flush()
        foreign_revision = self.add_revision(other.id, 1, "foreign.py", "other")
        with self.assertRaises(service.InvalidJourney):
            self.move(enrollment.id, "M03", revision=foreign_revision.id)
        with self.assertRaises(service.InvalidJourney):
            self.move(enrollment.id, "M03", revision=self.origin.id, file_path="missing.py")

    def test_deleted_project_retains_evidence_but_cannot_fake_bridge_recovery(self) -> None:
        enrollment = self.enroll()
        self.move(enrollment.id, "M03", revision=self.origin.id)
        self.move(enrollment.id, "M03", bridge="B-HTML")
        evidence = LearningAssessmentEvidence(
            enrollment_id=enrollment.id, user_id=self.user.id, mission_id="M03",
            assessment_id="fixture", assessment_type="FUNCTIONAL", content_version="1.0",
            rubric_version="1.0", revision_id=self.origin.id,
            revision_hash=self.origin.source_hash, status="UNAVAILABLE", payload={},
        )
        self.db.add(evidence)
        self.db.commit()
        original_hash = self.origin.source_hash
        self.db.delete(self.project)
        self.db.commit()
        self.db.expire_all()
        stored = self.db.get(LearningEnrollment, enrollment.id)
        self.assertIsNone(stored.project_id)
        self.assertIsNone(stored.return_revision_id)
        self.assertEqual(stored.return_revision_hash, original_hash)
        self.assertEqual(evidence.revision_hash, original_hash)
        self.assertEqual(evidence.status, "UNAVAILABLE")
        with self.assertRaises(service.InvalidJourney):
            self.move(enrollment.id, "M03")

    def test_rubric_change_does_not_silently_reuse_previous_state(self) -> None:
        enrollment = self.enroll()
        self.catalogue["rubric_version"] = "2.0"
        self.write_catalogue()
        with self.assertRaises(service.CourseUnavailable):
            self.move(enrollment.id, "M03")
        self.assertEqual(self.db.get(LearningEnrollment, enrollment.id).current_node_id, "M01")

    def test_client_cannot_submit_grade_or_return_snapshot_and_paths_are_safe(self) -> None:
        with self.assertRaises(ValidationError):
            LearningEnrollmentCreateRequest.model_validate({"course_key": "WEB-FS-01", "status": "COMPLETED"})
        for extra in (
            {"return_revision_hash": "fake"}, {"return_mission_id": "M99"}, {"file_path": "../.env"},
            {"file_path": "C:/secret"}, {"cursor_line": 3},
        ):
            with self.subTest(extra=extra), self.assertRaises(ValidationError):
                LearningJourneyUpdateRequest.model_validate({"current_node_id": "M03", **extra})


if __name__ == "__main__":
    unittest.main()
