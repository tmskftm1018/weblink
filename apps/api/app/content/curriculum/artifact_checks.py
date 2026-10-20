"""Trusted checks for structured planning artifacts, never learner code execution.

Free text checks establish presence only. They do not claim to judge writing quality.
"""

from app.content.curriculum.html_form_checks import check_html

M01_FIELDS = [
    {"id": "goal", "label": "이번에 만들고 싶은 게시판", "kind": "text", "placeholder": "누가 어떤 목적으로 쓸 게시판인가요?", "min_length": 10},
    {"id": "experience", "label": "현재 경험", "kind": "choice", "choices": ["처음 배워요", "조금 만들어 봤어요", "직접 프로젝트를 해봤어요"]},
    {"id": "help_mode", "label": "원하는 도움 방식", "kind": "choice", "choices": ["WebLink 설명과 힌트", "AI 웹사이트도 함께", "AI CLI도 함께"]},
    {"id": "prediction", "label": "저장하고 돌아오면 남아 있어야 할 것", "kind": "text", "min_length": 10},
    {"id": "diagnostic_input", "label": "게시글 제목을 적는 행동은?", "kind": "choice", "choices": ["입력", "처리", "출력"]},
    {"id": "diagnostic_validation", "label": "공백만 입력했을 때 적절한 처리는?", "kind": "choice", "choices": ["빈 제목을 거부한다", "그대로 저장한다", "사용자를 로그아웃시킨다"]},
    {"id": "diagnostic_storage", "label": "새로고침 후에도 글이 남으려면?", "kind": "choice", "choices": ["데이터를 저장하고 다시 읽는다", "버튼 색을 바꾼다", "제목 크기를 키운다"]},
]
M02_FIELDS = [
    {"id": "requirement_create", "label": "요구사항 1 · 글 등록", "kind": "text", "placeholder": "사용자가 무엇을 할 수 있어야 하나요?", "min_length": 10},
    {"id": "acceptance_create", "label": "글 등록을 확인할 조건", "kind": "text", "placeholder": "정상 입력과 빈 입력에서 각각 무엇을 확인하나요?", "min_length": 10},
    {"id": "requirement_list", "label": "요구사항 2 · 목록 보기", "kind": "text", "min_length": 10},
    {"id": "acceptance_list", "label": "목록 보기를 확인할 조건", "kind": "text", "min_length": 10},
    {"id": "ui_role", "label": "화면(UI)의 책임", "kind": "choice", "choices": ["입력을 받고 결과를 보여 준다", "DB 비밀번호를 보관한다", "DB를 직접 수정한다"]},
    {"id": "api_role", "label": "API의 책임", "kind": "choice", "choices": ["요청을 검사하고 DB와 통신한다", "버튼의 색만 결정한다", "브라우저 비밀번호를 화면에 보여 준다"]},
    {"id": "db_role", "label": "DB의 책임", "kind": "choice", "choices": ["데이터를 저장하고 조회한다", "클릭 이벤트를 받는다", "HTML 버튼을 그린다"]},
    {"id": "request_data", "label": "UI → API · 보내는 값", "kind": "text", "placeholder": "예: 제목, 내용. 본인 게시판에 맞게 구체적으로 적으세요.", "min_length": 4},
    {"id": "response_data", "label": "API → UI · 돌아오는 값과 화면 변화", "kind": "text", "min_length": 10},
    {"id": "prediction", "label": "API를 거치지 않고 DB에 직접 접근하면 생길 문제", "kind": "text", "min_length": 10},
]
M03_FIELDS = [
    {"id": "source", "label": "게시글 폼 · index.html", "kind": "code", "min_length": 20},
    {"id": "prediction", "label": "label을 연결하면 무엇이 달라질까요?", "kind": "text", "min_length": 8},
    {"id": "observation", "label": "미리보기에서 label 클릭과 Tab 이동을 확인한 결과", "kind": "text", "min_length": 10},
]
M04_FIELDS = [
    {"id": "source", "label": "폼 제출 처리 · main.js", "kind": "code", "min_length": 20},
    {"id": "prediction", "label": "빈 값·공백·정상 제목에서 예상하는 저장 호출과 오류 안내", "kind": "text", "min_length": 10},
    {"id": "observation", "label": "실행 결과에서 확인한 차이와 수정한 이유", "kind": "text", "min_length": 10},
]
def code_fields(label: str, transfer: bool = False) -> list[dict]:
    fields = [
        {"id": "source", "label": label, "kind": "code", "min_length": 20},
        {"id": "prediction", "label": "실행 전에 예상하는 결과와 이유", "kind": "text", "min_length": 10},
        {"id": "observation", "label": "실행에서 실제로 관찰한 결과와 수정한 점", "kind": "text", "min_length": 10},
    ]
    if transfer:
        fields.extend([
            {"id": "transfer_source", "label": "다른 문제에 적용하기 · 전이 과제", "kind": "code", "min_length": 20},
            {"id": "transfer_explanation", "label": "새 문제에서 유지한 규칙과 바꾼 부분", "kind": "text", "min_length": 10},
        ])
    return fields


