"""Teach reading, shaping, and syncing Google Sheets data."""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260929_0028"
down_revision: str | None = "20260928_0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000005")
CONCEPT_ID = UUID("45000000-0000-4000-8000-000000000001")
LESSONS = [
    {
        "id": UUID("45000000-0000-4000-8000-000000000005"),
        "slug": "sheets-read-range",
        "title": "Google Sheets 범위 읽기",
        "summary": "연결된 계정으로 지정한 셀 범위를 읽고 행 수를 확인합니다.",
        "objective": "연결 중개 경로를 통해 Sheets 값을 안전하게 읽고 행 목록으로 다룹니다.",
        "order": 4,
        "content": {
            "scenario": "Google Sheets 연결을 마쳤다면 프로젝트 코드에서 읽기 전용으로 데이터를 가져올 수 있습니다. 스프레드시트 ID와 셀 범위를 지정하고, 읽어온 값은 행 목록으로 사용할 수 있어요.",
            "steps": [
                {"label": "안전한 연결 도구", "value": "get_google_sheet", "description": "코드에는 Google 비밀번호나 토큰을 넣지 않습니다."},
                {"label": "시트 범위", "value": "'시트1'!A1:C4", "description": "가져올 셀 영역을 지정합니다."},
                {"label": "행 목록", "value": "sheet['values']", "description": "첫 행을 포함한 셀 값 목록을 받습니다."},
            ],
            "challenge": "연결 도구로 시트 범위를 읽고, 가져온 행 수를 출력하세요.",
            "prompts": [
                {"field": "input", "label": "가져올 스프레드시트", "placeholder": "스프레드시트 ID와 시트1!A1:C4 범위"},
                {"field": "process", "label": "연결 도구로 읽기", "placeholder": "get_google_sheet로 범위를 요청하고 values를 꺼내세요"},
                {"field": "output", "label": "가져온 행 수", "placeholder": "가져온 행: 4개"},
            ],
            "block_activity": {
                "instruction": "연결된 Google 계정으로 '시트1'의 A1:C4 범위를 읽고 가져온 행 수를 출력하세요. 코드의 YOUR_SPREADSHEET_ID를 본인 시트 ID로 바꾸면 실행할 수 있어요.",
                "expected_output": "가져온 행: 4개",
                "blocks": [
                    {"id": "show-row-count", "label": "행 수 출력", "code": "print(f'가져온 행: {len(rows)}개')", "description": "읽어온 행이 몇 개인지 보여줍니다."},
                    {"id": "read-range", "label": "셀 범위 읽기", "code": "sheet = get_google_sheet(spreadsheet_id, \"'시트1'!A1:C4\")\n", "description": "지정한 시트 범위의 값을 요청합니다."},
                    {"id": "import-sheets", "label": "Sheets 읽기 도구 가져오기", "code": "from weblink_api import get_google_sheet\n", "description": "WebLink의 승인된 연결 경로를 사용합니다."},
                    {"id": "count-rows", "label": "가져온 행 목록 꺼내기", "code": "rows = sheet['values']\n", "description": "응답에서 실제 셀 값이 든 행 목록을 꺼냅니다."},
                    {"id": "set-sheet-id", "label": "스프레드시트 ID 준비", "code": "spreadsheet_id = 'YOUR_SPREADSHEET_ID'\n", "description": "실행 전 본인 스프레드시트 ID로 바꿉니다."},
                    {"id": "skip-read", "label": "행 수를 고정 출력", "code": "print('가져온 행: 4개')\n", "description": "시트를 실제로 읽지 않으므로 과제에 맞지 않습니다."},
                    {"id": "get-values", "label": "응답에서 값 목록 꺼내기", "code": "rows = sheet['values']\n", "description": "시트 응답의 values 항목에는 행별 셀 값이 있습니다."},
                ],
            },
        },
    },
    {
        "id": UUID("45000000-0000-4000-8000-000000000006"),
        "slug": "sheets-map-rows",
        "title": "시트 행을 읽기 쉬운 데이터로 바꾸기",
        "summary": "첫 행을 열 이름으로 사용해 필요한 행만 골라냅니다.",
        "objective": "헤더와 행을 짝지어 레코드로 변환하고 조건에 맞는 데이터를 선택합니다.",
        "order": 5,
        "content": {
            "scenario": "시트의 값은 행과 열의 목록으로 도착합니다. 첫 행을 열 이름으로 보고 각 행과 짝지으면 이름이나 점수처럼 의미 있는 키로 데이터를 다룰 수 있어요.",
            "steps": [
                {"label": "열 이름", "value": "rows[0]", "description": "첫 행에 이름, 점수 같은 헤더가 들어 있습니다."},
                {"label": "레코드 만들기", "value": "dict(zip(headers, row))", "description": "열 이름과 셀 값을 연결합니다."},
                {"label": "조건으로 고르기", "value": "점수 >= 90", "description": "필요한 행만 다음 처리에 사용합니다."},
            ],
            "challenge": "헤더를 사용해 행을 레코드로 만들고, 점수가 90점 이상인 학생의 이름을 출력하세요.",
            "prompts": [
                {"field": "input", "label": "시트 데이터", "placeholder": "이름과 점수가 있는 행 목록"},
                {"field": "process", "label": "헤더와 행 연결하기", "placeholder": "첫 행을 헤더로 쓰고 점수 조건을 확인하세요"},
                {"field": "output", "label": "90점 이상 학생", "placeholder": "민지, 지우"},
            ],
            "block_activity": {
                "instruction": "첫 행을 헤더로 사용해 나머지 행을 레코드로 만들고, 점수가 90점 이상인 이름을 출력하세요.",
                "expected_output": "민지, 지우",
                "blocks": [
                    {"id": "map-records", "label": "헤더를 각 행에 연결", "code": "records = [dict(zip(headers, row)) for row in rows[1:] if len(row) == len(headers)]\n", "description": "행과 헤더 길이가 맞는 데이터만 이름 있는 레코드로 바꿉니다."},
                    {"id": "read-range", "label": "시트 범위 읽기", "code": "sheet = get_google_sheet('YOUR_SPREADSHEET_ID', \"'시트1'!A1:C4\")\n", "description": "연결 경로에서 시트 값을 읽어옵니다."},
                    {"id": "show-records", "label": "선택한 이름 출력", "code": "print(', '.join(record['이름'] for record in qualified))", "description": "조건에 맞는 학생 이름을 한 줄로 보여줍니다."},
                    {"id": "import-sheets", "label": "Sheets 읽기 도구 가져오기", "code": "from weblink_api import get_google_sheet\n", "description": "사용자 연결을 통해 시트를 읽는 함수를 준비합니다."},
                    {"id": "split-header", "label": "헤더 행 꺼내기", "code": "headers = rows[0]\n", "description": "첫 행을 각 열의 이름으로 사용합니다."},
                    {"id": "filter-records", "label": "90점 이상 고르기", "code": "qualified = [record for record in records if int(record['점수']) >= 90]\n", "description": "문자열로 읽힌 점수를 숫자로 바꿔 조건을 확인합니다."},
                    {"id": "get-values", "label": "행 목록 꺼내기", "code": "rows = sheet['values']\n", "description": "응답에서 행별 셀 값 목록을 읽습니다."},
                    {"id": "skip-filter", "label": "모든 이름 출력", "code": "print(', '.join(record['이름'] for record in records))\n", "description": "점수 조건을 적용하지 않아 과제와 다릅니다."},
                ],
            },
        },
    },
    {
        "id": UUID("45000000-0000-4000-8000-000000000007"),
        "slug": "sheets-sync-database",
        "title": "시트 데이터를 프로젝트 DB에 동기화하기",
        "summary": "읽은 시트 행을 프로젝트 SQLite에 반복 실행해도 중복 없이 저장합니다.",
        "objective": "헤더 기반 레코드를 영구 프로젝트 DB에 저장하고 기본 키로 중복을 방지합니다.",
        "order": 6,
        "content": {
            "scenario": "읽어온 데이터는 다음 실행에도 남겨야 할 때가 많습니다. 프로젝트 DB를 열고, 고유한 학생 이름을 기본 키로 사용해 다시 실행해도 중복 행이 생기지 않게 저장해 보세요.",
            "steps": [
                {"label": "영구 저장소", "value": "/data/students.db", "description": "프로젝트별 SQLite 파일은 실행이 끝나도 보존됩니다."},
                {"label": "고유 키", "value": "name PRIMARY KEY", "description": "같은 학생 데이터가 중복으로 쌓이지 않게 합니다."},
                {"label": "반복 동기화", "value": "INSERT OR REPLACE", "description": "같은 이름의 최신 점수로 기존 행을 갱신합니다."},
            ],
            "challenge": "시트의 학생 데이터를 프로젝트 DB에 저장하고, 동기화한 학생 수를 출력하세요.",
            "prompts": [
                {"field": "input", "label": "가져올 데이터", "placeholder": "헤더가 있는 Google Sheets 행 목록"},
                {"field": "process", "label": "영구 저장과 중복 방지", "placeholder": "기본 키와 INSERT OR REPLACE를 사용하세요"},
                {"field": "output", "label": "동기화 결과", "placeholder": "시트에서 동기화한 학생: 3명"},
            ],
            "block_activity": {
                "instruction": "시트의 이름·점수 데이터를 프로젝트 SQLite DB에 동기화하세요. 이름을 기본 키로 사용하고 실행 전에 YOUR_SPREADSHEET_ID를 바꾸세요.",
                "expected_output": "시트에서 동기화한 학생: 3명",
                "blocks": [
                    {"id": "sync-records", "label": "각 학생을 중복 없이 저장", "code": "for row in rows[1:]:\n    if len(row) == len(headers):\n        record = dict(zip(headers, row))\n        connection.execute('INSERT OR REPLACE INTO sheet_students VALUES (?, ?)', (record['이름'], int(record['점수'])))\n", "description": "헤더와 셀을 연결하고 이름을 키로 삼아 삽입하거나 갱신합니다."},
                    {"id": "open-db", "label": "프로젝트 DB 열기", "code": "connection = sqlite3.connect('/data/students.db')\n", "description": "프로젝트에 연결된 다음 실행에도 남는 DB를 엽니다."},
                    {"id": "import-sheets", "label": "Sheets 읽기 도구 가져오기", "code": "from weblink_api import get_google_sheet\n", "description": "연결된 시트에서 데이터를 가져올 도구를 준비합니다."},
                    {"id": "commit", "label": "DB 변경 저장", "code": "connection.commit()\n", "description": "현재 실행에서 만든 DB 변경을 확정합니다."},
                    {"id": "create-table", "label": "학생 표 준비", "code": "connection.execute('CREATE TABLE IF NOT EXISTS sheet_students (name TEXT PRIMARY KEY, score INTEGER)')\n", "description": "학생 이름을 고유 키로 갖는 표를 만듭니다."},
                    {"id": "show-count", "label": "동기화 결과 출력", "code": "print(f'시트에서 동기화한 학생: {count}명')\n", "description": "DB에 저장된 학생 수를 보여줍니다."},
                    {"id": "read-range", "label": "시트 범위 읽기", "code": "sheet = get_google_sheet('YOUR_SPREADSHEET_ID', \"'시트1'!A1:C4\")\n", "description": "계정에서 허용된 범위의 학생 데이터를 가져옵니다."},
                    {"id": "import-sqlite", "label": "SQLite 도구 가져오기", "code": "import sqlite3\n", "description": "프로젝트 DB를 사용할 Python 표준 라이브러리를 준비합니다."},
                    {"id": "split-header", "label": "헤더와 행 꺼내기", "code": "rows = sheet['values']\nheaders = rows[0]\n", "description": "응답의 셀 목록과 열 이름을 준비합니다."},
                    {"id": "count-records", "label": "DB에 저장된 수 세기", "code": "count = connection.execute('SELECT COUNT(*) FROM sheet_students').fetchone()[0]\n", "description": "동기화 후 표에 저장된 행 수를 확인합니다."},
                    {"id": "close-db", "label": "DB 연결 닫기", "code": "connection.close()", "description": "저장과 확인이 끝난 DB 연결을 닫습니다."},
                    {"id": "skip-primary-key", "label": "고유 키 없이 매번 추가", "code": "connection.execute('CREATE TABLE IF NOT EXISTS sheet_students (name TEXT, score INTEGER)')\n", "description": "기본 키가 없어 반복 실행할 때 중복 행을 막을 수 없습니다."},
                ],
            },
        },
    },
]


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
    op.bulk_insert(lessons, [
        {
            "id": item["id"],
            "course_id": COURSE_ID,
            "slug": item["slug"],
            "title": item["title"],
            "summary": item["summary"],
            "learning_objective": item["objective"],
            "content": item["content"],
            "order_index": item["order"],
            "is_published": True,
        }
        for item in LESSONS
    ])
    op.bulk_insert(lesson_concepts, [{"lesson_id": item["id"], "concept_id": CONCEPT_ID} for item in LESSONS])


def downgrade() -> None:
    lesson_ids = ", ".join(f"'{item['id']}'" for item in LESSONS)
    op.execute(f"DELETE FROM lesson_concepts WHERE lesson_id IN ({lesson_ids})")
    op.execute(f"DELETE FROM lessons WHERE id IN ({lesson_ids})")
