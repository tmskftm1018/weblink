"""Seed the first Python programming course.

Revision ID: 20260928_0009
Revises: 20260928_0008
Create Date: 2026-09-28
"""

from collections.abc import Sequence
from uuid import UUID

import sqlalchemy as sa
from alembic import op

revision: str = "20260928_0009"
down_revision: str | None = "20260928_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None

COURSE_ID = UUID("10000000-0000-4000-8000-000000000002")
CONCEPTS = [
    ("41000000-0000-4000-8000-000000000001", "print", "출력", "print()로 프로그램의 결과를 화면에 보여줍니다."),
    ("41000000-0000-4000-8000-000000000003", "expression", "계산", "연산자를 사용해 값으로부터 새 결과를 만듭니다."),
]
LESSONS = [
    {
        "id": "42000000-0000-4000-8000-000000000001", "slug": "print-output", "title": "화면에 문장 출력하기",
        "summary": "print() 함수로 원하는 문장을 화면에 보여주는 첫 파이썬 코드를 작성합니다.",
        "objective": "print() 함수가 값을 화면에 출력한다는 점을 설명하고 사용합니다.", "order": 1, "concept": "print",
        "content": {
            "scenario": "파이썬에서 print('안녕, 세계!')를 실행하면 화면에 인사말이 나타납니다.",
            "steps": [{"label": "내용", "value": "안녕, 세계!", "description": "화면에 보여줄 문장입니다."}, {"label": "함수", "value": "print('안녕, 세계!')", "description": "print()에 보여줄 값을 넣습니다."}, {"label": "출력", "value": "안녕, 세계!", "description": "실행 결과가 화면에 나타납니다."}],
            "challenge": "안녕, 세계!를 화면에 보여주는 코드에서 내용, 사용할 파이썬 기능, 실행 결과는 무엇인가요?",
            "prompts": [{"field": "input", "label": "내용: 화면에 보여줄 문장", "placeholder": "예: 안녕, 세계!"}, {"field": "process", "label": "코드: 사용할 함수", "placeholder": "예: print() 함수에 문장을 넣는다"}, {"field": "output", "label": "결과: 화면에 나타나는 문장", "placeholder": "예: 안녕, 세계!"}],
        },
    },
    {
        "id": "42000000-0000-4000-8000-000000000002", "slug": "python-variables", "title": "변수에 값 저장하기",
        "summary": "변수에 값을 저장하고 프로그램에서 다시 사용하는 방법을 배웁니다.",
        "objective": "변수 이름에 값을 저장하는 대입문을 읽고 작성합니다.", "order": 2, "concept": "variable",
        "content": {
            "scenario": "score = 7처럼 쓰면 score라는 변수에 숫자 7을 저장하고, print(score)로 다시 사용할 수 있어요.",
            "steps": [{"label": "값", "value": "7", "description": "변수에 저장할 점수입니다."}, {"label": "저장", "value": "score = 7", "description": "등호 오른쪽 값을 왼쪽 변수에 넣습니다."}, {"label": "사용", "value": "print(score)", "description": "변수의 값을 화면에 출력합니다."}],
            "challenge": "점수 7을 score 변수에 저장해 출력할 때 값, 저장하는 코드, 출력 결과는 무엇인가요?",
            "prompts": [{"field": "input", "label": "값: 변수에 저장할 점수", "placeholder": "예: 점수 7"}, {"field": "process", "label": "코드: 값을 저장하는 방법", "placeholder": "예: score 변수에 7을 대입한다"}, {"field": "output", "label": "결과: 변수를 출력한 값", "placeholder": "예: 7"}],
        },
    },
    {
        "id": "42000000-0000-4000-8000-000000000003", "slug": "simple-calculations", "title": "숫자 계산하기",
        "summary": "더하기 연산자와 변수를 사용해 숫자를 계산하고 결과를 출력합니다.",
        "objective": "더하기 연산으로 두 숫자의 합을 구하고 출력할 수 있습니다.", "order": 3, "concept": "expression",
        "content": {
            "scenario": "파이썬에서 2 + 3을 계산하면 5가 됩니다. 결과를 total 변수에 담아 출력할 수도 있어요.",
            "steps": [{"label": "숫자", "value": "2와 3", "description": "더할 두 숫자입니다."}, {"label": "계산", "value": "total = 2 + 3", "description": "+ 연산자로 두 값을 더합니다."}, {"label": "결과", "value": "5", "description": "계산한 합계가 화면에 출력됩니다."}],
            "challenge": "2와 3을 더해 출력하는 기능에서 사용할 숫자, 계산하는 코드, 결과는 무엇인가요?",
            "prompts": [{"field": "input", "label": "숫자: 더할 두 값", "placeholder": "예: 2와 3"}, {"field": "process", "label": "코드: 두 값을 계산하는 방법", "placeholder": "예: 더하기 연산자로 합을 구한다"}, {"field": "output", "label": "결과: 계산한 합계", "placeholder": "예: 5"}],
        },
    },
    {
        "id": "42000000-0000-4000-8000-000000000004", "slug": "reading-input", "title": "사용자 입력 받기",
        "summary": "input()으로 입력을 받아 변수에 저장하고 인사말에 사용합니다.",
        "objective": "input()의 반환값을 변수에 저장해 활용하는 흐름을 설명합니다.", "order": 4, "concept": "input",
        "content": {
            "scenario": "name = input('이름을 입력하세요: ')라고 쓰면 사용자가 입력한 이름이 name 변수에 저장됩니다.",
            "steps": [{"label": "입력", "value": "지민", "description": "사용자가 입력한 이름입니다."}, {"label": "저장", "value": "name = input()", "description": "input()이 받은 값을 name에 담습니다."}, {"label": "출력", "value": "안녕, 지민!", "description": "입력받은 이름을 인사말에 사용합니다."}],
            "challenge": "사용자 이름을 입력받아 인사할 때 입력하는 값, 사용할 함수, 결과는 무엇인가요?",
            "prompts": [{"field": "input", "label": "값: 사용자에게서 받을 정보", "placeholder": "예: 이름"}, {"field": "process", "label": "코드: 사용자 입력을 받는 함수", "placeholder": "예: input() 결과를 변수에 저장한다"}, {"field": "output", "label": "결과: 입력한 이름을 사용한 인사말", "placeholder": "예: 안녕, 지민!"}],
        },
    },
    {
        "id": "42000000-0000-4000-8000-000000000005", "slug": "if-conditions", "title": "if로 조건에 따라 실행하기",
        "summary": "if 문으로 점수가 기준 이상인지 확인하고 알맞은 결과를 출력합니다.",
        "objective": "if 조건이 참일 때 들여쓴 코드가 실행되는 원리를 설명합니다.", "order": 5, "concept": "condition",
        "content": {
            "scenario": "if score >= 60:처럼 조건을 확인해 점수가 60 이상이면 '합격'을 출력할 수 있어요.",
            "steps": [{"label": "값", "value": "score = 80", "description": "조건에서 확인할 점수입니다."}, {"label": "조건", "value": "if score >= 60:", "description": "점수가 기준 이상인지 비교합니다."}, {"label": "결과", "value": "합격", "description": "조건이 참이므로 합격을 출력합니다."}],
            "challenge": "점수 80이 60 이상일 때 합격을 출력하는 기능에서 확인할 값, 조건 코드, 결과는 무엇인가요?",
            "prompts": [{"field": "input", "label": "값: 조건에서 확인할 정보", "placeholder": "예: 점수 80"}, {"field": "process", "label": "코드: 실행 여부를 정하는 조건", "placeholder": "예: if로 점수가 60 이상인지 비교한다"}, {"field": "output", "label": "결과: 조건이 참일 때 출력할 내용", "placeholder": "예: 합격"}],
        },
    },
    {
        "id": "42000000-0000-4000-8000-000000000006", "slug": "for-loops", "title": "for로 반복하기",
        "summary": "for 문으로 여러 숫자에 같은 작업을 차례대로 적용합니다.",
        "objective": "for 반복문이 목록의 각 값을 차례로 처리하는 방식을 설명합니다.", "order": 6, "concept": "loop",
        "content": {
            "scenario": "for number in [1, 2, 3]:라고 쓰면 목록의 숫자를 하나씩 꺼내 같은 작업을 반복할 수 있어요.",
            "steps": [{"label": "목록", "value": "1, 2, 3", "description": "반복해서 처리할 숫자들입니다."}, {"label": "반복", "value": "for number in numbers:", "description": "목록에서 숫자를 하나씩 꺼냅니다."}, {"label": "출력", "value": "1 · 2 · 3", "description": "각 숫자를 차례대로 출력합니다."}],
            "challenge": "숫자 1, 2, 3을 차례대로 출력하는 기능에서 목록, 반복하는 코드, 결과는 무엇인가요?",
            "prompts": [{"field": "input", "label": "목록: 반복해서 처리할 값", "placeholder": "예: 숫자 1, 2, 3"}, {"field": "process", "label": "코드: 목록을 차례로 처리하는 방법", "placeholder": "예: for 반복문으로 하나씩 꺼낸다"}, {"field": "output", "label": "결과: 화면에 나타날 값", "placeholder": "예: 1, 2, 3"}],
        },
    },
]


