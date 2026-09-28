"""Add a learner-friendly API error handling lesson.

Revision ID: 20260928_0017
Revises: 20260928_0016
Create Date: 2026-09-28
"""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0017"
down_revision: str | None = "20260928_0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000004")
LESSON_ID = UUID("44000000-0000-4000-8000-000000000005")
CONCEPT_ID = UUID("44000000-0000-4000-8000-000000000002")
CONTENT = {
    "scenario": "API 요청이 성공하지 않는 경우도 있습니다. 없는 학생을 요청했을 때 돌아오는 오류를 처리하고, 사용자가 이해할 수 있는 안내를 보여줍니다.",
    "steps": [
        {"label": "요청", "value": "GET /students/999", "description": "목록에 없는 학생의 정보를 요청합니다."},
        {"label": "오류 받기", "value": "404 Not Found", "description": "API가 요청한 항목을 찾지 못했다고 알려줍니다."},
        {"label": "안내하기", "value": "try · except", "description": "오류가 나도 앱이 멈추지 않도록 메시지를 보여줍니다."},
    ],
    "challenge": "존재하지 않는 학생을 요청하고, API 오류를 잡아 이해하기 쉬운 안내를 보여주세요.",
    "prompts": [
        {"field": "input", "label": "요청할 학생 번호", "placeholder": "없는 번호 999"},
        {"field": "process", "label": "API 오류를 처리하는 코드", "placeholder": "블록으로 코드를 조립하세요"},
        {"field": "output", "label": "사용자에게 보여줄 안내", "placeholder": "학생 정보를 찾지 못했습니다."},
    ],
    "block_activity": {
        "instruction": "없는 학생을 요청하더라도 앱이 오류 화면으로 끝나지 않게 안내 코드를 조립하세요.",
        "expected_output": "학생 정보를 찾지 못했습니다.",
        "blocks": [
            {"id": "import-api", "label": "API 도구 가져오기", "code": "from weblink_api import get_json\n", "description": "학생 정보를 요청하는 API 함수를 가져옵니다."},
            {"id": "try-request", "label": "문제가 생길 수 있는 요청", "code": "try:\n    get_json('/students/999')\n", "description": "404 오류가 날 수 있는 요청을 시도합니다."},
            {"id": "handle-not-found", "label": "오류 안내 보여주기", "code": "except ValueError:\n    print('학생 정보를 찾지 못했습니다.')", "description": "요청 오류를 잡아 사용자에게 안내합니다."},
            {"id": "ignore-errors", "label": "오류를 무시하고 종료", "code": "print('오류')\n", "description": "구체적인 안내 없이 오류를 표시합니다."},
        ],
    },
}


def upgrade() -> None:
    lessons = sa.table("lessons", sa.column("id", sa.Uuid()), sa.column("course_id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("summary", sa.Text()), sa.column("learning_objective", sa.Text()), sa.column("content", sa.JSON()), sa.column("order_index", sa.Integer()), sa.column("is_published", sa.Boolean()))
    lesson_concepts = sa.table("lesson_concepts", sa.column("lesson_id", sa.Uuid()), sa.column("concept_id", sa.Uuid()))
    op.bulk_insert(lessons, [{"id": LESSON_ID, "course_id": COURSE_ID, "slug": "api-error-handling", "title": "API 오류를 사용자 안내로 바꾸기", "summary": "404 응답을 처리해 앱이 멈추지 않게 안내합니다.", "learning_objective": "API 요청 오류를 감지하고 사용자에게 알맞은 결과를 보여줍니다.", "content": CONTENT, "order_index": 4, "is_published": True}])
    op.bulk_insert(lesson_concepts, [{"lesson_id": LESSON_ID, "concept_id": CONCEPT_ID}])


def downgrade() -> None:
    op.execute(f"DELETE FROM lesson_concepts WHERE lesson_id = '{LESSON_ID}'")
    op.execute(f"DELETE FROM lessons WHERE id = '{LESSON_ID}'")
