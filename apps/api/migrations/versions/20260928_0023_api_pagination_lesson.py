"""Teach fetching a large API list in pages."""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0023"
down_revision: str | None = "20260928_0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000004")
LESSON_ID = UUID("44000000-0000-4000-8000-000000000011")
CONCEPT_ID = UUID("44000000-0000-4000-8000-000000000002")
CONTENT = {
    "scenario": "학생 목록이 한 번에 다 오지 않을 때는 페이지를 나눠 요청합니다. 받은 페이지를 합쳐 전체 목록을 만들 수 있습니다.",
    "steps": [
        {"label": "첫 페이지 요청", "value": "limit · offset", "description": "한 번에 받을 수와 시작 위치를 지정합니다."},
        {"label": "다음 페이지 요청", "value": "offset=2", "description": "앞에서 받은 다음 위치부터 이어서 요청합니다."},
        {"label": "목록 합치기", "value": "list + list", "description": "각 응답의 학생 목록을 하나로 합칩니다."},
    ],
    "challenge": "학생을 두 명씩 나눠 두 번 요청하고, 전체 3명 중 3명을 받아왔다고 출력하세요.",
    "prompts": [
        {"field": "input", "label": "한 번에 받을 학생 수와 시작 위치", "placeholder": "limit=2, offset=0 다음 offset=2"},
        {"field": "process", "label": "두 페이지를 합치는 코드", "placeholder": "각 응답의 students 목록을 연결하세요"},
        {"field": "output", "label": "받아온 학생 수", "placeholder": "전체 3명 중 3명 받아오기"},
    ],
    "block_activity": {
        "instruction": "API에서 학생을 두 명씩 두 번 받아 목록을 합치고, 전체 인원과 받은 인원을 보여주세요.",
        "expected_output": "전체 3명 중 3명 받아오기",
        "blocks": [
            {"id": "request-next", "label": "다음 페이지 요청", "code": "next_page = get_json('/students?limit=2&offset=2')\n", "description": "첫 페이지 다음 위치부터 학생을 요청합니다."},
            {"id": "show-total", "label": "받은 수 출력", "code": "print(f\"전체 {first_page['total']}명 중 {len(students)}명 받아오기\")", "description": "API의 전체 수와 합친 목록의 수를 보여줍니다."},
            {"id": "import-api", "label": "API 도구 가져오기", "code": "from weblink_api import get_json\n", "description": "학생 페이지를 요청할 함수를 준비합니다."},
            {"id": "combine-pages", "label": "두 페이지 합치기", "code": "students = first_page['students'] + next_page['students']\n", "description": "두 응답의 학생 목록을 이어 붙입니다."},
            {"id": "skip-pages", "label": "결과만 출력", "code": "print('전체 3명 중 3명 받아오기')\n", "description": "요청하지 않고 정답 문장만 출력합니다."},
            {"id": "request-first", "label": "첫 페이지 요청", "code": "first_page = get_json('/students?limit=2&offset=0')\n", "description": "처음 두 학생을 요청합니다."},
        ],
    },
}


def upgrade() -> None:
    lessons = sa.table("lessons", sa.column("id", sa.Uuid()), sa.column("course_id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("summary", sa.Text()), sa.column("learning_objective", sa.Text()), sa.column("content", sa.JSON()), sa.column("order_index", sa.Integer()), sa.column("is_published", sa.Boolean()))
    lesson_concepts = sa.table("lesson_concepts", sa.column("lesson_id", sa.Uuid()), sa.column("concept_id", sa.Uuid()))
    op.bulk_insert(lessons, [{"id": LESSON_ID, "course_id": COURSE_ID, "slug": "api-pagination", "title": "큰 목록을 페이지로 나눠 받기", "summary": "limit과 offset으로 여러 API 응답을 이어 붙입니다.", "learning_objective": "페이지 위치와 크기를 지정해 API 목록을 나눠 요청하고 합칩니다.", "content": CONTENT, "order_index": 10, "is_published": True}])
    op.bulk_insert(lesson_concepts, [{"lesson_id": LESSON_ID, "concept_id": CONCEPT_ID}])


def downgrade() -> None:
    op.execute(f"DELETE FROM lesson_concepts WHERE lesson_id = '{LESSON_ID}'")
    op.execute(f"DELETE FROM lessons WHERE id = '{LESSON_ID}'")