def upgrade() -> None:
    courses = sa.table("courses", sa.column("id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("description", sa.Text()), sa.column("order_index", sa.Integer()))
    concepts = sa.table("concepts", sa.column("id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("name", sa.String()), sa.column("description", sa.Text()))
    lessons = sa.table("lessons", sa.column("id", sa.Uuid()), sa.column("course_id", sa.Uuid()), sa.column("slug", sa.String()), sa.column("title", sa.String()), sa.column("summary", sa.Text()), sa.column("learning_objective", sa.Text()), sa.column("content", sa.JSON()), sa.column("order_index", sa.Integer()), sa.column("is_published", sa.Boolean()))
    lesson_concepts = sa.table("lesson_concepts", sa.column("lesson_id", sa.Uuid()), sa.column("concept_id", sa.Uuid()))
    op.bulk_insert(courses, [{"id": COURSE_ID, "slug": "python-basics", "title": "파이썬 첫걸음", "description": "파이썬 코드로 출력, 변수, 계산, 입력, 조건, 반복을 직접 익힙니다.", "order_index": 2}])
    op.bulk_insert(concepts, [{"id": UUID(item[0]), "slug": item[1], "name": item[2], "description": item[3]} for item in CONCEPTS])
    op.bulk_insert(lessons, [{"id": UUID(item["id"]), "course_id": COURSE_ID, "slug": item["slug"], "title": item["title"], "summary": item["summary"], "learning_objective": item["objective"], "content": item["content"], "order_index": item["order"], "is_published": True} for item in LESSONS])
    concept_ids = {item[1]: UUID(item[0]) for item in CONCEPTS}
    concept_ids.update({
        "variable": UUID("40000000-0000-4000-8000-000000000004"),
        "condition": UUID("40000000-0000-4000-8000-000000000005"),
        "loop": UUID("40000000-0000-4000-8000-000000000006"),
        "input": UUID("30000000-0000-4000-8000-000000000001"),
    })
    op.bulk_insert(lesson_concepts, [{"lesson_id": UUID(item["id"]), "concept_id": concept_ids[item["concept"]]} for item in LESSONS])


def downgrade() -> None:
    lesson_ids = ",".join(f"'{item['id']}'" for item in LESSONS)
    op.execute(f"DELETE FROM lesson_concepts WHERE lesson_id IN ({lesson_ids})")
    op.execute(f"DELETE FROM lessons WHERE id IN ({lesson_ids})")
    op.execute("DELETE FROM concepts WHERE slug IN ('print', 'expression')")
    op.execute("DELETE FROM courses WHERE slug = 'python-basics'")
