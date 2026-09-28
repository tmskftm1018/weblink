"""Teach synchronizing API and project database deletions."""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0024"
down_revision: str | None = "20260928_0023"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000004")
LESSON_ID = UUID("44000000-0000-4000-8000-000000000012")
CONCEPT_ID = UUID("44000000-0000-4000-8000-000000000002")
CONTENT = {
    "scenario": "학생 자료를 내 프로젝트 DB에 가져온 뒤 API에서 삭제할 때, DB에도 삭제를 반영해야 두 곳의 목록이 어긋나지 않습니다.",
    "steps": [
        {"label": "API 목록 동기화", "value": "GET · SQLite", "description": "현재 학생 목록을 프로젝트 DB에 저장합니다."},
        {"label": "서비스에서 삭제", "value": "DELETE /students/3", "description": "학생 번호 3을 API에서 삭제합니다."},
        {"label": "내 DB에서도 삭제", "value": "DELETE · COUNT", "description": "같은 번호를 지우고 양쪽의 남은 수를 확인합니다."},
    ],
    "challenge": "학생 목록을 프로젝트 DB에 동기화하고 3번 학생을 API와 DB에서 삭제한 뒤 남은 수를 비교하세요.",
    "prompts": [
        {"field": "input", "label": "삭제할 학생 번호", "placeholder": "3"},
        {"field": "process", "label": "API와 DB 삭제 순서", "placeholder": "동기화한 뒤 양쪽에서 같은 번호를 삭제하세요"},
        {"field": "output", "label": "양쪽에 남은 학생 수", "placeholder": "API/DB 남은 학생: 2/2"},
    ],
    "block_activity": {
        "instruction": "API 목록을 프로젝트 DB에 동기화하고 3번 학생을 양쪽에서 삭제한 다음 각각 남은 학생 수를 출력하세요.",
        "expected_output": "API/DB 남은 학생: 2/2",
        "blocks": [
            {"id": "delete-local", "label": "DB에서 3번 학생 삭제", "code": "connection.execute('DELETE FROM imported_students WHERE id = ?', (3,))\n", "description": "같은 번호를 프로젝트 DB에서도 제거합니다."},
            {"id": "open-db", "label": "프로젝트 DB 열기", "code": "connection = sqlite3.connect('/data/students.db')\n", "description": "동기화한 목록을 보관할 DB를 엽니다."},
            {"id": "show-counts", "label": "양쪽 남은 수 출력", "code": "print(f'API/DB 남은 학생: {api_count}/{db_count}')\nconnection.close()", "description": "API와 DB의 학생 수를 비교합니다."},
            {"id": "import-sqlite", "label": "SQLite 도구 가져오기", "code": "import sqlite3\n", "description": "프로젝트 DB를 다룰 도구를 준비합니다."},
            {"id": "request-list", "label": "API 학생 목록 요청", "code": "response = get_json('/students')\n", "description": "현재 서비스에 있는 학생들을 요청합니다."},
            {"id": "commit-delete", "label": "DB 삭제 확정", "code": "connection.commit()\n", "description": "삭제 변경을 프로젝트 DB에 반영합니다."},
            {"id": "create-table", "label": "동기화 표 준비", "code": "connection.execute('CREATE TABLE IF NOT EXISTS imported_students (id INTEGER PRIMARY KEY, name TEXT, score INTEGER)')\n", "description": "학생 번호, 이름, 점수를 보관할 표를 준비합니다."},
            {"id": "count-api", "label": "API 남은 수 세기", "code": "api_count = len(get_json('/students')['students'])\n", "description": "삭제 후 API가 돌려주는 학생 수를 셉니다."},
            {"id": "import-api-tools", "label": "GET·DELETE 도구 가져오기", "code": "from weblink_api import delete_json, get_json\n", "description": "목록을 읽고 서비스 자료를 삭제할 함수를 가져옵니다."},
            {"id": "delete-remote", "label": "API에서 3번 학생 삭제", "code": "delete_json('/students/3')\n", "description": "DELETE 요청으로 서비스의 학생을 제거합니다."},
            {"id": "import-all", "label": "학생 목록을 DB에 저장", "code": "for student in response['students']:\n    connection.execute('INSERT OR REPLACE INTO imported_students VALUES (?, ?, ?)', (student['id'], student['name'], student['score']))\n", "description": "API 응답의 모든 학생을 프로젝트 DB에 동기화합니다."},
            {"id": "count-db", "label": "DB 남은 수 세기", "code": "db_count = connection.execute('SELECT COUNT(*) FROM imported_students').fetchone()[0]\n", "description": "프로젝트 DB에 남은 학생 수를 셉니다."},
            {"id": "commit-import", "label": "초기 동기화 확정", "code": "connection.commit()\n", "description": "API 목록을 DB에 먼저 저장합니다."},
            {"id": "skip-sync", "label": "결과만 출력", "code": "print('API/DB 남은 학생: 2/2')\n", "description": "동기화와 삭제 없이 결과만 출력합니다."},
            {"id": "delete-local-decoy", "label": "학생 이름으로 삭제", "code": "connection.execute(\"DELETE FROM imported_students WHERE name = '민지'\")\n", "description": "요청한 번호가 아닌 이름으로 DB를 삭제합니다."},
        ],
    },
}


def upgrade() -> None:
    lessons = sa.table("lessons", sa.column("id", sa.Uuid()), sa.column("course_id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("summary", sa.Text()), sa.column("learning_objective", sa.Text()), sa.column("content", sa.JSON()), sa.column("order_index", sa.Integer()), sa.column("is_published", sa.Boolean()))
    lesson_concepts = sa.table("lesson_concepts", sa.column("lesson_id", sa.Uuid()), sa.column("concept_id", sa.Uuid()))
    op.bulk_insert(lessons, [{"id": LESSON_ID, "course_id": COURSE_ID, "slug": "api-delete-sync", "title": "API와 내 DB의 삭제 내용 맞추기", "summary": "같은 자료를 두 저장소에서 삭제하고 남은 수를 비교합니다.", "learning_objective": "API DELETE와 SQL DELETE를 연결해 여러 저장소의 자료를 동기화합니다.", "content": CONTENT, "order_index": 11, "is_published": True}])
    op.bulk_insert(lesson_concepts, [{"lesson_id": LESSON_ID, "concept_id": CONCEPT_ID}])


def downgrade() -> None:
    op.execute(f"DELETE FROM lesson_concepts WHERE lesson_id = '{LESSON_ID}'")
    op.execute(f"DELETE FROM lessons WHERE id = '{LESSON_ID}'")
