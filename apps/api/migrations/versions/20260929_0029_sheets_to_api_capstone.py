"""Add an end-to-end Sheets to API and project database capstone."""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260929_0029"
down_revision: str | None = "20260929_0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000005")
LESSON_ID = UUID("45000000-0000-4000-8000-000000000008")
CONCEPT_ID = UUID("45000000-0000-4000-8000-000000000001")
CONTENT = {
    "scenario": "여러 서비스를 연결하는 실제 흐름을 완성해 봅니다. 시트에서 점수가 높은 학생만 골라 API에 보내고, API가 만든 ID를 프로젝트 DB에 기록합니다. 응답 ID를 저장하면 외부 서비스의 결과와 내 데이터베이스를 나중에 다시 연결할 수 있어요.",
    "steps": [
        {"label": "원본 읽기", "value": "Google Sheets", "description": "연결된 계정의 승인 범위에서 학생 행을 읽습니다."},
        {"label": "필요한 자료만 전송", "value": "score >= 90", "description": "조건에 맞는 학생만 학습용 API로 보냅니다."},
        {"label": "응답과 연결 정보 보관", "value": "API ID → SQLite", "description": "API가 돌려준 고유 ID와 학생 데이터를 프로젝트 DB에 저장합니다."},
    ],
    "challenge": "시트에서 90점 이상 학생을 골라 API에 전송하고, 응답 ID·이름·점수를 프로젝트 DB에 저장한 뒤 개수를 출력하세요.",
    "prompts": [
        {"field": "input", "label": "원본과 목적지", "placeholder": "Google Sheets에서 읽어 API로 전송"},
        {"field": "process", "label": "선택·전송·저장 흐름", "placeholder": "90점 이상만 보내고 API 응답 ID를 프로젝트 DB에 기록"},
        {"field": "output", "label": "완료한 전송", "placeholder": "전송하고 기록한 학생: 2명"},
    ],
    "block_activity": {
        "instruction": "시트에서 90점 이상인 학생만 API에 보내고, 응답으로 받은 ID를 프로젝트 DB에 저장하세요. YOUR_SPREADSHEET_ID를 본인 시트 ID로 바꿔 실행할 수 있어요.",
        "expected_output": "전송하고 기록한 학생: 2명",
        "blocks": [
            {"id": "send-selected", "label": "조건을 통과한 학생 전송 후 응답 저장", "code": "for record in records:\n    score = int(record['점수'])\n    if score >= 90:\n        result = post_json('/students', {'name': record['이름'], 'score': score})\n        student = result['student']\n        connection.execute('INSERT OR REPLACE INTO published_students VALUES (?, ?, ?)', (student['id'], student['name'], student['score']))\n", "description": "조건을 만족하는 행만 전송하고 API 응답의 ID를 DB 기본 키로 저장합니다."},
            {"id": "imports", "label": "DB와 연결 도구 가져오기", "code": "import sqlite3\nfrom weblink_api import get_google_sheet, post_json\n", "description": "프로젝트 DB, 승인된 시트 읽기, API 전송 도구를 준비합니다."},
            {"id": "open-db", "label": "프로젝트 DB 열기", "code": "connection = sqlite3.connect('/data/students.db')\n", "description": "프로젝트별로 유지되는 SQLite 저장소를 엽니다."},
            {"id": "read-range", "label": "시트 범위 읽기", "code": "sheet = get_google_sheet('YOUR_SPREADSHEET_ID', \"'시트1'!A1:C4\")\n", "description": "승인된 Google 연결을 거쳐 지정한 셀 범위를 가져옵니다."},
            {"id": "create-table", "label": "API 전송 결과 표 준비", "code": "connection.execute('CREATE TABLE IF NOT EXISTS published_students (api_id INTEGER PRIMARY KEY, name TEXT, score INTEGER)')\n", "description": "API ID를 기본 키로 하여 전송 결과를 기록할 표를 준비합니다."},
            {"id": "split-header", "label": "시트 행과 헤더 꺼내기", "code": "rows = sheet['values']\nheaders = rows[0]\n", "description": "첫 행을 열 이름으로 삼고 나머지 행과 연결할 준비를 합니다."},
            {"id": "map-records", "label": "시트 행을 이름 있는 레코드로 바꾸기", "code": "records = [dict(zip(headers, row)) for row in rows[1:] if len(row) == len(headers)]\n", "description": "헤더와 셀 값을 짝지어 이름·점수를 키로 조회할 수 있게 합니다."},
            {"id": "commit", "label": "프로젝트 DB 저장", "code": "connection.commit()\n", "description": "API에서 받은 ID와 학생 데이터를 프로젝트 DB에 확정합니다."},
            {"id": "count-results", "label": "기록된 전송 결과 세기", "code": "count = connection.execute('SELECT COUNT(*) FROM published_students').fetchone()[0]\n", "description": "DB에 남아 있는 API 전송 결과 수를 확인합니다."},
            {"id": "show-results", "label": "전송 완료 수 출력", "code": "print(f'전송하고 기록한 학생: {count}명')\n", "description": "전송하고 저장한 학생 수를 보여줍니다."},
            {"id": "close-db", "label": "프로젝트 DB 닫기", "code": "connection.close()", "description": "작업이 끝난 DB 연결을 닫습니다."},
            {"id": "send-everyone", "label": "점수와 상관없이 모두 전송", "code": "for record in records:\n    post_json('/students', {'name': record['이름'], 'score': int(record['점수'])})\n", "description": "요구된 점수 조건을 적용하지 않고 모든 행을 전송합니다."},
        ],
    },
}


def upgrade() -> None:
    lessons = sa.table(
        "lessons",
        sa.column("id", sa.Uuid()),
        sa.column("course_id", sa.Uuid()),
        sa.column("slug", sa.String()),
        sa.column("title", sa.String()),
        sa.column("summary", sa.Text()),
        sa.column("learning_objective", sa.Text()),
        sa.column("content", sa.JSON()),
        sa.column("order_index", sa.Integer()),
        sa.column("is_published", sa.Boolean()),
    )
    lesson_concepts = sa.table("lesson_concepts", sa.column("lesson_id", sa.Uuid()), sa.column("concept_id", sa.Uuid()))
    op.bulk_insert(lessons, [{
        "id": LESSON_ID,
        "course_id": COURSE_ID,
        "slug": "sheets-to-api",
        "title": "시트 데이터를 API로 보내고 DB에 기록하기",
        "summary": "조건에 맞는 행만 API에 보내고 응답 ID를 프로젝트 DB에 보관합니다.",
        "learning_objective": "Google Sheets, API, 프로젝트 데이터베이스를 연결하는 전체 흐름을 구현합니다.",
        "content": CONTENT,
        "order_index": 7,
        "is_published": True,
    }])
    op.bulk_insert(lesson_concepts, [{"lesson_id": LESSON_ID, "concept_id": CONCEPT_ID}])


def downgrade() -> None:
    op.execute(f"DELETE FROM lesson_concepts WHERE lesson_id = '{LESSON_ID}'")
    op.execute(f"DELETE FROM lessons WHERE id = '{LESSON_ID}'")