FIELD_MAP = {"M01": M01_FIELDS, "M02": M02_FIELDS, "M03": M03_FIELDS, "M04": M04_FIELDS,
             "M05": code_fields("React 게시글 목록 · App.jsx", True),
             "M06": code_fields("GET 게시글 목록 · main.py"),
             "M07": code_fields("POST 입력 검증 · main.py", True),
             "M08": code_fields("SQLite 저장·조회 · main.py"),
             "M09": code_fields("SQLite API · main.py")}
FIELD_MAP["M10"] = code_fields("게시판 React · App.jsx", True)
FIELD_MAP["M10"].insert(1, {"id": "api_source", "label": "게시판 API · main.py · React와 함께 실행", "kind": "code", "min_length": 20})
FIELD_MAP["M10"].insert(5, {"id": "transfer_api_source", "label": "재고 API · main.py · 전이 React와 함께 실행", "kind": "code", "min_length": 20})
for field in FIELD_MAP["M10"]:
    if field["kind"] == "code":
        field.update({"language": "python" if "api_source" in field["id"] else "jsx", "filename": "main.py" if "api_source" in field["id"] else "App.jsx", "run_field": "transfer_source" if field["id"].startswith("transfer_") else "source"})
FIELD_MAP["M11"] = [
    {"id": "baseline_source", "label": "실패 재현 · App.jsx", "kind": "code", "min_length": 20},
    {"id": "baseline_api_source", "label": "실패 재현 · main.py", "kind": "code", "min_length": 20},
    {"id": "reproduction", "label": "실패를 재현한 입력·절차·실제 오류", "kind": "text", "min_length": 20},
    {"id": "hypothesis", "label": "예상한 원인과 확인할 근거", "kind": "text", "min_length": 15},
    {"id": "source", "label": "수정 후 · App.jsx", "kind": "code", "min_length": 20},
    {"id": "api_source", "label": "수정 후 · main.py", "kind": "code", "min_length": 20},
    {"id": "change_reason", "label": "변경한 부분과 변경 이유", "kind": "text", "min_length": 20},
    {"id": "observation", "label": "수정 전후 실행 결과에서 확인한 차이", "kind": "text", "min_length": 20},
]
FIELD_MAP["M12"] = code_fields("메모장 · App.jsx", True)
FIELD_MAP["M12"].insert(1, {"id": "api_source", "label": "메모 API · main.py", "kind": "code", "min_length": 20})
FIELD_MAP["M12"].insert(5, {"id": "transfer_api_source", "label": "할 일 API · main.py", "kind": "code", "min_length": 20})
FIELD_MAP["M12"].extend([
    {"id": "requirement_create", "label": "요구사항 1 · 메모 등록과 확인 조건", "kind": "text", "min_length": 20},
    {"id": "requirement_restore", "label": "요구사항 2 · 저장 목록 복원과 확인 조건", "kind": "text", "min_length": 20},
    {"id": "architecture_explanation", "label": "UI·API·DB의 책임과 실제 실행 근거", "kind": "text", "min_length": 30},
])
for mission in ["M11", "M12"]:
    for field in FIELD_MAP[mission]:
        if field["kind"] == "code":
            field.update({"language": "python" if "api_source" in field["id"] else "jsx", "filename": "main.py" if "api_source" in field["id"] else "App.jsx", "run_field": "baseline_source" if field["id"].startswith("baseline_") else "transfer_source" if field["id"].startswith("transfer_") else "source"})
