"""Add beginner lessons on variables, conditions, and loops.

Revision ID: 20260928_0008
Revises: 20260928_0007
Create Date: 2026-09-28
"""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0008"
down_revision: str | None = "20260928_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000001")
LESSONS = [
    {
        "id": UUID("20000000-0000-4000-8000-000000000002"),
        "slug": "variables-and-values",
        "title": "변수에 값 담기",
        "summary": "프로그램이 이름 붙인 공간에 값을 저장하고 다시 사용하는 방법을 배웁니다.",
        "objective": "변수가 값을 보관하는 이름표라는 점을 설명할 수 있습니다.",
        "content": {
            "scenario": "게임에서 현재 점수 10을 score라는 변수에 저장하면, 프로그램은 나중에 그 값을 다시 꺼내 쓸 수 있어요.",
            "steps": [
                {"label": "값", "value": "10", "description": "변수에 보관할 점수입니다."},
                {"label": "저장", "value": "score = 10", "description": "score라는 이름표가 숫자 10을 가리키게 합니다."},
                {"label": "사용", "value": "점수: 10", "description": "필요할 때 변수에 담긴 값을 꺼내 보여줍니다."},
            ],
            "challenge": "점수 10을 변수에 저장하는 기능에서 값, 저장하는 방법, 화면에 보이는 결과는 무엇인가요?",
            "prompts": [
                {"field": "input", "label": "값: 변수에 넣을 내용", "placeholder": "예: 점수 10"},
                {"field": "process", "label": "저장: 프로그램이 하는 일", "placeholder": "예: score 변수에 10을 저장한다"},
                {"field": "output", "label": "사용: 변수에서 꺼내 보여주는 결과", "placeholder": "예: 점수 10"},
            ],
        },
        "order_index": 2,
        "concept": "variable",
    },
    {
        "id": UUID("20000000-0000-4000-8000-000000000003"),
        "slug": "conditions-and-choices",
        "title": "조건에 따라 선택하기",
        "summary": "조건이 참인지 확인하고, 그 결과에 따라 다른 일을 하는 방법을 배웁니다.",
        "objective": "간단한 조건과 조건에 따른 실행 결과를 설명할 수 있습니다.",
        "content": {
            "scenario": "밖에 비가 오는지 확인해서, 비가 오면 우산을 챙기도록 안내하는 프로그램을 생각해 봅시다.",
            "steps": [
                {"label": "상황", "value": "비가 오나요?", "description": "프로그램이 확인할 조건입니다."},
                {"label": "선택", "value": "비가 오면", "description": "조건이 참일 때 실행할 일을 정합니다."},
                {"label": "결과", "value": "우산을 챙기세요", "description": "조건에 따라 사용자에게 다른 안내를 합니다."},
            ],
            "challenge": "비가 오면 우산을 챙기라고 알려주는 기능에서 확인할 상황, 조건을 처리하는 방법, 결과는 무엇인가요?",
            "prompts": [
                {"field": "input", "label": "상황: 프로그램이 확인하는 정보", "placeholder": "예: 비가 오는지"},
                {"field": "process", "label": "선택: 프로그램의 판단", "placeholder": "예: 비가 오는 조건인지 확인한다"},
                {"field": "output", "label": "결과: 조건이 참일 때 안내", "placeholder": "예: 우산을 챙기세요"},
            ],
        },
        "order_index": 3,
        "concept": "condition",
    },
    {
        "id": UUID("20000000-0000-4000-8000-000000000004"),
        "slug": "repeat-with-loops",
        "title": "반복으로 여러 번 처리하기",
        "summary": "같은 작업을 여러 항목에 반복해서 적용하는 방법을 배웁니다.",
        "objective": "반복문이 여러 항목에 같은 작업을 적용하는 이유를 설명할 수 있습니다.",
        "content": {
            "scenario": "사과, 바나나, 포도처럼 여러 과일 이름을 하나씩 살펴보며 목록에 출력하는 프로그램을 만들어 봅시다.",
            "steps": [
                {"label": "목록", "value": "사과 · 바나나 · 포도", "description": "같은 작업을 적용할 여러 항목입니다."},
                {"label": "반복", "value": "항목을 하나씩 살펴보기", "description": "반복문이 각 과일에 같은 출력을 적용합니다."},
                {"label": "결과", "value": "과일 이름 세 개", "description": "각 항목이 빠짐없이 한 번씩 출력됩니다."},
            ],
            "challenge": "과일 목록의 이름을 차례대로 보여주는 기능에서 입력 목록, 반복하는 방법, 화면에 보일 결과는 무엇인가요?",
            "prompts": [
                {"field": "input", "label": "목록: 프로그램이 처리할 항목", "placeholder": "예: 사과, 바나나, 포도"},
                {"field": "process", "label": "반복: 프로그램이 항목을 처리하는 방법", "placeholder": "예: 반복문으로 하나씩 살펴본다"},
                {"field": "output", "label": "결과: 화면에 보일 항목", "placeholder": "예: 사과, 바나나, 포도"},
            ],
        },
        "order_index": 4,
        "concept": "loop",
    },
]
CONCEPTS = [
    ("40000000-0000-4000-8000-000000000004", "variable", "변수", "값을 이름으로 저장해 다시 사용하는 공간입니다."),
    ("40000000-0000-4000-8000-000000000005", "condition", "조건", "참인지 확인해 실행할 일을 선택하는 기준입니다."),
    ("40000000-0000-4000-8000-000000000006", "loop", "반복", "같은 작업을 여러 항목이나 여러 번에 적용하는 흐름입니다."),
]


