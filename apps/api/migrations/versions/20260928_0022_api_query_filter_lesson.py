"""Add a lesson on filtering data with API query parameters.

Revision ID: 20260928_0022
Revises: 20260928_0021
Create Date: 2026-09-28
"""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0022"
down_revision: str | None = "20260928_0021"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000004")
LESSON_ID = UUID("44000000-0000-4000-8000-000000000010")
CONCEPT_ID = UUID("44000000-0000-4000-8000-000000000002")
CONTENT = {
    "scenario": "자료가 많을 때 앱이 전부 받은 뒤 거르지 않아도 됩니다. 검색 조건을 URL에 함께 보내면 API가 필요한 학생만 돌려줍니다.",
    "steps": [
        {"label": "검색 조건 정하기", "value": "minimum_score=90", "description": "URL 뒤에 점수 기준을 query parameter로 붙입니다."},
        {"label": "필요한 자료 요청", "value": "GET /students?…", "description": "API가 조건에 맞는 학생만 응답합니다."},
        {"label": "응답 사용하기", "value": "JSON · for", "description": "돌아온 학생 이름을 화면에 표시합니다."},
    ],
    "challenge": "점수 기준을 API에 함께 보내 90점 이상인 학생만 받아 이름을 출력하세요.",
    "prompts": [
        {"field": "input", "label": "API에 보낼 검색 조건", "placeholder": "minimum_score=90"},
        {"field": "process", "label": "조건에 맞는 API 자료를 사용하는 코드", "placeholder": "query parameter와 응답을 연결하세요"},
        {"field": "output", "label": "API가 찾은 학생", "placeholder": "90점 이상: 민지, 지우"},
    ],
    "block_activity": {
        "instruction": "API에 최소 점수를 검색 조건으로 보내고, 응답으로 받은 학생 이름을 출력하도록 블록을 조립하세요.",
        "expected_output": "90점 이상: 민지, 지우",
        "blocks": [
            {"id": "import-api", "label": "API 요청 도구 가져오기", "code": "from weblink_api import get_json\n", "description": "학생 목록을 요청하는 함수를 준비합니다."},
            {"id": "request-filtered", "label": "점수 조건을 붙여 요청", "code": "response = get_json('/students?minimum_score=90')\n", "description": "URL에 검색 조건을 담아 API에 보냅니다."},
            {"id": "get-students", "label": "응답에서 학생 목록 꺼내기", "code": "students = response['students']\n", "description": "조건에 맞는 학생들이 담긴 JSON 목록을 가져옵니다."},
            {"id": "extract-names", "label": "이름만 목록으로 만들기", "code": "names = [student['name'] for student in students]\n", "description": "응답에 들어 있는 학생들의 이름을 모읍니다."},
            {"id": "show-names", "label": "결과 출력", "code": "print(f\"90점 이상: {', '.join(names)}\")", "description": "검색 결과 이름을 보기 좋게 보여줍니다."},
            {"id": "skip-request", "label": "결과만 바로 출력", "code": "print('90점 이상: 민지, 지우')\n", "description": "API 요청 없이 결과만 출력합니다."},
        ],
    },
}


def upgrade() -> None:
    lessons = sa.table("lessons", sa.column("id", sa.Uuid()), sa.column("course_id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("summary", sa.Text()), sa.column("learning_objective", sa.Text()), sa.column("content", sa.JSON()), sa.column("order_index", sa.Integer()), sa.column("is_published", sa.Boolean()))
    lesson_concepts = sa.table("lesson_concepts", sa.column("lesson_id", sa.Uuid()), sa.column("concept_id", sa.Uuid()))
    op.bulk_insert(lessons, [{"id": LESSON_ID, "course_id": COURSE_ID, "slug": "api-query-filter", "title": "검색 조건을 API에 함께 보내기", "summary": "query parameter로 필요한 자료만 API에 요청합니다.", "learning_objective": "URL query parameter로 검색 조건을 전달해 필요한 API 자료만 받아 사용합니다.", "content": CONTENT, "order_index": 9, "is_published": True}])
    op.bulk_insert(lesson_concepts, [{"lesson_id": LESSON_ID, "concept_id": CONCEPT_ID}])


def downgrade() -> None:
    op.execute(f"DELETE FROM lesson_concepts WHERE lesson_id = '{LESSON_ID}'")
    op.execute(f"DELETE FROM lessons WHERE id = '{LESSON_ID}'")
