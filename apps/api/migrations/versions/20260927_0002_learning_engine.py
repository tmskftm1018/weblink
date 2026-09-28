"""Add seeded learning content, progress, and evidence.

Revision ID: 20260927_0002
Revises: 20260927_0001
Create Date: 2026-09-27
"""

import json
from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260927_0002"
down_revision: str | None = "20260927_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000001")
LESSON_ID = UUID("20000000-0000-4000-8000-000000000001")
CONCEPT_IDS = {
    "input": UUID("30000000-0000-4000-8000-000000000001"),
    "process": UUID("30000000-0000-4000-8000-000000000002"),
    "output": UUID("30000000-0000-4000-8000-000000000003"),
}

LESSON_CONTENT = {
    "scenario": "민지의 이름을 입력하면 ‘안녕, 민지!’라고 보여주는 기능을 만든다고 상상해 보세요.",
    "steps": [
        {"label": "입력", "value": "민지", "description": "사용자가 프로그램에 알려주는 값입니다."},
        {"label": "처리", "value": "인사말과 이름을 이어 붙입니다.", "description": "프로그램이 입력을 바꾸거나 계산하는 과정입니다."},
        {"label": "출력", "value": "안녕, 민지!", "description": "프로그램이 처리한 뒤 돌려주는 결과입니다."},
    ],
    "challenge": "이름을 입력하면 인사말을 보여주는 프로그램에서 입력, 처리, 출력은 각각 무엇인가요?",
    "prompts": [
        {"field": "input", "label": "입력: 프로그램이 받는 값", "placeholder": "예: 사용자의 이름"},
        {"field": "process", "label": "처리: 프로그램이 하는 일", "placeholder": "예: 인사말과 이름을 이어 붙인다"},
        {"field": "output", "label": "출력: 화면에 보이는 결과", "placeholder": "예: 안녕, 민지!"},
    ],
}


def upgrade() -> None:
    op.create_table(
        "courses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("ix_courses_slug", "courses", ["slug"], unique=True)
    op.create_table(
        "concepts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
    )
    op.create_index("ix_concepts_slug", "concepts", ["slug"], unique=True)
    op.create_table(
        "lessons",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("learning_objective", sa.Text(), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False),
        sa.Column("is_published", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["course_id"], ["courses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("course_id", "slug", name="uq_lesson_course_slug"),
    )
    op.create_index("ix_lessons_course_id", "lessons", ["course_id"])
    op.create_table(
        "lesson_concepts",
        sa.Column("lesson_id", sa.Uuid(), nullable=False),
        sa.Column("concept_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["concept_id"], ["concepts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("lesson_id", "concept_id"),
        sa.UniqueConstraint("lesson_id", "concept_id", name="uq_lesson_concept"),
    )
    op.create_table(
        "learning_progress",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("lesson_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("attempts_count", sa.Integer(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "lesson_id", name="uq_progress_user_lesson"),
    )
    op.create_index("ix_learning_progress_lesson_id", "learning_progress", ["lesson_id"])
    op.create_index("ix_learning_progress_user_id", "learning_progress", ["user_id"])
    op.create_table(
        "learning_evidence",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("lesson_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["lesson_id"], ["lessons.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_learning_evidence_lesson_id", "learning_evidence", ["lesson_id"])
    op.create_index("ix_learning_evidence_user_id", "learning_evidence", ["user_id"])

    courses = sa.table(
        "courses",
        sa.column("id", sa.Uuid()),
        sa.column("slug", sa.String()),
        sa.column("title", sa.String()),
        sa.column("description", sa.Text()),
        sa.column("order_index", sa.Integer()),
    )
    concepts = sa.table(
        "concepts",
        sa.column("id", sa.Uuid()),
        sa.column("slug", sa.String()),
        sa.column("name", sa.String()),
        sa.column("description", sa.Text()),
    )
    lesson_concepts = sa.table(
        "lesson_concepts",
        sa.column("lesson_id", sa.Uuid()),
        sa.column("concept_id", sa.Uuid()),
    )
    op.bulk_insert(
        courses,
        [{
            "id": COURSE_ID,
            "slug": "software-basics",
            "title": "소프트웨어의 흐름",
            "description": "아이디어가 어떻게 입력, 처리, 출력으로 이어지는지 첫 프로그램의 관점에서 배웁니다.",
            "order_index": 1,
        }],
    )
    lesson_content = json.dumps(LESSON_CONTENT, ensure_ascii=False).replace("'", "''")
    op.execute(
        "INSERT INTO lessons "
        "(id, course_id, slug, title, summary, learning_objective, content, order_index, is_published) "
        f"VALUES ('{LESSON_ID}', '{COURSE_ID}', 'input-process-output', '입력, 처리, 출력', "
        "'프로그램의 기본 흐름을 일상적인 인사말 기능으로 이해합니다.', "
        "'기능을 입력, 처리, 출력으로 나누어 설명할 수 있습니다.', "
        f"'{lesson_content}'::json, 1, true)"
    )
    op.bulk_insert(
        concepts,
        [
            {"id": CONCEPT_IDS["input"], "slug": "input", "name": "입력", "description": "프로그램이 사용자나 다른 시스템에서 받는 값입니다."},
            {"id": CONCEPT_IDS["process"], "slug": "process", "name": "처리", "description": "프로그램이 입력을 계산하거나 변환하는 단계입니다."},
            {"id": CONCEPT_IDS["output"], "slug": "output", "name": "출력", "description": "처리가 끝난 뒤 사용자에게 전달하는 결과입니다."},
        ],
    )
    op.bulk_insert(
        lesson_concepts,
        [{"lesson_id": LESSON_ID, "concept_id": concept_id} for concept_id in CONCEPT_IDS.values()],
    )


def downgrade() -> None:
    op.drop_index("ix_learning_evidence_user_id", table_name="learning_evidence")
    op.drop_index("ix_learning_evidence_lesson_id", table_name="learning_evidence")
    op.drop_table("learning_evidence")
    op.drop_index("ix_learning_progress_user_id", table_name="learning_progress")
    op.drop_index("ix_learning_progress_lesson_id", table_name="learning_progress")
    op.drop_table("learning_progress")
    op.drop_table("lesson_concepts")
    op.drop_index("ix_lessons_course_id", table_name="lessons")
    op.drop_table("lessons")
    op.drop_index("ix_concepts_slug", table_name="concepts")
    op.drop_table("concepts")
    op.drop_index("ix_courses_slug", table_name="courses")
    op.drop_table("courses")