def upgrade() -> None:
    concepts = sa.table(
        "concepts",
        sa.column("id", sa.Uuid()),
        sa.column("slug", sa.String()),
        sa.column("name", sa.String()),
        sa.column("description", sa.Text()),
    )
    lessons = sa.table(
        "lessons",
        sa.column("id", sa.Uuid()),
        sa.column("course_id", sa.Uuid()),
        sa.column("slug", sa.String()),
        sa.column("title", sa.String()),
        sa.column("summary", sa.Text()),
        sa.column("learning_objective", sa.Text()),
        sa.column("content", sa.JSON()),
        sa.column("order_index", sa.Integer()),
        sa.column("is_published", sa.Boolean()),
    )
    lesson_concepts = sa.table(
        "lesson_concepts",
        sa.column("lesson_id", sa.Uuid()),
        sa.column("concept_id", sa.Uuid()),
    )
    op.bulk_insert(
        concepts,
        [
            {"id": UUID(concept_id), "slug": slug, "name": name, "description": description}
            for concept_id, slug, name, description in CONCEPTS
        ],
    )
    op.bulk_insert(
        lessons,
        [
            {
                "id": lesson["id"],
                "course_id": COURSE_ID,
                "slug": lesson["slug"],
                "title": lesson["title"],
                "summary": lesson["summary"],
                "learning_objective": lesson["objective"],
                "content": lesson["content"],
                "order_index": lesson["order_index"],
                "is_published": True,
            }
            for lesson in LESSONS
        ],
    )
    concept_ids = {slug: UUID(concept_id) for concept_id, slug, _, _ in CONCEPTS}
    op.bulk_insert(
        lesson_concepts,
        [
            {"lesson_id": lesson["id"], "concept_id": concept_ids[lesson["concept"]]}
            for lesson in LESSONS
        ],
    )


def downgrade() -> None:
    op.execute("DELETE FROM lesson_concepts WHERE lesson_id IN (" + ",".join(f"'{lesson['id']}'" for lesson in LESSONS) + ")")
    op.execute("DELETE FROM lessons WHERE id IN (" + ",".join(f"'{lesson['id']}'" for lesson in LESSONS) + ")")
    op.execute("DELETE FROM concepts WHERE slug IN ('variable', 'condition', 'loop')")
