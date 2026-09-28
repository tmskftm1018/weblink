"""Teach sending JSON data to an app API.

Revision ID: 20260928_0014
Revises: 20260928_0013
Create Date: 2026-09-28
"""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0014"
down_revision: str | None = "20260928_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000004")
LESSON_ID = UUID("44000000-0000-4000-8000-000000000003")
CONCEPT_ID = UUID("44000000-0000-4000-8000-000000000002")
CONTENT = {
    "scenario": "앞선 수업에서는 API에서 정보를 읽었습니다. 이번에는 내 앱에서 다른 앱으로 JSON 데이터를 보내고, 생성됐다는 응답을 받아 결과를 보여줍니다. 실습 API의 데이터는 이번 실행 중에만 유지됩니다.",
    "steps": [
        {"label": "보낼 값 준비", "value": "name · score", "description": "다른 앱에 전달할 학생 정보를 준비합니다."},
        {"label": "전송", "value": "POST /students", "description": "JSON 본문을 API에 보내 새 학생을 등록합니다."},
        {"label": "응답 사용", "value": "201 Created", "description": "API가 되돌려 준 생성 결과에서 이름을 읽어 화면에 표시합니다."},
    ],
    "challenge": "서준의 점수 88을 JSON으로 API에 보내고, 생성 응답에서 이름을 읽어 완료 문구를 보여주세요.",
    "prompts": [
        {"field": "input", "label": "API에 보낼 학생 정보", "placeholder": "이름: 서준, 점수: 88"},
        {"field": "process", "label": "보내고 응답을 읽는 코드", "placeholder": "블록으로 코드를 조립하세요"},
        {"field": "output", "label": "화면에 나타날 결과", "placeholder": "예: 저장 완료: 서준"},
    ],
    "block_activity": {
        "instruction": "POST 도구 준비 → 보낼 데이터 만들기 → API로 전송 → 응답의 이름 표시 순서로 쌓으세요.",
        "expected_output": "저장 완료: 서준",
        "blocks": [
            {"id": "import-post", "label": "데이터 보내기 도구 가져오기", "code": "from weblink_api import post_json\n", "description": "JSON 데이터를 보내는 API 요청 도구를 가져옵니다."},
            {"id": "prepare-student", "label": "학생 데이터 준비", "code": "student_data = {'name': '서준', 'score': 88}\n", "description": "API로 보낼 이름과 점수를 준비합니다."},
            {"id": "send-student", "label": "학생 데이터 전송", "code": "result = post_json('/students', student_data)\nstudent = result['student']\n", "description": "POST 요청으로 데이터를 보내고 생성 응답을 받습니다."},
            {"id": "show-created", "label": "생성 결과 보여주기", "code": "print(f\"저장 완료: {student['name']}\")", "description": "응답에 들어 있는 이름으로 완료 문구를 만듭니다."},
            {"id": "skip-post", "label": "완료 문구만 출력", "code": "print('저장 완료: 서준')\n", "description": "API에 보내지 않고 결과만 출력합니다."},
        ],
    },
}


def upgrade() -> None:
    lessons = sa.table("lessons", sa.column("id", sa.Uuid()), sa.column("course_id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("summary", sa.Text()), sa.column("learning_objective", sa.Text()), sa.column("content", sa.JSON()), sa.column("order_index", sa.Integer()), sa.column("is_published", sa.Boolean()))
    lesson_concepts = sa.table("lesson_concepts", sa.column("lesson_id", sa.Uuid()), sa.column("concept_id", sa.Uuid()))
    op.bulk_insert(lessons, [{"id": LESSON_ID, "course_id": COURSE_ID, "slug": "api-send-data", "title": "앱에서 API로 데이터 보내기", "summary": "JSON 데이터로 POST 요청을 보내고 생성 응답을 사용합니다.", "learning_objective": "JSON 요청 본문을 다른 앱에 보내고 응답 데이터를 확인해 사용합니다.", "content": CONTENT, "order_index": 2, "is_published": True}])
    op.bulk_insert(lesson_concepts, [{"lesson_id": LESSON_ID, "concept_id": CONCEPT_ID}])


def downgrade() -> None:
    op.execute(f"DELETE FROM lesson_concepts WHERE lesson_id = '{LESSON_ID}'")
    op.execute(f"DELETE FROM lessons WHERE id = '{LESSON_ID}'")
