"""Add a batch API import into the project database.

Revision ID: 20260928_0018
Revises: 20260928_0017
Create Date: 2026-09-28
"""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0018"
down_revision: str | None = "20260928_0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000004")
LESSON_ID = UUID("44000000-0000-4000-8000-000000000006")
CONCEPT_ID = UUID("44000000-0000-4000-8000-000000000002")
CONTENT = {
    "scenario": "이번에는 여러 학생이 들어 있는 API 목록을 가져옵니다. for 반복으로 각 항목을 프로젝트 DB에 저장하고, 저장된 행의 개수를 다시 조회합니다. 같은 프로젝트에서 다시 실행해도 중복 데이터가 생기지 않습니다.",
    "steps": [
        {"label": "목록 요청", "value": "GET /students", "description": "API가 여러 학생을 JSON 목록으로 돌려줍니다."},
        {"label": "반복 저장", "value": "for · INSERT OR REPLACE", "description": "목록을 한 명씩 읽어 프로젝트 DB에 저장합니다."},
        {"label": "결과 확인", "value": "COUNT(*)", "description": "DB에 저장된 학생 수를 다시 조회합니다."},
    ],
    "challenge": "API에서 학생 목록을 받아 모두 DB에 저장하고, 저장한 학생 수를 다시 조회해 보여주세요.",
    "prompts": [
        {"field": "input", "label": "API 학생 목록", "placeholder": "민지, 서준, 지우"},
        {"field": "process", "label": "목록 저장과 개수 조회 코드", "placeholder": "블록으로 코드를 조립하세요"},
        {"field": "output", "label": "저장된 학생 수", "placeholder": "저장한 학생 수: 3"},
    ],
    "block_activity": {
        "instruction": "API 목록의 모든 학생을 프로젝트 DB에 저장하고, DB에서 저장 결과를 확인하도록 블록을 조립하세요.",
        "expected_output": "저장한 학생 수: 3",
        "blocks": [
            {"id": "import-sqlite", "label": "SQLite 도구 가져오기", "code": "import sqlite3\n", "description": "프로젝트 데이터베이스 도구를 준비합니다."},
            {"id": "import-api", "label": "API 도구 가져오기", "code": "from weblink_api import get_json\n", "description": "다른 앱에 학생 목록을 요청하는 함수를 가져옵니다."},
            {"id": "open-db", "label": "프로젝트 DB 열기", "code": "connection = sqlite3.connect('/data/students.db')\n", "description": "이번 프로젝트 전용 DB를 엽니다."},
            {"id": "create-table", "label": "학생 표 준비", "code": "connection.execute('CREATE TABLE IF NOT EXISTS imported_students (id INTEGER PRIMARY KEY, name TEXT, score INTEGER)')\n", "description": "가져온 학생들을 저장할 표를 준비합니다."},
            {"id": "request-list", "label": "API 학생 목록 요청", "code": "response = get_json('/students')\n", "description": "여러 학생 정보가 담긴 JSON 응답을 받습니다."},
            {"id": "loop-store", "label": "목록을 반복해 저장", "code": "for student in response['students']:\n    connection.execute('INSERT OR REPLACE INTO imported_students VALUES (?, ?, ?)', (student['id'], student['name'], student['score']))\n", "description": "학생마다 한 번씩 안전한 SQL 매개변수로 기록합니다."},
            {"id": "commit", "label": "DB 변경 저장", "code": "connection.commit()\n", "description": "반복해서 입력한 내용을 데이터베이스에 확정합니다."},
            {"id": "count-students", "label": "저장한 행 개수 세기", "code": "count = connection.execute('SELECT COUNT(*) FROM imported_students').fetchone()[0]\n", "description": "DB에 실제로 저장된 학생 수를 조회합니다."},
            {"id": "display-count", "label": "저장 결과 출력하고 연결 닫기", "code": "print(f'저장한 학생 수: {count}')\nconnection.close()", "description": "DB에서 확인한 개수를 화면에 보여줍니다."},
            {"id": "skip-database", "label": "숫자만 바로 출력", "code": "print('저장한 학생 수: 3')\n", "description": "API와 DB를 사용하지 않고 결과만 출력합니다."},
        ],
    },
}


def upgrade() -> None:
    lessons = sa.table("lessons", sa.column("id", sa.Uuid()), sa.column("course_id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("summary", sa.Text()), sa.column("learning_objective", sa.Text()), sa.column("content", sa.JSON()), sa.column("order_index", sa.Integer()), sa.column("is_published", sa.Boolean()))
    lesson_concepts = sa.table("lesson_concepts", sa.column("lesson_id", sa.Uuid()), sa.column("concept_id", sa.Uuid()))
    op.bulk_insert(lessons, [{"id": LESSON_ID, "course_id": COURSE_ID, "slug": "api-batch-import", "title": "API 목록을 반복해 DB에 저장하기", "summary": "여러 JSON 항목을 반복해 프로젝트 DB에 저장하고 개수를 조회합니다.", "learning_objective": "API 목록을 반복해 DB에 중복 없이 저장하고 조회 결과를 확인합니다.", "content": CONTENT, "order_index": 5, "is_published": True}])
    op.bulk_insert(lesson_concepts, [{"lesson_id": LESSON_ID, "concept_id": CONCEPT_ID}])


def downgrade() -> None:
    op.execute(f"DELETE FROM lesson_concepts WHERE lesson_id = '{LESSON_ID}'")
    op.execute(f"DELETE FROM lessons WHERE id = '{LESSON_ID}'")
