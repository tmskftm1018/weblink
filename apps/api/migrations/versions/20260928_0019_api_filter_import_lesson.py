"""Add a filtering API import lesson.

Revision ID: 20260928_0019
Revises: 20260928_0018
Create Date: 2026-09-28
"""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0019"
down_revision: str | None = "20260928_0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000004")
LESSON_ID = UUID("44000000-0000-4000-8000-000000000007")
CONCEPT_ID = UUID("44000000-0000-4000-8000-000000000002")
CONTENT = {
    "scenario": "API 목록을 전부 저장하는 대신 조건에 맞는 자료만 골라 내 프로젝트 DB에 보관합니다. 점수가 90점 이상인 학생을 찾아 다시 조회합니다.",
    "steps": [
        {"label": "목록 받기", "value": "GET /students", "description": "세 학생의 정보를 API에서 가져옵니다."},
        {"label": "조건으로 고르기", "value": "if score >= 90", "description": "반복문 안에서 점수가 기준 이상인지 확인합니다."},
        {"label": "골라 저장하기", "value": "SQLite · COUNT", "description": "조건을 통과한 학생만 DB에 저장하고 개수를 확인합니다."},
    ],
    "challenge": "API 학생 목록에서 90점 이상인 학생만 프로젝트 DB에 저장하고 몇 명인지 출력하세요.",
    "prompts": [
        {"field": "input", "label": "가져올 API 자료", "placeholder": "학생 세 명의 점수 목록"},
        {"field": "process", "label": "조건에 맞는 자료만 저장하는 코드", "placeholder": "반복과 조건 블록을 조립하세요"},
        {"field": "output", "label": "90점 이상인 학생 수", "placeholder": "90점 이상 학생: 2"},
    ],
    "block_activity": {
        "instruction": "API 학생 목록을 반복하면서 90점 이상인 경우만 DB에 저장하고, 저장된 수를 확인하도록 블록을 조립하세요.",
        "expected_output": "90점 이상 학생: 2",
        "blocks": [
            {"id": "import-sqlite", "label": "SQLite 도구 가져오기", "code": "import sqlite3\n", "description": "프로젝트 DB 도구를 준비합니다."},
            {"id": "import-api", "label": "API 도구 가져오기", "code": "from weblink_api import get_json\n", "description": "학생 목록을 요청하는 함수를 가져옵니다."},
            {"id": "open-db", "label": "프로젝트 DB 열기", "code": "connection = sqlite3.connect('/data/students.db')\n", "description": "이 프로젝트의 저장소를 엽니다."},
            {"id": "create-table", "label": "높은 점수 표 준비", "code": "connection.execute('CREATE TABLE IF NOT EXISTS high_scores (id INTEGER PRIMARY KEY, name TEXT, score INTEGER)')\n", "description": "기준을 통과한 학생을 저장할 표를 만듭니다."},
            {"id": "request-list", "label": "API 목록 요청", "code": "response = get_json('/students')\n", "description": "여러 학생의 JSON 목록을 받습니다."},
            {"id": "loop-filter-store", "label": "반복하며 조건 확인 후 저장", "code": "for student in response['students']:\n    if student['score'] >= 90:\n        connection.execute('INSERT OR REPLACE INTO high_scores VALUES (?, ?, ?)', (student['id'], student['name'], student['score']))\n", "description": "각 점수를 확인하고 기준을 통과한 학생만 안전한 SQL 매개변수로 저장합니다."},
            {"id": "commit", "label": "저장 확정", "code": "connection.commit()\n", "description": "DB에 변경 내용을 반영합니다."},
            {"id": "count-qualified", "label": "저장된 학생 수 조회", "code": "count = connection.execute('SELECT COUNT(*) FROM high_scores').fetchone()[0]\n", "description": "조건을 통과해 저장된 행 수를 셉니다."},
            {"id": "display-qualified", "label": "결과 출력하고 DB 닫기", "code": "print(f'90점 이상 학생: {count}')\nconnection.close()", "description": "DB에서 읽은 수를 화면에 보여줍니다."},
            {"id": "skip-filter", "label": "숫자만 바로 출력", "code": "print('90점 이상 학생: 2')\n", "description": "API 목록과 DB를 사용하지 않고 결과만 출력합니다."},
        ],
    },
}


def upgrade() -> None:
    lessons = sa.table("lessons", sa.column("id", sa.Uuid()), sa.column("course_id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("summary", sa.Text()), sa.column("learning_objective", sa.Text()), sa.column("content", sa.JSON()), sa.column("order_index", sa.Integer()), sa.column("is_published", sa.Boolean()))
    lesson_concepts = sa.table("lesson_concepts", sa.column("lesson_id", sa.Uuid()), sa.column("concept_id", sa.Uuid()))
    op.bulk_insert(lessons, [{"id": LESSON_ID, "course_id": COURSE_ID, "slug": "api-filter-import", "title": "API 데이터에서 필요한 것만 골라 저장하기", "summary": "조건에 맞는 API 자료만 골라 프로젝트 DB에 저장합니다.", "learning_objective": "API 목록을 조건으로 필터링해 필요한 데이터만 DB에 저장하고 조회합니다.", "content": CONTENT, "order_index": 6, "is_published": True}])
    op.bulk_insert(lesson_concepts, [{"lesson_id": LESSON_ID, "concept_id": CONCEPT_ID}])


def downgrade() -> None:
    op.execute(f"DELETE FROM lesson_concepts WHERE lesson_id = '{LESSON_ID}'")
    op.execute(f"DELETE FROM lessons WHERE id = '{LESSON_ID}'")
