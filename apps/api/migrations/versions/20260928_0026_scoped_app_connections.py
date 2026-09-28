"""Add a safe app-connection course with a local scoped integration lab."""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0026"
down_revision: str | None = "20260928_0025"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000005")
CONCEPT_ID = UUID("45000000-0000-4000-8000-000000000001")
LESSONS = [
    {
        "id": UUID("45000000-0000-4000-8000-000000000002"),
        "slug": "broker-connection-status",
        "title": "연결된 앱과 허용 권한 확인하기",
        "summary": "비밀 키를 코드로 받지 않고 연결 상태와 허용 범위만 확인합니다.",
        "objective": "연결 중개 서비스가 제공하는 연결 상태와 최소 권한 정보를 확인합니다.",
        "order": 1,
        "content": {
            "scenario": "앱을 연결할 때 비밀 키를 코드에 복사하지 않습니다. 연결 창에서 사용자가 허용하면 중개 서비스가 자격 증명을 보관하고, 코드는 연결 상태와 허용된 권한만 확인합니다.",
            "steps": [
                {"label": "앱 연결 확인", "value": "team-calendar", "description": "사용자가 미리 연결한 일정 앱의 상태를 확인합니다."},
                {"label": "허용 범위 읽기", "value": "events.read", "description": "이 연결에서 허용된 최소 권한 이름만 받습니다."},
                {"label": "키 없이 사용", "value": "secret-free code", "description": "실제 자격 증명이나 토큰은 코드에 들어오지 않습니다."},
            ],
            "challenge": "일정 앱의 연결 상태와 허용 권한을 확인하고, 연결된 경우에만 결과를 보여주세요.",
            "prompts": [
                {"field": "input", "label": "확인할 연결", "placeholder": "team-calendar"},
                {"field": "process", "label": "상태와 권한 확인", "placeholder": "연결 상태가 connected인지 확인하세요"},
                {"field": "output", "label": "연결 상태와 허용 권한", "placeholder": "연결 확인: team-calendar (events.read)"},
            ],
            "block_activity": {
                "instruction": "일정 연결의 상태를 조회하고, 연결된 경우에만 이름과 허용 권한을 보여주세요. 실습 데이터에는 비밀 키가 포함되지 않습니다.",
                "expected_output": "연결 확인: team-calendar (events.read)",
                "blocks": [
                    {"id": "show-permissions", "label": "연결된 이름과 권한 보여주기", "code": "    print(f\"연결 확인: {connection['name']} ({', '.join(connection['scopes'])})\")", "description": "연결 이름과 허용 범위만 화면에 표시합니다."},
                    {"id": "request-connection", "label": "일정 앱 연결 정보 요청", "code": "connection = get_json('/connections/team-calendar')\n", "description": "연결 중개 서비스에서 비밀이 아닌 연결 정보를 받습니다."},
                    {"id": "skip-check", "label": "결과만 출력", "code": "print('연결 확인: team-calendar (events.read)')\n", "description": "연결 정보를 확인하지 않고 결과만 출력합니다."},
                    {"id": "import-api", "label": "연결 조회 도구 가져오기", "code": "from weblink_api import get_json\n", "description": "실습용 연결 중개 서비스에 요청할 도구를 준비합니다."},
                    {"id": "check-status", "label": "연결된 경우만 표시", "code": "if connection['status'] == 'connected':\n", "description": "연결이 완료된 경우에만 다음 내용을 처리합니다."},
                ],
            },
        },
    },
    {
        "id": UUID("45000000-0000-4000-8000-000000000003"),
        "slug": "broker-read-events",
        "title": "허용된 일정 데이터만 가져오기",
        "summary": "연결 권한 범위에 있는 일정 목록을 요청하고 응답을 읽습니다.",
        "objective": "승인된 연결 경로에서 일정 데이터를 요청해 JSON 응답을 처리합니다.",
        "order": 2,
        "content": {
            "scenario": "사용자가 일정 읽기를 허용한 연결은 일정 목록을 제공할 수 있습니다. 중개 서비스가 연결과 권한을 확인하므로 학습 코드가 제공자 토큰을 직접 다루지 않습니다.",
            "steps": [
                {"label": "승인된 연결 사용", "value": "team-calendar", "description": "앞 단계에서 확인한 연결을 사용합니다."},
                {"label": "일정 요청", "value": "events.read", "description": "허용된 읽기 권한 안에서 일정 목록을 받습니다."},
                {"label": "JSON 목록 사용", "value": "response['events']", "description": "응답 목록에서 일정 수를 확인합니다."},
            ],
            "challenge": "연결 중개 서비스를 통해 일정 목록을 받고, 몇 개를 받았는지 출력하세요.",
            "prompts": [
                {"field": "input", "label": "연결된 일정 앱", "placeholder": "team-calendar"},
                {"field": "process", "label": "응답에서 목록 꺼내기", "placeholder": "events 키의 목록을 사용하세요"},
                {"field": "output", "label": "받은 일정 수", "placeholder": "연결된 일정: 3개"},
            ],
            "block_activity": {
                "instruction": "연결 중개 서비스를 통해 허용된 일정 목록을 요청하고 응답에서 목록을 꺼내 개수를 보여주세요.",
                "expected_output": "연결된 일정: 3개",
                "blocks": [
                    {"id": "get-events", "label": "응답에서 일정 목록 꺼내기", "code": "events = response['events']\n", "description": "JSON 응답에서 일정 목록을 가져옵니다."},
                    {"id": "skip-events", "label": "결과만 바로 출력", "code": "print('연결된 일정: 3개')\n", "description": "목록을 요청하지 않고 결과만 출력합니다."},
                    {"id": "import-api", "label": "연결 조회 도구 가져오기", "code": "from weblink_api import get_json\n", "description": "연결 중개 서비스에 요청할 도구를 준비합니다."},
                    {"id": "show-event-count", "label": "받은 일정 수 출력", "code": "print(f'연결된 일정: {len(events)}개')", "description": "받은 목록에 몇 개의 일정이 있는지 보여줍니다."},
                    {"id": "request-events", "label": "허용된 일정 목록 요청", "code": "response = get_json('/connections/team-calendar/events')\n", "description": "연결 경로를 통해 일정 응답을 요청합니다."},
                ],
            },
        },
    },
    {
        "id": UUID("45000000-0000-4000-8000-000000000004"),
        "slug": "broker-sync-events",
        "title": "확정 일정만 프로젝트 DB에 동기화하기",
        "summary": "필요한 일정만 골라 저장하고 반복 실행에도 중복을 막습니다.",
        "objective": "연결 데이터에서 필요한 레코드를 고른 뒤 고유 ID를 사용해 프로젝트 DB에 안전하게 동기화합니다.",
        "order": 3,
        "content": {
            "scenario": "외부 앱에서 읽은 정보를 모두 저장할 필요는 없습니다. 확정된 일정만 프로젝트 DB에 넣고 일정 ID를 기본 키로 사용하면 다시 실행해도 같은 행이 중복되지 않습니다.",
            "steps": [
                {"label": "프로젝트 DB 열기", "value": "/data/students.db", "description": "이 프로젝트에 연결된 영속 DB를 사용합니다."},
                {"label": "확정 일정만 선택", "value": "status == confirmed", "description": "취소된 일정은 저장하지 않습니다."},
                {"label": "ID로 중복 방지", "value": "INSERT OR REPLACE", "description": "일정 ID를 기준으로 다시 실행해도 중복 행을 만들지 않습니다."},
            ],
            "challenge": "연결된 일정 중 확정된 것만 프로젝트 DB에 저장하고, 중복 없이 몇 개가 저장됐는지 보여주세요.",
            "prompts": [
                {"field": "input", "label": "저장할 일정 조건", "placeholder": "status가 confirmed인 일정"},
                {"field": "process", "label": "중복 방지 저장 방식", "placeholder": "일정 고유 ID를 기본 키로 사용하세요"},
                {"field": "output", "label": "저장한 확정 일정 수", "placeholder": "확정 일정 동기화: 2개"},
            ],
            "block_activity": {
                "instruction": "연결 일정 목록에서 확정된 일정만 프로젝트 DB에 일정 ID를 기준으로 저장하고, 저장된 개수를 보여주세요.",
                "expected_output": "확정 일정 동기화: 2개",
                "blocks": [
                    {"id": "sync-confirmed", "label": "확정 일정만 ID로 저장", "code": "for event in response['events']:\n    if event['status'] == 'confirmed':\n        connection.execute('INSERT OR REPLACE INTO calendar_events VALUES (?, ?)', (event['id'], event['title']))\n", "description": "확정된 일정만 고유 ID를 기준으로 안전하게 저장합니다."},
                    {"id": "import-api", "label": "연결 조회 도구 가져오기", "code": "from weblink_api import get_json\n", "description": "승인된 연결의 데이터를 요청할 도구를 준비합니다."},
                    {"id": "count-events", "label": "DB 일정 수 조회", "code": "count = connection.execute('SELECT COUNT(*) FROM calendar_events').fetchone()[0]\n", "description": "프로젝트 DB에 저장된 일정을 셉니다."},
                    {"id": "open-db", "label": "프로젝트 DB 열기", "code": "connection = sqlite3.connect('/data/students.db')\n", "description": "다음 실행에도 남는 프로젝트 DB를 엽니다."},
                    {"id": "request-events", "label": "연결된 일정 요청", "code": "response = get_json('/connections/team-calendar/events')\n", "description": "중개 서비스가 제공하는 일정 목록을 받습니다."},
                    {"id": "import-sqlite", "label": "SQLite 도구 가져오기", "code": "import sqlite3\n", "description": "프로젝트 DB를 다룰 도구를 준비합니다."},
                    {"id": "create-table", "label": "일정 표 준비", "code": "connection.execute('CREATE TABLE IF NOT EXISTS calendar_events (id INTEGER PRIMARY KEY, title TEXT)')\n", "description": "일정 고유 ID와 제목을 저장할 표를 준비합니다."},
                    {"id": "commit", "label": "DB 저장 확정", "code": "connection.commit()\n", "description": "프로젝트 DB에 동기화 결과를 반영합니다."},
                    {"id": "show-count", "label": "저장한 일정 수 출력", "code": "print(f'확정 일정 동기화: {count}개')\n", "description": "저장된 확정 일정 수를 확인합니다."},
                    {"id": "skip-filter", "label": "모든 일정 저장", "code": "for event in response['events']:\n    connection.execute('INSERT OR REPLACE INTO calendar_events VALUES (?, ?)', (event['id'], event['title']))\n", "description": "취소된 일정까지 저장하므로 조건에 맞지 않습니다."},
                    {"id": "close-db", "label": "DB 닫기", "code": "connection.close()", "description": "저장 작업이 끝나면 DB 연결을 닫습니다."},
                ],
            },
        },
    },
]


