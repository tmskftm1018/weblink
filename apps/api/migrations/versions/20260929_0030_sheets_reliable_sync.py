"""Teach validation, transactional writes, and safe full snapshot syncs."""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260929_0030"
down_revision: str | None = "20260929_0029"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000005")
CONCEPT_ID = UUID("45000000-0000-4000-8000-000000000001")


def activity(instruction: str, expected_output: str, blocks: list[dict[str, str]]) -> dict:
    return {"instruction": instruction, "expected_output": expected_output, "blocks": blocks}


LESSONS = [
    {
        "id": UUID("45000000-0000-4000-8000-000000000009"),
        "slug": "sheets-validate-rows",
        "title": "가져온 시트 데이터 검증하기",
        "summary": "빈 이름, 빠진 셀, 숫자가 아닌 점수를 걸러냅니다.",
        "objective": "외부 데이터의 누락과 형식 오류를 검사한 뒤 정상 레코드만 다음 단계로 보냅니다.",
        "order": 8,
        "content": {
            "scenario": "외부 시트는 셀이 비어 있거나 점수 칸에 문자가 들어갈 수 있습니다. 확인 없이 저장하면 DB 오류가 나거나 잘못된 자료가 섞이므로, 먼저 열 구조와 필수 값을 검사합니다.",
            "steps": [
                {"label": "행 모양 확인", "value": "헤더와 행 길이 비교", "description": "열 개수가 맞지 않는 행은 레코드로 만들지 않습니다."},
                {"label": "필수 이름 검사", "value": "이름이 비어 있지 않음", "description": "공백만 있는 이름을 제외합니다."},
                {"label": "점수 형식 검사", "value": "숫자로 변환 가능", "description": "숫자가 아닌 점수를 DB 저장 전에 걸러냅니다."},
            ],
            "challenge": "행 길이, 이름, 점수 형식이 올바른 레코드만 모으고 유효한 학생 수를 출력하세요.",
            "prompts": [
                {"field": "input", "label": "검사할 원본 데이터", "placeholder": "헤더가 포함된 시트 행"},
                {"field": "process", "label": "누락과 형식 검사", "placeholder": "행의 열 수, 이름, 숫자 점수를 확인하세요"},
                {"field": "output", "label": "검사를 통과한 행", "placeholder": "유효한 학생: 3명"},
            ],
            "block_activity": activity(
                "시트 행을 레코드로 바꾸고 이름이 있으며 점수가 숫자인 학생만 남기세요. 실행 전에 시트 ID를 본인 값으로 바꾸세요.",
                "유효한 학생: 3명",
                [
                    {"id": "validate-records", "label": "이름과 점수 형식 검사", "code": "students = [record for record in records if str(record.get('이름', '')).strip() and str(record.get('점수', '')).isdigit()]\n", "description": "이름이 비어 있지 않고 점수가 숫자인 행만 통과시킵니다."},
                    {"id": "import-sheets", "label": "시트 읽기 도구 가져오기", "code": "from weblink_api import get_google_sheet\n", "description": "승인된 Google 연결을 통해 데이터를 가져옵니다."},
                    {"id": "show-valid", "label": "유효한 학생 수 출력", "code": "print(f'유효한 학생: {len(students)}명')", "description": "검사를 통과한 행의 수를 보여줍니다."},
                    {"id": "read-range", "label": "시트 범위 읽기", "code": "sheet = get_google_sheet('YOUR_SPREADSHEET_ID', \"'시트1'!A1:C4\")\n", "description": "필요한 셀 범위를 연결 경로에서 읽어옵니다."},
                    {"id": "map-records", "label": "행을 헤더가 있는 레코드로 변환", "code": "records = [dict(zip(headers, row)) for row in rows[1:] if len(row) == len(headers)]\n", "description": "열 이름과 값을 연결하고 열 개수가 맞는 행만 사용합니다."},
                    {"id": "read-header", "label": "행 목록과 헤더 꺼내기", "code": "rows = sheet['values']\nheaders = rows[0]\n", "description": "첫 번째 행을 열 이름으로 사용합니다."},
                    {"id": "get-values", "label": "응답에서 행 목록 꺼내기", "code": "rows = sheet['values']\n", "description": "Sheets 응답의 셀 값 목록을 준비합니다."},
                    {"id": "count-valid", "label": "검사 결과를 고정 출력", "code": "print('유효한 학생: 3명')\n", "description": "실제 행 검사를 하지 않고 숫자를 바로 출력합니다."},
                ],
            ),
        },
    },
    {
        "id": UUID("45000000-0000-4000-8000-00000000000a"),
        "slug": "sheets-transactional-sync",
        "title": "오류가 나도 DB를 안전하게 지키기",
        "summary": "동기화 중 실패하면 일부 저장 내용을 되돌립니다.",
        "objective": "DB 변경을 하나의 트랜잭션으로 처리하고 실패 시 롤백해 부분 저장을 막습니다.",
        "order": 9,
        "content": {
            "scenario": "여러 행을 저장하는 도중 오류가 나면 앞부분만 저장된 상태가 될 수 있습니다. 트랜잭션으로 한 묶음의 변경을 관리하면 전부 성공하거나 전부 되돌릴 수 있습니다.",
            "steps": [
                {"label": "저장 묶음 시작", "value": "try", "description": "여러 행의 DB 변경을 오류 처리 구간에서 실행합니다."},
                {"label": "전부 성공", "value": "commit", "description": "모든 행이 처리된 뒤에만 저장을 확정합니다."},
                {"label": "하나라도 실패", "value": "rollback", "description": "부분 변경을 취소하고 오류를 숨기지 않습니다."},
            ],
            "challenge": "검증한 시트 데이터를 모두 저장하고, 오류가 나면 변경을 되돌린 뒤 오류를 다시 전달하세요.",
            "prompts": [
                {"field": "input", "label": "저장할 레코드", "placeholder": "검증을 통과한 시트 행"},
                {"field": "process", "label": "전체 성공 또는 전체 되돌리기", "placeholder": "try, commit, rollback을 사용하세요"},
                {"field": "output", "label": "저장 결과", "placeholder": "안전 저장 완료: 3명"},
            ],
            "block_activity": activity(
                "이름과 점수를 확인한 시트 행을 DB에 저장하세요. 모든 저장이 끝난 뒤 commit하고, 오류가 나면 rollback한 다음 오류를 다시 발생시키세요.",
                "안전 저장 완료: 3명",
                [
                    {"id": "safe-save", "label": "저장 후 commit, 오류면 rollback", "code": "try:\n    for student in students:\n        connection.execute('INSERT OR REPLACE INTO safe_students VALUES (?, ?)', (student['이름'], int(student['점수'])))\n    connection.commit()\nexcept Exception:\n    connection.rollback()\n    raise\n", "description": "전체 행을 저장하고 성공한 경우에만 확정합니다."},
                    {"id": "imports", "label": "SQLite와 시트 도구 가져오기", "code": "import sqlite3\nfrom weblink_api import get_google_sheet\n", "description": "영구 DB와 승인된 시트 연결을 준비합니다."},
                    {"id": "open-db", "label": "프로젝트 DB 열기", "code": "connection = sqlite3.connect('/data/students.db')\n", "description": "실행이 끝나도 유지되는 프로젝트 저장소를 사용합니다."},
                    {"id": "read-range", "label": "시트 범위 요청", "code": "sheet = get_google_sheet('YOUR_SPREADSHEET_ID', \"'시트1'!A1:C4\")\n", "description": "연결된 계정에서 필요한 행을 가져옵니다."},
                    {"id": "create-table", "label": "DB 표 준비", "code": "connection.execute('CREATE TABLE IF NOT EXISTS safe_students (name TEXT PRIMARY KEY, score INTEGER)')\n", "description": "이름을 고유 키로 하는 표를 준비합니다."},
                    {"id": "read-records", "label": "행과 열 이름 꺼내기", "code": "rows = sheet['values']\nheaders = rows[0]\nrecords = [dict(zip(headers, row)) for row in rows[1:] if len(row) == len(headers)]\n", "description": "셀 행을 헤더 기반 레코드로 바꿉니다."},
                    {"id": "prepare-students", "label": "올바른 학생만 준비", "code": "students = [record for record in records if str(record.get('이름', '')).strip() and str(record.get('점수', '')).isdigit()]\n", "description": "이름과 숫자 점수가 있는 행만 저장 대상으로 만듭니다."},
                    {"id": "count-saved", "label": "DB에 남은 학생 수 조회", "code": "count = connection.execute('SELECT COUNT(*) FROM safe_students').fetchone()[0]\n", "description": "저장 완료 후 DB의 행 수를 확인합니다."},
                    {"id": "show-saved", "label": "저장 결과 출력", "code": "print(f'안전 저장 완료: {count}명')\n", "description": "프로젝트 DB에 저장된 학생 수를 보여줍니다."},
                    {"id": "close-db", "label": "DB 연결 닫기", "code": "connection.close()", "description": "처리가 끝나면 DB를 닫습니다."},
                    {"id": "commit-each-row", "label": "행마다 바로 확정", "code": "for student in students:\n    connection.execute('INSERT OR REPLACE INTO safe_students VALUES (?, ?)', (student['이름'], int(student['점수'])))\n    connection.commit()\n", "description": "중간 오류가 나도 앞서 저장한 일부 행은 남습니다."},
                ],
            ),
        },
    },
    {
        "id": UUID("45000000-0000-4000-8000-00000000000b"),
        "slug": "sheets-full-refresh",
        "title": "시트와 DB를 안전하게 전체 동기화하기",
        "summary": "임시 표에 새 데이터를 준비하고 한 번에 교체해 오래된 행을 정리합니다.",
        "objective": "현재 시트 상태를 임시 표에 준비한 뒤 트랜잭션 안에서 오래된 행 제거와 새 행 반영을 원자적으로 완료합니다.",
        "order": 10,
        "content": {
            "scenario": "기존 동기화는 바뀐 행을 갱신해도 시트에서 삭제된 행이 DB에 남을 수 있습니다. 전체 목록을 임시 표에 먼저 준비하고, 확인이 끝났을 때 오래된 행 제거와 새 목록 반영을 한 트랜잭션에서 마칩니다. 데이터가 비었거나 유효한 행이 하나도 없으면 기존 자료를 지우지 않고 중단합니다.",
            "steps": [
                {"label": "현재 목록 임시 준비", "value": "current_students", "description": "원본 시트에서 받은 전체 데이터를 임시 표에 저장합니다."},
                {"label": "오래된 행만 제거", "value": "NOT IN current snapshot", "description": "새 원본 목록에 없는 기존 행만 찾아냅니다."},
                {"label": "한 번에 확정", "value": "transaction + commit", "description": "삭제와 새 목록 반영을 묶어 중간 상태 노출을 막습니다."},
            ],
            "challenge": "검증한 시트 목록을 임시 표에 준비한 뒤 기존 표의 오래된 행을 제거하고 새 목록을 반영하세요.",
            "prompts": [
                {"field": "input", "label": "현재 시트 전체 목록", "placeholder": "검증 후 남은 학생 레코드"},
                {"field": "process", "label": "안전한 전체 동기화", "placeholder": "임시 표, 오래된 행 제거, 트랜잭션 확정을 사용하세요"},
                {"field": "output", "label": "현재 시트와 일치하는 행", "placeholder": "시트와 동기화된 학생: 3명"},
            ],
            "block_activity": activity(
                "현재 시트의 유효한 학생 목록을 임시 표에 채우고, 이전 목록에만 있는 행을 제거한 다음 새 목록을 프로젝트 DB에 반영하세요. 전체 작업은 트랜잭션으로 처리하세요.",
                "시트와 동기화된 학생: 3명",
                [
                    {"id": "begin-sync", "label": "동기화 트랜잭션 시작", "code": "connection.execute('BEGIN')\ntry:\n", "description": "임시 준비부터 삭제·반영까지 중간에 끊기지 않도록 묶습니다."},
                    {"id": "imports", "label": "SQLite와 시트 도구 가져오기", "code": "import sqlite3\nfrom weblink_api import get_google_sheet\n", "description": "프로젝트 DB와 승인된 시트 읽기 도구를 준비합니다."},
                    {"id": "open-db", "label": "프로젝트 DB 열기", "code": "connection = sqlite3.connect('/data/students.db')\n", "description": "프로젝트의 영구 SQLite 데이터베이스를 엽니다."},
                    {"id": "prepare-target", "label": "기존 학생 표 준비", "code": "    connection.execute('CREATE TABLE IF NOT EXISTS safe_students (name TEXT PRIMARY KEY, score INTEGER)')\n", "description": "최종 데이터를 보관할 표를 준비합니다."},
                    {"id": "read-range", "label": "현재 시트 범위 읽기", "code": "    sheet = get_google_sheet('YOUR_SPREADSHEET_ID', \"'시트1'!A1:C4\")\n", "description": "현재 동기화 기준이 될 시트 전체 범위를 읽습니다."},
                {"id": "read-records", "label": "행·헤더·유효 레코드 준비", "code": "    rows = sheet['values']\n    headers = rows[0]\n    records = [dict(zip(headers, row)) for row in rows[1:] if len(row) == len(headers)]\n    students = [record for record in records if str(record.get('이름', '')).strip() and str(record.get('점수', '')).isdigit()]\n", "description": "행 모양과 필수 값을 확인해 유효한 레코드만 고릅니다."},
                    {"id": "guard-empty", "label": "비어 있는 목록은 동기화 중단", "code": "    if not students:\n        raise ValueError('시트에 유효한 학생이 없어 동기화를 중단합니다.')\n", "description": "빈 범위나 잘못된 형식이 기존 DB 내용을 지우지 않게 보호합니다."},
                    {"id": "stage-rows", "label": "임시 현재 목록 채우기", "code": "    connection.execute('CREATE TEMP TABLE IF NOT EXISTS current_students (name TEXT PRIMARY KEY, score INTEGER)')\n    connection.execute('DELETE FROM current_students')\n    for student in students:\n        connection.execute('INSERT OR REPLACE INTO current_students VALUES (?, ?)', (student['이름'], int(student['점수'])))\n", "description": "최종 표를 바꾸기 전에 현재 시트 목록을 임시 표에 전부 만듭니다."},
                    {"id": "remove-stale", "label": "시트에서 사라진 학생 제거", "code": "    connection.execute('DELETE FROM safe_students WHERE name NOT IN (SELECT name FROM current_students)')\n", "description": "현재 임시 목록에 더 이상 없는 기존 행만 제거합니다."},
                    {"id": "apply-snapshot", "label": "현재 목록을 최종 표에 반영", "code": "    connection.execute('INSERT OR REPLACE INTO safe_students SELECT * FROM current_students')\n", "description": "임시 목록으로 기존 행을 갱신하거나 새 행을 추가합니다."},
                    {"id": "commit-sync", "label": "성공하면 확정, 실패하면 취소", "code": "    connection.commit()\nexcept Exception:\n    connection.rollback()\n    raise\n", "description": "전체 동기화가 성공한 경우만 확정하고, 실패하면 모든 변경을 되돌립니다."},
                    {"id": "count-rows", "label": "현재 표의 행 수 조회", "code": "count = connection.execute('SELECT COUNT(*) FROM safe_students').fetchone()[0]\n", "description": "시트와 일치하도록 반영된 최종 행 수를 확인합니다."},
                    {"id": "show-count", "label": "동기화된 행 수 출력", "code": "print(f'시트와 동기화된 학생: {count}명')\n", "description": "전체 동기화 결과를 보여줍니다."},
                    {"id": "close-db", "label": "DB 연결 닫기", "code": "connection.close()", "description": "동기화 완료 후 데이터베이스를 닫습니다."},
                    {"id": "delete-everything", "label": "기존 학생을 모두 삭제", "code": "    connection.execute('DELETE FROM safe_students')\n", "description": "원본에 없는 행만 정리해야 하므로 전체 삭제는 올바르지 않습니다."},
                ],
            ),
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
    op.bulk_insert(lessons, [{
        "id": item["id"],
        "course_id": COURSE_ID,
        "slug": item["slug"],
        "title": item["title"],
        "summary": item["summary"],
        "learning_objective": item["objective"],
        "content": item["content"],
        "order_index": item["order"],
        "is_published": True,
    } for item in LESSONS])
    op.bulk_insert(lesson_concepts, [{"lesson_id": item["id"], "concept_id": CONCEPT_ID} for item in LESSONS])


def downgrade() -> None:
    lesson_ids = ", ".join(f"'{item['id']}'" for item in LESSONS)
    op.execute(f"DELETE FROM lesson_concepts WHERE lesson_id IN ({lesson_ids})")
    op.execute(f"DELETE FROM lessons WHERE id IN ({lesson_ids})")
