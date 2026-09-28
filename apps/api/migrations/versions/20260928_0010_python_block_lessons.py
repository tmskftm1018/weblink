"""Add a block-building activity to the Python learning path.

Revision ID: 20260928_0010
Revises: 20260928_0009
Create Date: 2026-09-28
"""

import json
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0010"
down_revision: str | None = "20260928_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

ACTIVITIES = {
    "print-output": {
        "instruction": "블록을 쌓아 안녕, 세계!를 화면에 출력하는 코드를 완성하세요.",
        "expected_output": "안녕, 세계!",
        "blocks": [
            {"id": "print", "label": "출력 시작", "code": "print(", "description": "화면에 결과를 보여주는 함수"},
            {"id": "message", "label": "문장 값", "code": "'안녕, 세계!'", "description": "출력할 글자"},
            {"id": "close", "label": "괄호 닫기", "code": ")", "description": "함수에 넣은 값을 마무리"},
            {"id": "wrong-value", "label": "숫자 값", "code": "42", "description": "다른 값을 출력하는 블록"},
        ],
    },
    "python-variables": {
        "instruction": "점수 7을 score에 저장한 다음 화면에 출력하도록 블록을 조립하세요.",
        "expected_output": "7",
        "blocks": [
            {"id": "assign", "label": "변수에 저장", "code": "score = ", "description": "오른쪽 값을 왼쪽 변수에 대입"},
            {"id": "seven", "label": "숫자 7", "code": "7", "description": "변수에 저장할 숫자"},
            {"id": "print-score", "label": "변수 출력", "code": "\nprint(score)", "description": "다음 줄에서 변수 값을 출력"},
            {"id": "wrong-variable", "label": "이름 바꾸기", "code": "points = ", "description": "다른 변수에 저장하는 블록"},
        ],
    },
    "simple-calculations": {
        "instruction": "2와 3을 더해 total에 저장하고 결과를 출력하도록 블록을 조립하세요.",
        "expected_output": "5",
        "blocks": [
            {"id": "total", "label": "합계 변수", "code": "total = ", "description": "계산 결과를 저장할 변수"},
            {"id": "sum", "label": "2 더하기 3", "code": "2 + 3", "description": "두 숫자를 더하는 계산"},
            {"id": "print-total", "label": "합계 출력", "code": "\nprint(total)", "description": "계산한 결과를 출력"},
            {"id": "wrong-math", "label": "곱하기", "code": "2 * 3", "description": "다른 연산을 하는 블록"},
        ],
    },
    "reading-input": {
        "instruction": "이름을 입력받아 name에 저장하고 인사말을 출력하도록 블록을 조립하세요.",
        "expected_output": "이름 입력 후 인사말 출력",
        "blocks": [
            {"id": "input-start", "label": "입력받기", "code": "name = input(", "description": "사용자 입력을 변수에 저장"},
            {"id": "input-prompt", "label": "이름 질문", "code": "'이름을 입력하세요: '", "description": "입력창에 표시할 안내"},
            {"id": "input-close", "label": "입력 마무리", "code": ")", "description": "input 함수의 괄호 닫기"},
            {"id": "greet", "label": "인사 출력", "code": "\nprint('안녕, ' + name)", "description": "입력된 이름을 인사말에 연결"},
            {"id": "wrong-input", "label": "숫자 계산", "code": "name = 1 + 2", "description": "입력 대신 계산하는 블록"},
        ],
    },
    "if-conditions": {
        "instruction": "점수가 60 이상이면 합격을 출력하도록 조건 블록을 조립하세요.",
        "expected_output": "합격",
        "blocks": [
            {"id": "score-check", "label": "점수 조건", "code": "score = 80\nif score >= 60:\n", "description": "점수가 기준 이상인지 확인"},
            {"id": "pass-output", "label": "합격 출력", "code": "    print('합격')", "description": "조건이 참일 때 실행할 코드"},
            {"id": "wrong-check", "label": "다른 조건", "code": "if score < 60:\n", "description": "합격 기준과 반대인 조건"},
        ],
    },
    "for-loops": {
        "instruction": "for 반복문으로 1, 2, 3을 차례로 출력하도록 블록을 조립하세요.",
        "expected_output": "1, 2, 3",
        "blocks": [
            {"id": "for-list", "label": "숫자 목록 반복", "code": "for number in [1, 2, 3]:\n", "description": "목록의 숫자를 하나씩 꺼내기"},
            {"id": "print-number", "label": "숫자 출력", "code": "    print(number)", "description": "현재 숫자를 화면에 보여주기"},
            {"id": "wrong-loop", "label": "한 번만 출력", "code": "print(1)", "description": "반복하지 않고 한 값만 출력"},
        ],
    },
}


def upgrade() -> None:
    connection = op.get_bind()
    connection.execute(
        sa.text(
            "UPDATE courses SET description = :description WHERE slug = 'python-basics'"
        ),
        {"description": "블록으로 앱의 흐름을 만들고 파이썬 코드로 옮긴 뒤, 실제 프로젝트에서 화면·API·DB·외부 앱 연결로 나아갑니다."},
    )
    for slug, activity in ACTIVITIES.items():
        connection.execute(
            sa.text(
                "UPDATE lessons SET content = "
                "jsonb_set(CAST(content AS jsonb), '{block_activity}', CAST(:activity AS jsonb))::json "
                "WHERE slug = :slug AND course_id = '10000000-0000-4000-8000-000000000002'"
            ),
            {"slug": slug, "activity": json.dumps(activity, ensure_ascii=False)},
        )


def downgrade() -> None:
    for slug in ACTIVITIES:
        op.execute(
            "UPDATE lessons SET content = content - 'block_activity' "
            f"WHERE slug = '{slug}' AND course_id = '10000000-0000-4000-8000-000000000002'"
        )
    op.execute(
        "UPDATE courses SET description = '파이썬 코드로 출력, 변수, 계산, 입력, 조건, 반복을 직접 익힙니다.' "
        "WHERE slug = 'python-basics'"
    )
