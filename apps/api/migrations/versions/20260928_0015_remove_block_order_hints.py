"""Remove explicit answer-order hints from integration activities.

Revision ID: 20260928_0015
Revises: 20260928_0014
Create Date: 2026-09-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0015"
down_revision: str | None = "20260928_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

INSTRUCTIONS = {
    "sqlite-database": (
        "민지의 점수를 데이터베이스에서 읽어 화면에 보여주는 코드를 블록으로 조립하세요.",
        "DB 연결 → 테이블 생성 → 데이터 저장 → 다시 읽기 → 출력 순서로 블록을 쌓으세요.",
    ),
    "persistent-sqlite": (
        "여러 번 실행해도 민지의 데이터가 남도록 프로젝트 DB를 사용하는 코드를 조립하세요.",
        "SQLite 가져오기 → 프로젝트 DB 열기 → 표 준비 → 한 번만 저장 → 조회 → 출력 순서로 쌓으세요.",
    ),
    "api-json-basics": (
        "학생 데이터를 API에서 가져와 이름과 점수를 화면에 보여주는 코드를 조립하세요.",
        "API 도구 준비 → 학생 정보 요청 → JSON 값 출력 순서로 블록을 쌓으세요.",
    ),
    "api-send-data": (
        "학생 정보를 API로 보내고 생성된 데이터로 완료 결과를 보여주는 코드를 조립하세요.",
        "POST 도구 준비 → 보낼 데이터 만들기 → API로 전송 → 응답의 이름 표시 순서로 쌓으세요.",
    ),
}


def _set_instruction(slug: str, value: str) -> None:
    op.get_bind().execute(
        sa.text(
            "UPDATE lessons SET content = "
            "jsonb_set(CAST(content AS jsonb), '{block_activity,instruction}', "
            "to_jsonb(CAST(:instruction AS text)))::json "
            "WHERE slug = :slug"
        ),
        {"slug": slug, "instruction": value},
    )


def upgrade() -> None:
    for slug, (value, _old) in INSTRUCTIONS.items():
        _set_instruction(slug, value)


def downgrade() -> None:
    for slug, (_new, value) in INSTRUCTIONS.items():
        _set_instruction(slug, value)
