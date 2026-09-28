"""Teach retrying temporary API failures selectively."""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0025"
down_revision: str | None = "20260928_0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000004")
LESSON_ID = UUID("44000000-0000-4000-8000-000000000013")
CONCEPT_ID = UUID("44000000-0000-4000-8000-000000000002")
CONTENT = {
    "scenario": "외부 서비스가 잠시 바쁠 때는 다시 요청하면 성공할 수 있습니다. 하지만 없는 자료 같은 영구 오류까지 반복하면 안 됩니다.",
    "steps": [
        {"label": "재시도 횟수 정하기", "value": "최대 3회", "description": "끝없이 기다리지 않도록 시도 횟수를 제한합니다."},
        {"label": "일시 오류만 다시 요청", "value": "503 Service Unavailable", "description": "서비스가 잠시 응답할 수 없다는 오류만 재시도합니다."},
        {"label": "다른 오류는 전달", "value": "그 외 상태 코드", "description": "404 같은 오류는 숨기지 않고 다시 올립니다."},
    ],
    "challenge": "최대 세 번 요청하고, 503일 때만 다시 시도해 성공한 학생 이름을 출력하세요.",
    "prompts": [
        {"field": "input", "label": "요청 횟수와 일시 오류", "placeholder": "최대 3회, 503만 재시도"},
        {"field": "process", "label": "안전한 재시도 조건", "placeholder": "다른 상태 코드는 다시 올리세요"},
        {"field": "output", "label": "다시 연결한 학생", "placeholder": "다시 연결: 민지"},
    ],
    "block_activity": {
        "instruction": "요청은 최대 세 번 시도하고, 503 오류만 다시 요청하세요. 성공 응답에서 학생 이름을 보여주세요.",
        "expected_output": "다시 연결: 민지",
        "blocks": [
            {"id": "retry-request", "label": "503일 때 다시 요청", "code": "for _attempt in range(3):\n    try:\n        student = get_json('/retry-once')\n        break\n    except APIResponseError as error:\n        if error.status_code != 503:\n            raise\n", "description": "세 번까지만 시도하고 503 외 오류는 그대로 전달합니다."},
            {"id": "skip-retry", "label": "성공한 것처럼 출력", "code": "print('다시 연결: 민지')\n", "description": "요청하지 않고 결과만 출력합니다."},
            {"id": "import-retry", "label": "오류 종류와 API 도구 가져오기", "code": "from weblink_api import APIResponseError, get_json\n", "description": "응답 상태 코드를 확인하며 API를 요청할 도구를 준비합니다."},
            {"id": "initialize", "label": "학생 응답 자리 준비", "code": "student = None\n", "description": "성공 전까지 결과가 비어 있음을 표시합니다."},
            {"id": "show-retried", "label": "성공한 이름 출력", "code": "if student:\n    print(f\"다시 연결: {student['name']}\")", "description": "요청에 성공한 경우에만 이름을 보여줍니다."},
        ],
    },
}


def upgrade() -> None:
    lessons = sa.table("lessons", sa.column("id", sa.Uuid()), sa.column("course_id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("summary", sa.Text()), sa.column("learning_objective", sa.Text()), sa.column("content", sa.JSON()), sa.column("order_index", sa.Integer()), sa.column("is_published", sa.Boolean()))
    lesson_concepts = sa.table("lesson_concepts", sa.column("lesson_id", sa.Uuid()), sa.column("concept_id", sa.Uuid()))
    op.bulk_insert(lessons, [{"id": LESSON_ID, "course_id": COURSE_ID, "slug": "api-retry-transient", "title": "일시적인 API 오류만 다시 시도하기", "summary": "503 오류만 제한 횟수 안에서 재시도합니다.", "learning_objective": "일시적인 API 상태 오류와 영구 오류를 구분해 제한적으로 재시도합니다.", "content": CONTENT, "order_index": 12, "is_published": True}])
    op.bulk_insert(lesson_concepts, [{"lesson_id": LESSON_ID, "concept_id": CONCEPT_ID}])


def downgrade() -> None:
    op.execute(f"DELETE FROM lesson_concepts WHERE lesson_id = '{LESSON_ID}'")
    op.execute(f"DELETE FROM lessons WHERE id = '{LESSON_ID}'")