def upgrade() -> None:
    courses = sa.table("courses", sa.column("id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("description", sa.Text()), sa.column("order_index", sa.Integer()))
    concepts = sa.table("concepts", sa.column("id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("name", sa.String()), sa.column("description", sa.Text()))
    lessons = sa.table("lessons", sa.column("id", sa.Uuid()), sa.column("course_id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("summary", sa.Text()), sa.column("learning_objective", sa.Text()), sa.column("content", sa.JSON()), sa.column("order_index", sa.Integer()), sa.column("is_published", sa.Boolean()))
    lesson_concepts = sa.table("lesson_concepts", sa.column("lesson_id", sa.Uuid()), sa.column("concept_id", sa.Uuid()))
    op.bulk_insert(courses, [{"id": COURSE_ID, "slug": "scoped-app-connections", "title": "외부 앱과 안전하게 연결하기", "description": "승인된 앱 연결에서 필요한 데이터만 읽고 프로젝트 DB에 안전하게 동기화합니다.", "order_index": 5}])
    op.bulk_insert(concepts, [{"id": CONCEPT_ID, "slug": "scoped-app-connections", "name": "승인된 앱 연결", "description": "중개 서비스가 자격 증명을 보호하고 앱에는 허용된 데이터 접근만 제공합니다."}])
    op.bulk_insert(lessons, [{"id": item["id"], "course_id": COURSE_ID, "slug": item["slug"], "title": item["title"], "summary": item["summary"], "learning_objective": item["objective"], "content": item["content"], "order_index": item["order"], "is_published": True} for item in LESSONS])
    op.bulk_insert(lesson_concepts, [{"lesson_id": item["id"], "concept_id": CONCEPT_ID} for item in LESSONS])


def downgrade() -> None:
    op.execute(f"DELETE FROM lesson_concepts WHERE concept_id = '{CONCEPT_ID}'")
    op.execute(f"DELETE FROM lessons WHERE course_id = '{COURSE_ID}'")
    op.execute(f"DELETE FROM concepts WHERE id = '{CONCEPT_ID}'")
    op.execute(f"DELETE FROM courses WHERE id = '{COURSE_ID}'")