SUPPORTED_MISSIONS = frozenset(FIELD_MAP)
ROLE_ANSWERS = {"ui_role": "입력을 받고 결과를 보여 준다", "api_role": "요청을 검사하고 DB와 통신한다", "db_role": "데이터를 저장하고 조회한다"}
DIAGNOSTIC_ANSWERS = {"diagnostic_input": "입력", "diagnostic_validation": "빈 제목을 거부한다", "diagnostic_storage": "데이터를 저장하고 다시 읽는다"}


def diagnostic_recommendation(answers: dict[str, str]) -> dict:
    missed = [key for key, answer in DIAGNOSTIC_ANSWERS.items() if answers.get(key) != answer]
    return {
        "foundation_ids": ["C00", "C02", "C04"] if missed else [],
        "message": "입력·조건·함수 설명부터 살펴보세요. 진단 결과는 완료 판정에 감점하지 않아요." if missed else "핵심 흐름을 알고 있어요. 필요한 설명만 골라 보고 같은 미션을 진행하세요.",
    }


def fields_for(node: dict) -> list[dict]:
    return FIELD_MAP.get(node["id"], [
        {"id": "prediction", "label": node["prediction"], "kind": "text", "min_length": 4},
        {"id": "observation", "label": "확인한 결과를 내 말로 적기", "kind": "text", "min_length": 8},
    ])


def evaluate(node: dict, answers: dict[str, str], *, reopened: bool) -> dict:
    issues: dict[str, str] = {}
    for field in fields_for(node):
        value = answers.get(field["id"], "").strip()
        if field["kind"] == "choice":
            if value not in field["choices"]:
                issues[field["id"]] = "보기에서 하나를 선택해 주세요."
        elif len(value) < field.get("min_length", 1):
            issues[field["id"]] = f"{field.get('min_length', 1)}자 이상으로 구체적으로 적어 주세요."
    if answers.get("concept_answer") != node["concept_check"]["answer"]:
        issues["concept_answer"] = "설명과 관찰 결과를 다시 보고 개념 질문을 확인해 주세요."
    if node["id"] == "M01" and not reopened:
        issues["reopen"] = "먼저 초안을 저장한 뒤 ‘저장본 다시 열기’로 서버에서 불러와 주세요."
    if node["id"] == "M02":
        for key, correct in ROLE_ANSWERS.items():
            if answers.get(key) != correct:
                issues[key] = "UI, API, DB가 각각 맡는 책임을 다시 살펴보세요."
        if answers.get("requirement_create", "").strip() == answers.get("requirement_list", "").strip():
            issues["requirement_list"] = "등록과 목록 보기의 요구사항을 구분해서 작성해 주세요."
    recommendation = None
    checks = []
    if node["id"] == "M03":
        checks = check_html(answers.get("source", ""))
        if any(not check["passed"] for check in checks):
            issues["source"] = "HTML 구조 검사에서 확인할 항목이 있어요. 아래 항목별 안내를 살펴보세요."
    if node["id"] == "M01":
        recommendation = diagnostic_recommendation(answers)
    return {
        "passed": not issues,
        "issues": issues,
        "recommendation": recommendation,
        "checks": checks,
        "scope": "HTML 구조와 label 연결, 작성 항목과 개념 답안을 검사합니다. 실제 브라우저의 초점 이동·접근성 전체를 자동 검증한 결과는 아닙니다." if node["id"] == "M03" else "작성 항목, 역할 선택과 개념 답안을 검사합니다. 자유 서술의 설계 품질을 자동 평가한 결과는 아닙니다.",
    }
