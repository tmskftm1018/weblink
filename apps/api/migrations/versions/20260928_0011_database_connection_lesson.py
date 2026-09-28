"""Add a hands-on, isolated SQLite integration lesson.

Revision ID: 20260928_0011
Revises: 20260928_0010
Create Date: 2026-09-28
"""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0011"
down_revision: str | None = "20260928_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000003")
LESSON_ID = UUID("43000000-0000-4000-8000-000000000001")
CONCEPT_ID = UUID("43000000-0000-4000-8000-000000000002")
CONTENT = {
    "scenario": "코드가 데이터베이스에 연결해 정보를 저장하고, 다시 찾아 화면에 보여주는 흐름을 직접 만들어 봅니다. SQLite는 파이썬에 포함된 실제 데이터베이스이며, 이 실습의 데이터는 실행이 끝나면 정리되는 임시 공간에 저장됩니다.",
    "steps": [
        {"label": "연결", "value": "sqlite3.connect(':memory:')", "description": "파이썬 프로그램에서 임시 SQLite 데이터베이스를 엽니다."},
        {"label": "저장", "value": "CREATE TABLE · INSERT", "description": "테이블을 만들고 학생의 이름과 점수를 데이터베이스에 씁니다."},
        {"label": "조회", "value": "SELECT · fetchone()", "description": "저장한 행을 다시 읽어 프로그램으로 가져옵니다."},
    ],
    "challenge": "민지의 점수 95를 데이터베이스에 저장한 뒤 다시 읽어 화면에 보여주는 흐름을 조립해 보세요.",
    "prompts": [
        {"field": "input", "label": "데이터베이스 연결과 저장 흐름", "placeholder": "블록으로 연결하세요"},
        {"field": "process", "label": "실행할 코드", "placeholder": "블록으로 코드를 조립하세요"},
        {"field": "output", "label": "화면에 나타날 결과", "placeholder": "예: 민지: 95"},
    ],
    "block_activity": {
        "instruction": "DB 연결 → 테이블 생성 → 데이터 저장 → 다시 읽기 → 출력 순서로 블록을 쌓으세요.",
        "expected_output": "민지: 95",
        "blocks": [
            {"id": "import-sqlite", "label": "SQLite 도구 가져오기", "code": "import sqlite3\n", "description": "파이썬 표준 라이브러리의 SQLite 기능을 가져옵니다."},
            {"id": "connect-sqlite", "label": "데이터베이스 연결", "code": "connection = sqlite3.connect(':memory:')\n", "description": "실행 중 사용할 임시 데이터베이스에 연결합니다."},
            {"id": "create-table", "label": "학생 테이블 만들기", "code": "connection.execute('CREATE TABLE students (name TEXT, score INTEGER)')\n", "description": "이름과 점수를 저장할 표를 만듭니다."},
            {"id": "insert-row", "label": "학생 데이터 저장", "code": "connection.execute(\"INSERT INTO students VALUES ('민지', 95)\")\n", "description": "민지의 점수 95를 데이터베이스에 기록합니다."},
            {"id": "select-row", "label": "저장한 데이터 읽기", "code": "student = connection.execute('SELECT name, score FROM students').fetchone()\n", "description": "SQL 조회 결과 중 첫 행을 가져옵니다."},
            {"id": "display-row", "label": "조회 결과 출력", "code": "print(f'{student[0]}: {student[1]}')", "description": "데이터베이스에서 읽어온 값으로 결과를 보여줍니다."},
            {"id": "skip-database", "label": "결과만 바로 출력", "code": "print('민지: 95')\n", "description": "데이터베이스를 사용하지 않고 문장만 출력합니다."},
        ],
    },
}


def upgrade() -> None:
    courses = sa.table("courses", sa.column("id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("description", sa.Text()), sa.column("order_index", sa.Integer()))
    concepts = sa.table("concepts", sa.column("id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("name", sa.String()), sa.column("description", sa.Text()))
    lessons = sa.table("lessons", sa.column("id", sa.Uuid()), sa.column("course_id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("summary", sa.Text()), sa.column("learning_objective", sa.Text()), sa.column("content", sa.JSON()), sa.column("order_index", sa.Integer()), sa.column("is_published", sa.Boolean()))
    lesson_concepts = sa.table("lesson_concepts", sa.column("lesson_id", sa.Uuid()), sa.column("concept_id", sa.Uuid()))
    op.bulk_insert(courses, [{"id": COURSE_ID, "slug": "project-data-connections", "title": "프로젝트와 데이터 연결하기", "description": "블록으로 코드를 만든 뒤 실제 데이터베이스에 연결하고 저장한 값을 다시 읽어 프로젝트로 가져옵니다.", "order_index": 3}])
    op.bulk_insert(concepts, [{"id": CONCEPT_ID, "slug": "database", "name": "데이터베이스 연결", "description": "프로그램이 데이터베이스에 연결해 데이터를 저장하고 조회하는 방식입니다."}])
    op.bulk_insert(lessons, [{"id": LESSON_ID, "course_id": COURSE_ID, "slug": "sqlite-database", "title": "코드를 데이터베이스에 연결하기", "summary": "SQLite에 실제 데이터를 저장하고 다시 조회하는 앱의 연결 흐름을 조립합니다.", "learning_objective": "프로그램에서 데이터베이스 연결, 저장, 조회가 이어지는 과정을 설명하고 실행합니다.", "content": CONTENT, "order_index": 1, "is_published": True}])
    op.bulk_insert(lesson_concepts, [{"lesson_id": LESSON_ID, "concept_id": CONCEPT_ID}])


def downgrade() -> None:
    op.execute(f"DELETE FROM lesson_concepts WHERE lesson_id = '{LESSON_ID}'")
    op.execute(f"DELETE FROM lessons WHERE id = '{LESSON_ID}'")
    op.execute(f"DELETE FROM concepts WHERE id = '{CONCEPT_ID}'")
    op.execute(f"DELETE FROM courses WHERE id = '{COURSE_ID}'")
