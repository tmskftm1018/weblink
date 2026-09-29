"""Add practical Sheets sync configuration, auditing, and verification lessons."""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260929_0031"
down_revision: str | None = "20260929_0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000005")
CONCEPT_ID = UUID("45000000-0000-4000-8000-000000000001")


def activity(instruction: str, expected_output: str, blocks: list[dict[str, str]]) -> dict:
    return {"instruction": instruction, "expected_output": expected_output, "blocks": blocks}


LESSONS = [
    {
        "id": UUID("45000000-0000-4000-8000-00000000000c"),
        "slug": "sheets-config-separation",
        "title": "연결 설정과 비밀값 분리하기",
        "summary": "시트 ID와 범위를 한곳에 두고 OAuth 비밀값은 코드에서 제외합니다.",
        "objective": "변경 가능한 연동 설정을 분리하고 자격 증명을 소스 코드에 저장하지 않습니다.",
        "order": 11,
        "scenario": "시트 주소나 범위가 바뀔 때마다 처리 코드를 찾아 고치면 실수가 생깁니다. 공개해도 되는 식별 정보는 설정값으로 모으고, OAuth 클라이언트 비밀값과 토큰은 프로젝트 소스에 넣지 않습니다.",
        "challenge": "시트 ID와 범위를 별도 설정으로 정하고 해당 값으로 데이터를 읽은 뒤, 비밀값을 코드에 넣지 않는다는 점을 출력하세요.",
        "expected": "읽은 범위: 시트1!A1:C4\nOAuth 비밀값은 코드에 넣지 않습니다.",
        "blocks": [
            {"id": "settings", "label": "시트 ID와 범위 설정", "code": "SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID'\nSHEET_RANGE = \"'시트1'!A1:C4\"\n", "description": "자주 바뀌는 시트 식별 정보와 셀 범위를 상수로 모읍니다."},
            {"id": "import-reader", "label": "승인된 시트 읽기 도구 가져오기", "code": "from weblink_api import get_google_sheet\n", "description": "서버에 안전하게 보관된 연결을 통해 시트를 읽습니다."},
            {"id": "read-configured-range", "label": "설정값으로 시트 읽기", "code": "sheet = get_google_sheet(SPREADSHEET_ID, SHEET_RANGE)\n", "description": "코드 곳곳에 반복해서 적지 않고 설정값을 전달합니다."},
            {"id": "show-range", "label": "읽은 범위 확인", "code": "print(f\"읽은 범위: {sheet['range']}\")\n", "description": "실제로 요청한 범위가 맞는지 실행 결과에서 확인합니다."},
            {"id": "no-secret", "label": "비밀값을 제외한다는 점 알리기", "code": "print('OAuth 비밀값은 코드에 넣지 않습니다.')", "description": "OAuth 비밀값은 서버 환경 설정에 보관하고 실행 코드에 전달하지 않습니다."},
            {"id": "hardcode-secret", "label": "OAuth 비밀값을 코드에 기록", "code": "GOOGLE_CLIENT_SECRET = 'paste-secret-here'\n", "description": "비밀값은 소스나 Git 이력에 기록하면 안 됩니다."},
        ],
    },
    {
        "id": UUID("45000000-0000-4000-8000-00000000000d"),
        "slug": "sheets-sync-summary",
        "title": "반복 실행 결과를 구분해 기록하기",
        "summary": "새로 저장한 행과 기존 행 갱신을 따로 세어 재실행 결과를 확인합니다.",
        "objective": "기존 행을 확인하고 삽입과 갱신 결과를 구분해 데이터 동기화 상태를 설명합니다.",
        "order": 12,
        "scenario": "동기화 코드는 한 번만 실행되지 않습니다. 이름을 고유 키로 사용하면 재실행할 때 중복 행을 만들지 않고, 기존 이름은 갱신하고 새 이름은 추가할 수 있습니다. 두 결과를 구분하면 문제가 생겼을 때 원인을 찾기 쉽습니다.",
        "challenge": "시트 행을 검증하고, 이름이 이미 DB에 있으면 갱신으로, 없으면 새 저장으로 세어 결과를 출력하세요.",
        "expected": "새로 저장: 3명 · 갱신: 0명",
        "blocks": [
            {"id": "import-tools", "label": "SQLite와 Sheets 도구 가져오기", "code": "import sqlite3\nfrom weblink_api import get_google_sheet\n", "description": "영구 프로젝트 DB와 승인된 시트 읽기를 준비합니다."},
            {"id": "open-db", "label": "프로젝트 데이터베이스 열기", "code": "connection = sqlite3.connect('/data/students.db')\n", "description": "실행이 끝난 뒤에도 데이터를 보관하는 DB를 엽니다."},
            {"id": "create-table", "label": "이름을 고유 키로 표 준비", "code": "connection.execute('CREATE TABLE IF NOT EXISTS sheet_students (name TEXT PRIMARY KEY, score INTEGER)')\n", "description": "같은 이름을 다시 저장해도 중복 행이 생기지 않도록 합니다."},
            {"id": "read-sheet", "label": "시트 범위 읽기", "code": "sheet = get_google_sheet('YOUR_SPREADSHEET_ID', \"'시트1'!A1:C4\")\n", "description": "현재 동기화할 값을 승인된 시트에서 읽습니다."},
            {"id": "prepare-records", "label": "헤더로 행을 만들고 값 검증", "code": "rows = sheet['values']\nheaders = rows[0]\nrecords = [dict(zip(headers, row)) for row in rows[1:] if len(row) == len(headers)]\nstudents = [record for record in records if str(record.get('이름', '')).strip() and str(record.get('점수', '')).isdigit()]\n", "description": "열 개수와 필수 값, 점수 형식을 확인합니다."},
            {"id": "initialize-counts", "label": "새 저장과 갱신 수 초기화", "code": "inserted = updated = 0\n", "description": "두 처리 결과를 따로 셀 변수를 준비합니다."},
            {"id": "sync-counted", "label": "기존 행을 확인하고 저장 결과 구분", "code": "for student in students:\n    exists = connection.execute('SELECT 1 FROM sheet_students WHERE name = ?', (student['이름'],)).fetchone()\n    connection.execute('INSERT OR REPLACE INTO sheet_students VALUES (?, ?)', (student['이름'], int(student['점수'])))\n    if exists:\n        updated += 1\n    else:\n        inserted += 1\n", "description": "고유 이름이 이미 있으면 갱신으로, 처음이면 새 저장으로 셉니다."},
            {"id": "commit", "label": "DB 변경 확정", "code": "connection.commit()\n", "description": "모든 행 처리가 끝난 뒤 변경을 저장합니다."},
            {"id": "show-summary", "label": "새 저장과 갱신 수 출력", "code": "print(f'새로 저장: {inserted}명 · 갱신: {updated}명')\n", "description": "동기화가 어떤 작업을 했는지 요약합니다."},
            {"id": "close-db", "label": "DB 연결 닫기", "code": "connection.close()", "description": "처리가 끝나면 DB 연결을 닫습니다."},
            {"id": "skip-existing-check", "label": "기존 행 확인 없이 매번 추가", "code": "connection.execute('INSERT INTO sheet_students VALUES (?, ?)', (student['이름'], int(student['점수'])))\n", "description": "반복 실행할 때 중복 또는 기본 키 오류가 생길 수 있습니다."},
        ],
    },
    {
        "id": UUID("45000000-0000-4000-8000-00000000000e"),
        "slug": "sheets-verify-sync",
        "title": "동기화 뒤 DB 결과 검증하기",
        "summary": "저장된 행 수와 이름 목록을 조회해 가져온 결과를 확인합니다.",
        "objective": "쓰기 작업 뒤 DB를 다시 조회해 저장 결과를 확인하고 사람이 이해할 수 있게 요약합니다.",
        "order": 13,
        "scenario": "저장 명령이 오류 없이 끝났다는 사실만으로 기대한 데이터가 들어갔다고 단정할 수 없습니다. DB를 다시 읽어 행 수와 주요 값을 확인하면 빈 저장이나 잘못된 대상 표를 빨리 찾을 수 있습니다.",
        "challenge": "프로젝트 DB에서 저장된 학생 수와 이름을 조회하고 읽기 쉬운 완료 문구를 출력하세요.",
        "expected": "저장 확인: 3명 · 민지, 서준, 지우",
        "blocks": [
            {"id": "import-sqlite", "label": "SQLite 가져오기", "code": "import sqlite3\n", "description": "프로젝트 데이터베이스를 읽을 도구를 준비합니다."},
            {"id": "open-db", "label": "프로젝트 데이터베이스 열기", "code": "connection = sqlite3.connect('/data/students.db')\n", "description": "영구 프로젝트 저장소를 조회합니다."},
            {"id": "count-rows", "label": "DB 행 수 세기", "code": "count = connection.execute('SELECT COUNT(*) FROM sheet_students').fetchone()[0]\n", "description": "동기화된 레코드가 실제로 몇 개인지 확인합니다."},
            {"id": "read-rows", "label": "이름을 정렬해 다시 읽기", "code": "names = [row[0] for row in connection.execute('SELECT name FROM sheet_students ORDER BY name').fetchall()]\n", "description": "저장된 주요 데이터를 다시 조회해 눈으로 확인할 준비를 합니다."},
            {"id": "show-check", "label": "행 수와 이름을 함께 출력", "code": "print('저장 확인:', count, '명 ·', ', '.join(names))\n", "description": "저장 결과를 확인하기 쉬운 한 줄로 보여줍니다."},
            {"id": "close-db", "label": "DB 연결 닫기", "code": "connection.close()", "description": "확인이 끝난 뒤 DB 연결을 닫습니다."},
            {"id": "assume-success", "label": "조회 없이 성공 문구만 출력", "code": "print('저장 완료')\n", "description": "실제 DB 값과 일치하는지 확인할 수 없습니다."},
        ],
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
            "content": {
                "scenario": item["scenario"],
                "steps": [{"label": "설정 준비", "value": "분리", "description": "데이터 흐름과 설정값을 구분합니다."}, {"label": "안전하게 처리", "value": "검증", "description": "필요한 데이터를 안전하게 처리합니다."}, {"label": "결과 확인", "value": "DB 조회", "description": "저장 결과를 다시 읽어 확인합니다."}],
                "challenge": item["challenge"],
                "prompts": [
                    {"field": "input", "label": "연결할 데이터", "placeholder": "승인된 시트와 기존 프로젝트 DB"},
                    {"field": "process", "label": "안전한 처리와 확인", "placeholder": "설정 분리, 검증, 조회를 포함하세요"},
                    {"field": "output", "label": "확인 가능한 결과", "placeholder": item["expected"]},
                ],
                "block_activity": activity(
                    item["challenge"],
                    item["expected"],
                    item["blocks"],
                ),
            },
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
