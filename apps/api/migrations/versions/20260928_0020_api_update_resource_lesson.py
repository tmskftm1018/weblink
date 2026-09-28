"""Add a lesson for updating an API resource with PUT.

Revision ID: 20260928_0020
Revises: 20260928_0019
Create Date: 2026-09-28
"""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0020"
down_revision: str | None = "20260928_0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000004")
LESSON_ID = UUID("44000000-0000-4000-8000-000000000008")
CONCEPT_ID = UUID("44000000-0000-4000-8000-000000000002")
CONTENT = {
    "scenario": "앱에서 바꾼 정보를 다른 서비스에도 반영합니다. 학생 정보를 PUT으로 보내고, API가 돌려준 최신 내용을 확인합니다.",
    "steps": [
        {"label": "수정할 자료 준비", "value": "id · name · score", "description": "서비스가 받을 전체 학생 정보를 준비합니다."},
        {"label": "API 자료 갱신", "value": "PUT /students/1", "description": "학생 번호를 지정해 수정한 JSON을 보냅니다."},
        {"label": "응답 확인", "value": "200 OK · JSON", "description": "서비스가 실제로 반영한 값을 응답에서 확인합니다."},
    ],
    "challenge": "민지의 점수를 100점으로 수정해 API에 보내고, 응답으로 확인한 내용을 출력하세요.",
    "prompts": [
        {"field": "input", "label": "수정할 학생", "placeholder": "번호 1 민지"},
        {"field": "process", "label": "수정 내용을 보내는 코드", "placeholder": "PUT 요청 블록을 조립하세요"},
        {"field": "output", "label": "API에서 확인한 수정 결과", "placeholder": "수정 완료: 민지 100점"},
    ],
    "block_activity": {
        "instruction": "민지의 새 점수를 PUT 요청으로 API에 반영하고, 요청 결과로 돌아온 학생 정보를 보여주도록 블록을 조립하세요.",
        "expected_output": "수정 완료: 민지 100점",
        "blocks": [
            {"id": "import-put", "label": "PUT 요청 도구 가져오기", "code": "from weblink_api import put_json\n", "description": "서비스의 자료를 수정하는 함수를 준비합니다."},
            {"id": "prepare-student", "label": "수정할 학생 정보 준비", "code": "student_data = {'id': 1, 'name': '민지', 'score': 100}\n", "description": "번호, 이름, 바꿀 점수를 JSON에 담습니다."},
            {"id": "update-student", "label": "API에 전체 정보 보내기", "code": "result = put_json('/students/1', student_data)\nstudent = result['student']\n", "description": "PUT으로 자료를 갱신하고 응답에서 저장된 학생을 꺼냅니다."},
            {"id": "show-updated", "label": "응답 결과 출력", "code": "print(f\"수정 완료: {student['name']} {student['score']}점\")", "description": "내가 보낸 값이 아니라 API 응답에서 확인한 결과를 보여줍니다."},
            {"id": "skip-update", "label": "수정된 것처럼 출력", "code": "print('수정 완료: 민지 100점')\n", "description": "API에 요청하지 않고 결과만 출력합니다."},
        ],
    },
}


def upgrade() -> None:
    lessons = sa.table("lessons", sa.column("id", sa.Uuid()), sa.column("course_id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("summary", sa.Text()), sa.column("learning_objective", sa.Text()), sa.column("content", sa.JSON()), sa.column("order_index", sa.Integer()), sa.column("is_published", sa.Boolean()))
    lesson_concepts = sa.table("lesson_concepts", sa.column("lesson_id", sa.Uuid()), sa.column("concept_id", sa.Uuid()))
    op.bulk_insert(lessons, [{"id": LESSON_ID, "course_id": COURSE_ID, "slug": "api-update-resource", "title": "앱에서 수정한 내용을 API에 보내기", "summary": "PUT 요청으로 다른 서비스의 정보를 수정하고 응답을 확인합니다.", "learning_objective": "PUT 요청 본문에 JSON을 담아 외부 리소스를 수정하고 응답 결과를 확인합니다.", "content": CONTENT, "order_index": 7, "is_published": True}])
    op.bulk_insert(lesson_concepts, [{"lesson_id": LESSON_ID, "concept_id": CONCEPT_ID}])


def downgrade() -> None:
    op.execute(f"DELETE FROM lesson_concepts WHERE lesson_id = '{LESSON_ID}'")
    op.execute(f"DELETE FROM lessons WHERE id = '{LESSON_ID}'")
