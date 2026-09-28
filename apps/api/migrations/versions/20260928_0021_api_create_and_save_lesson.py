"""Add an end-to-end API create and database save lesson.

Revision ID: 20260928_0021
Revises: 20260928_0020
Create Date: 2026-09-28
"""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0021"
down_revision: str | None = "20260928_0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000004")
LESSON_ID = UUID("44000000-0000-4000-8000-000000000009")
CONCEPT_ID = UUID("44000000-0000-4000-8000-000000000002")
CONTENT = {
    "scenario": "내 앱에서 새 학생을 다른 서비스에 등록하고, 그 서비스가 새로 정한 번호를 받아 프로젝트 DB에도 보관합니다. 화면에는 내가 보낸 값뿐 아니라 API 응답과 DB에서 다시 읽은 번호가 표시됩니다.",
    "steps": [
        {"label": "새 학생 보내기", "value": "POST · JSON", "description": "이름과 점수를 서비스에 전달합니다."},
        {"label": "서비스가 만든 번호 받기", "value": "응답의 id", "description": "새 자료의 번호는 API가 정해 응답으로 돌려줍니다."},
        {"label": "내 DB에도 저장", "value": "SQLite · SELECT", "description": "응답의 번호와 이름을 저장한 뒤 다시 조회합니다."},
    ],
    "challenge": "서준을 API에 등록하고, 응답으로 받은 번호와 이름을 프로젝트 DB에 저장한 뒤 다시 읽어 보여주세요.",
    "prompts": [
        {"field": "input", "label": "등록할 학생", "placeholder": "서준, 88점"},
        {"field": "process", "label": "등록하고 DB에 보관하는 코드", "placeholder": "API 응답을 이어서 사용하세요"},
        {"field": "output", "label": "DB에서 다시 읽은 결과", "placeholder": "API 번호 4: 서준"},
    ],
    "block_activity": {
        "instruction": "새 학생을 API에 등록하고, 응답으로 받은 번호와 이름을 프로젝트 DB에 저장한 다음 다시 조회해 보여주세요.",
        "expected_output": "API 번호 4: 서준",
        "blocks": [
            {"id": "import-sqlite", "label": "SQLite 도구 가져오기", "code": "import sqlite3\n", "description": "프로젝트 DB를 다루는 도구를 준비합니다."},
            {"id": "import-post", "label": "등록 API 도구 가져오기", "code": "from weblink_api import post_json\n", "description": "새 자료를 API에 등록하는 함수를 가져옵니다."},
            {"id": "open-db", "label": "프로젝트 DB 열기", "code": "connection = sqlite3.connect('/data/students.db')\n", "description": "등록 응답을 보관할 프로젝트 DB를 엽니다."},
            {"id": "create-table", "label": "등록 학생 표 준비", "code": "connection.execute('CREATE TABLE IF NOT EXISTS created_students (id INTEGER PRIMARY KEY, name TEXT, score INTEGER)')\n", "description": "API 번호와 학생 이름을 저장할 표를 준비합니다."},
            {"id": "send-student", "label": "새 학생을 API에 등록", "code": "result = post_json('/students', {'name': '서준', 'score': 88})\n", "description": "POST 요청으로 새 자료를 보냅니다."},
            {"id": "get-student", "label": "API 응답에서 학생 꺼내기", "code": "student = result['student']\n", "description": "서비스가 새로 만든 번호가 포함된 응답을 받습니다."},
            {"id": "save-created", "label": "응답을 DB에 저장", "code": "connection.execute('INSERT OR REPLACE INTO created_students VALUES (?, ?, ?)', (student['id'], student['name'], student['score']))\n", "description": "API 응답의 값을 안전한 SQL 매개변수로 저장합니다."},
            {"id": "commit", "label": "DB 저장 확정", "code": "connection.commit()\n", "description": "DB에 변경 내용을 반영합니다."},
            {"id": "read-created", "label": "DB에서 등록 내용 읽기", "code": "saved_student = connection.execute('SELECT id, name FROM created_students WHERE id = ?', (student['id'],)).fetchone()\n", "description": "API 번호를 사용해 저장된 학생을 다시 조회합니다."},
            {"id": "show-created", "label": "결과 출력하고 DB 닫기", "code": "print(f'API 번호 {saved_student[0]}: {saved_student[1]}')\nconnection.close()", "description": "DB에서 읽은 번호와 이름을 보여줍니다."},
            {"id": "skip-save", "label": "결과만 바로 출력", "code": "print('API 번호 4: 서준')\n", "description": "API나 DB를 사용하지 않고 결과만 출력합니다."},
        ],
    },
}


def upgrade() -> None:
    lessons = sa.table("lessons", sa.column("id", sa.Uuid()), sa.column("course_id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("summary", sa.Text()), sa.column("learning_objective", sa.Text()), sa.column("content", sa.JSON()), sa.column("order_index", sa.Integer()), sa.column("is_published", sa.Boolean()))
    lesson_concepts = sa.table("lesson_concepts", sa.column("lesson_id", sa.Uuid()), sa.column("concept_id", sa.Uuid()))
    op.bulk_insert(lessons, [{"id": LESSON_ID, "course_id": COURSE_ID, "slug": "api-create-and-save", "title": "API에 등록하고 내 DB에도 보관하기", "summary": "API가 돌려준 새 번호를 프로젝트 DB에 저장하고 다시 읽습니다.", "learning_objective": "POST 응답의 생성된 ID를 이어 받아 다른 데이터 저장소에 기록하고 확인합니다.", "content": CONTENT, "order_index": 8, "is_published": True}])
    op.bulk_insert(lesson_concepts, [{"lesson_id": LESSON_ID, "concept_id": CONCEPT_ID}])


def downgrade() -> None:
    op.execute(f"DELETE FROM lesson_concepts WHERE lesson_id = '{LESSON_ID}'")
    op.execute(f"DELETE FROM lessons WHERE id = '{LESSON_ID}'")
