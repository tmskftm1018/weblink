"""Add a project-scoped persistent SQLite lesson.

Revision ID: 20260928_0012
Revises: 20260928_0011
Create Date: 2026-09-28
"""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0012"
down_revision: str | None = "20260928_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000003")
LESSON_ID = UUID("43000000-0000-4000-8000-000000000003")
CONCEPT_ID = UUID("43000000-0000-4000-8000-000000000004")
CONTENT = {
    "scenario": "앞선 실습의 임시 DB는 실행이 끝나면 사라졌습니다. 이번에는 내 프로젝트 전용 저장 공간에 SQLite 파일을 만들고, 프로그램을 다시 실행해도 데이터가 남는 흐름을 블록으로 조립합니다.",
    "steps": [
        {"label": "프로젝트 저장 공간", "value": "/data/students.db", "description": "각 프로젝트에 따로 연결된 저장 공간에 DB 파일을 둡니다."},
        {"label": "중복 방지 저장", "value": "INSERT OR IGNORE", "description": "프로그램을 여러 번 실행해도 같은 학생 행을 중복 추가하지 않습니다."},
        {"label": "다시 실행", "value": "SELECT", "description": "같은 프로젝트에서 다시 실행해도 저장된 학생 정보를 읽습니다."},
    ],
    "challenge": "블록을 조립해 민지의 점수 95를 내 프로젝트 DB에 한 번 저장하고 조회하세요. 완료 후 내 프로젝트에서 이어 만들기를 눌러 코드를 실행하고, 다시 실행해도 값이 남는지 확인해 보세요.",
    "prompts": [
        {"field": "input", "label": "블록으로 만든 DB 처리 순서", "placeholder": "블록으로 연결하세요"},
        {"field": "process", "label": "실행할 코드", "placeholder": "블록으로 코드를 조립하세요"},
        {"field": "output", "label": "조회 결과", "placeholder": "예: 민지: 95"},
    ],
    "block_activity": {
        "instruction": "SQLite 가져오기 → 프로젝트 DB 열기 → 표 준비 → 한 번만 저장 → 조회 → 출력 순서로 쌓으세요.",
        "expected_output": "민지: 95",
        "blocks": [
            {"id": "import-sqlite", "label": "SQLite 도구 가져오기", "code": "import sqlite3\n", "description": "파이썬의 SQLite 기능을 가져옵니다."},
            {"id": "open-project-db", "label": "내 프로젝트 DB 열기", "code": "connection = sqlite3.connect('/data/students.db')\n", "description": "프로젝트마다 분리된 DB 파일을 엽니다."},
            {"id": "create-table", "label": "학생 표 준비", "code": "connection.execute('CREATE TABLE IF NOT EXISTS students (name TEXT PRIMARY KEY, score INTEGER)')\n", "description": "표가 없을 때만 만들어 여러 번 실행할 수 있게 합니다."},
            {"id": "insert-once", "label": "학생 정보를 한 번 저장", "code": "connection.execute(\"INSERT OR IGNORE INTO students VALUES ('민지', 95)\")\n", "description": "이미 저장한 이름이면 중복 행을 추가하지 않습니다."},
            {"id": "select-student", "label": "저장된 정보 조회", "code": "student = connection.execute(\"SELECT name, score FROM students WHERE name = '민지'\").fetchone()\n", "description": "프로젝트 DB에서 민지의 정보를 다시 읽습니다."},
            {"id": "display-student", "label": "조회 결과 출력", "code": "print(f'{student[0]}: {student[1]}')\nconnection.close()", "description": "읽은 값을 화면에 보여주고 연결을 닫습니다."},
            {"id": "skip-database", "label": "결과만 바로 출력", "code": "print('민지: 95')\n", "description": "DB를 거치지 않고 결과만 표시합니다."},
        ],
    },
}


def upgrade() -> None:
    concepts = sa.table("concepts", sa.column("id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("name", sa.String()), sa.column("description", sa.Text()))
    lessons = sa.table("lessons", sa.column("id", sa.Uuid()), sa.column("course_id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("summary", sa.Text()), sa.column("learning_objective", sa.Text()), sa.column("content", sa.JSON()), sa.column("order_index", sa.Integer()), sa.column("is_published", sa.Boolean()))
    lesson_concepts = sa.table("lesson_concepts", sa.column("lesson_id", sa.Uuid()), sa.column("concept_id", sa.Uuid()))
    op.bulk_insert(concepts, [{"id": CONCEPT_ID, "slug": "persistent-database", "name": "프로젝트별 데이터 저장", "description": "프로젝트마다 분리된 저장소에 데이터를 보관해 다음 실행에서도 다시 읽습니다."}])
    op.bulk_insert(lessons, [{"id": LESSON_ID, "course_id": COURSE_ID, "slug": "persistent-sqlite", "title": "실행 후에도 데이터 남기기", "summary": "내 프로젝트의 SQLite DB에 데이터를 저장하고 다음 실행에서 다시 읽습니다.", "learning_objective": "프로젝트별 DB 연결을 사용해 데이터를 보존하고, 반복 실행에도 안전하게 저장·조회합니다.", "content": CONTENT, "order_index": 2, "is_published": True}])
    op.bulk_insert(lesson_concepts, [{"lesson_id": LESSON_ID, "concept_id": CONCEPT_ID}])


def downgrade() -> None:
    op.execute(f"DELETE FROM lesson_concepts WHERE lesson_id = '{LESSON_ID}'")
    op.execute(f"DELETE FROM lessons WHERE id = '{LESSON_ID}'")
    op.execute(f"DELETE FROM concepts WHERE id = '{CONCEPT_ID}'")
