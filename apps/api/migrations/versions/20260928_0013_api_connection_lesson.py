"""Add the first app-to-app API integration lesson.

Revision ID: 20260928_0013
Revises: 20260928_0012
Create Date: 2026-09-28
"""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0013"
down_revision: str | None = "20260928_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000004")
LESSON_ID = UUID("44000000-0000-4000-8000-000000000001")
CONCEPT_ID = UUID("44000000-0000-4000-8000-000000000002")
CONTENT = {
    "scenario": "이번에는 별도 API 서비스에 학생 정보를 요청하고, JSON 응답에서 필요한 값을 골라 화면에 보여줍니다. 실습용 서비스와 앱은 실행마다 분리된 로컬 통신 통로로 연결됩니다. 인터넷이나 다른 프로젝트에는 연결되지 않습니다.",
    "steps": [
        {"label": "요청", "value": "GET /students/1", "description": "앱이 API에 특정 학생 정보를 요청합니다."},
        {"label": "응답", "value": "JSON", "description": "API가 이름과 점수가 담긴 JSON 데이터를 돌려줍니다."},
        {"label": "사용", "value": "student['name']", "description": "앱은 응답에서 필요한 값을 골라 결과를 만듭니다."},
    ],
    "challenge": "블록을 쌓아 API에 학생 정보를 요청하고 JSON에서 이름과 점수를 읽어 화면에 보여주세요.",
    "prompts": [
        {"field": "input", "label": "요청할 API 주소", "placeholder": "예: /students/1"},
        {"field": "process", "label": "응답을 읽어 결과를 만드는 코드", "placeholder": "블록으로 코드를 조립하세요"},
        {"field": "output", "label": "화면에 나타날 결과", "placeholder": "예: 민지: 95"},
    ],
    "block_activity": {
        "instruction": "API 도구 준비 → 학생 정보 요청 → JSON 값 출력 순서로 블록을 쌓으세요.",
        "expected_output": "민지: 95",
        "blocks": [
            {"id": "import-helper", "label": "API 연결 도구 가져오기", "code": "from weblink_api import get_json\n", "description": "격리된 실습 API에 요청하는 도구를 가져옵니다."},
            {"id": "request-student", "label": "학생 정보 요청", "code": "student = get_json('/students/1')\n", "description": "GET 요청을 보내고 JSON 응답을 파이썬 값으로 받습니다."},
            {"id": "show-student", "label": "이름과 점수 보여주기", "code": "print(f\"{student['name']}: {student['score']}\")", "description": "응답에서 이름과 점수를 꺼내 화면에 보여줍니다."},
            {"id": "skip-api", "label": "결과만 바로 출력", "code": "print('민지: 95')\n", "description": "API 응답을 사용하지 않고 결과만 적습니다."},
        ],
    },
}


def upgrade() -> None:
    courses = sa.table("courses", sa.column("id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("description", sa.Text()), sa.column("order_index", sa.Integer()))
    concepts = sa.table("concepts", sa.column("id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("name", sa.String()), sa.column("description", sa.Text()))
    lessons = sa.table("lessons", sa.column("id", sa.Uuid()), sa.column("course_id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("summary", sa.Text()), sa.column("learning_objective", sa.Text()), sa.column("content", sa.JSON()), sa.column("order_index", sa.Integer()), sa.column("is_published", sa.Boolean()))
    lesson_concepts = sa.table("lesson_concepts", sa.column("lesson_id", sa.Uuid()), sa.column("concept_id", sa.Uuid()))
    op.bulk_insert(courses, [{"id": COURSE_ID, "slug": "application-api-integration", "title": "앱과 API 연결하기", "description": "다른 앱에 정보를 요청하고 JSON 응답을 내 프로젝트에서 사용하는 흐름을 배웁니다.", "order_index": 4}])
    op.bulk_insert(concepts, [{"id": CONCEPT_ID, "slug": "api-integration", "name": "앱과 API 연결", "description": "앱이 API에 요청을 보내고 응답 데이터를 받아 화면이나 기능에 사용하는 방식입니다."}])
    op.bulk_insert(lessons, [{"id": LESSON_ID, "course_id": COURSE_ID, "slug": "api-json-basics", "title": "다른 앱의 API에서 데이터 가져오기", "summary": "GET 요청으로 JSON 데이터를 받고 앱에서 필요한 값을 사용합니다.", "learning_objective": "API 요청, JSON 응답, 앱에서 값 사용으로 이어지는 연결 흐름을 설명하고 실행합니다.", "content": CONTENT, "order_index": 1, "is_published": True}])
    op.bulk_insert(lesson_concepts, [{"lesson_id": LESSON_ID, "concept_id": CONCEPT_ID}])


def downgrade() -> None:
    op.execute(f"DELETE FROM lesson_concepts WHERE lesson_id = '{LESSON_ID}'")
    op.execute(f"DELETE FROM lessons WHERE id = '{LESSON_ID}'")
    op.execute(f"DELETE FROM concepts WHERE id = '{CONCEPT_ID}'")
    op.execute(f"DELETE FROM courses WHERE id = '{COURSE_ID}'")
