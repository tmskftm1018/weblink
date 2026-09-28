"""Add an end-to-end API-to-project-database lesson.

Revision ID: 20260928_0016
Revises: 20260928_0015
Create Date: 2026-09-28
"""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0016"
down_revision: str | None = "20260928_0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000004")
LESSON_ID = UUID("44000000-0000-4000-8000-000000000004")
CONCEPT_ID = UUID("44000000-0000-4000-8000-000000000002")
CONTENT = {
    "scenario": "이제 API에서 받은 데이터를 내 프로젝트 DB에 저장하고 다시 읽습니다. 실습 API의 정보가 프로젝트의 /data/students.db에 기록되므로 프로젝트를 다시 실행해도 보관됩니다.",
    "steps": [
        {"label": "다른 앱에서 가져오기", "value": "GET · JSON", "description": "실습 API에 학생 정보를 요청해 응답을 받습니다."},
        {"label": "내 프로젝트에 저장하기", "value": "SQLite · INSERT", "description": "응답의 이름과 점수를 프로젝트 전용 DB에 기록합니다."},
        {"label": "다시 사용하기", "value": "SELECT", "description": "DB에서 저장된 행을 읽어 화면에 보여줍니다."},
    ],
    "challenge": "API에서 민지의 정보를 받아 프로젝트 DB에 저장하고, DB에서 다시 읽은 이름과 점수를 화면에 보여주세요.",
    "prompts": [
        {"field": "input", "label": "가져올 학생 정보", "placeholder": "API의 /students/1"},
        {"field": "process", "label": "가져와 저장하고 다시 읽는 코드", "placeholder": "블록으로 코드를 조립하세요"},
        {"field": "output", "label": "DB에서 읽은 결과", "placeholder": "예: 민지: 95"},
    ],
    "block_activity": {
        "instruction": "API에서 받은 학생 정보를 내 프로젝트 DB에 저장하고, 저장한 값을 다시 사용하도록 코드를 조립하세요.",
        "expected_output": "민지: 95",
        "blocks": [
            {"id": "import-sqlite", "label": "SQLite 도구 가져오기", "code": "import sqlite3\n", "description": "프로젝트 DB를 다루는 도구를 준비합니다."},
            {"id": "import-api", "label": "API 요청 도구 가져오기", "code": "from weblink_api import get_json\n", "description": "다른 앱에 학생 정보를 요청하는 함수를 가져옵니다."},
            {"id": "open-db", "label": "프로젝트 DB 열기", "code": "connection = sqlite3.connect('/data/students.db')\n", "description": "프로젝트마다 분리된 저장소에 연결합니다."},
            {"id": "create-table", "label": "저장할 표 준비", "code": "connection.execute('CREATE TABLE IF NOT EXISTS api_students (id INTEGER PRIMARY KEY, name TEXT, score INTEGER)')\n", "description": "API에서 받은 학생 정보를 저장할 표를 준비합니다."},
            {"id": "request-api", "label": "API에서 학생 정보 받기", "code": "student = get_json('/students/1')\n", "description": "GET 요청의 JSON 응답을 파이썬 데이터로 받습니다."},
            {"id": "save-api-data", "label": "응답 데이터를 DB에 저장", "code": "connection.execute('INSERT OR REPLACE INTO api_students VALUES (?, ?, ?)', (student['id'], student['name'], student['score']))\n", "description": "응답 값을 SQL 매개변수로 전달해 저장합니다."},
            {"id": "read-saved-data", "label": "DB에서 저장된 값 읽기", "code": "saved_student = connection.execute('SELECT name, score FROM api_students WHERE id = ?', (student['id'],)).fetchone()\n", "description": "방금 저장한 학생 행을 데이터베이스에서 조회합니다."},
            {"id": "show-saved", "label": "조회 결과 보여주기", "code": "print(f'{saved_student[0]}: {saved_student[1]}')\nconnection.close()", "description": "DB에서 읽은 이름과 점수를 화면에 표시합니다."},
            {"id": "skip-database", "label": "결과만 바로 출력", "code": "print('민지: 95')\n", "description": "API나 DB에서 읽지 않고 결과만 출력합니다."},
        ],
    },
}


def upgrade() -> None:
    lessons = sa.table("lessons", sa.column("id", sa.Uuid()), sa.column("course_id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("summary", sa.Text()), sa.column("learning_objective", sa.Text()), sa.column("content", sa.JSON()), sa.column("order_index", sa.Integer()), sa.column("is_published", sa.Boolean()))
    lesson_concepts = sa.table("lesson_concepts", sa.column("lesson_id", sa.Uuid()), sa.column("concept_id", sa.Uuid()))
    op.bulk_insert(lessons, [{"id": LESSON_ID, "course_id": COURSE_ID, "slug": "api-to-database", "title": "API 데이터를 내 DB에 저장하기", "summary": "다른 앱에서 받은 JSON을 프로젝트 DB에 저장하고 다시 읽습니다.", "learning_objective": "API 요청, JSON 데이터 처리, 프로젝트 DB 저장과 조회를 하나의 앱 흐름으로 연결합니다.", "content": CONTENT, "order_index": 3, "is_published": True}])
    op.bulk_insert(lesson_concepts, [{"lesson_id": LESSON_ID, "concept_id": CONCEPT_ID}])


def downgrade() -> None:
    op.execute(f"DELETE FROM lesson_concepts WHERE lesson_id = '{LESSON_ID}'")
    op.execute(f"DELETE FROM lessons WHERE id = '{LESSON_ID}'")
