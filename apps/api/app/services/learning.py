import json
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.auth import User
from app.models.learning import LearningEvidence, LearningProgress
from app.repositories import learning as repository
from app.schemas.learning import (
    CourseResponse,
    FieldFeedback,
    LessonAttemptRequest,
    LessonAttemptResponse,
    LessonResponse,
    LessonSummaryResponse,
)
from app.state_machines.learning_progress import transition_progress

_CORRECT_MESSAGES = {
    "input": "맞아요. 프로그램이 처리할 값을 찾았습니다.",
    "process": "좋아요. 프로그램이 값을 다루는 방법을 설명했습니다.",
    "output": "맞아요. 프로그램이 보여주는 결과입니다.",
}
_HINTS = {
    "input": "힌트: 프로그램이 확인하거나 처리할 재료와 상황은 무엇인가요?",
    "process": "힌트: 프로그램이 값을 저장하거나, 조건을 확인하거나, 반복하는 방법은 무엇인가요?",
    "output": "힌트: 처리가 끝난 뒤 화면에 보이는 결과는 무엇인가요?",
}
_BLOCK_ANSWERS = {
    "print-output": (["print", "message", "close"], "print('안녕, 세계!')", "안녕, 세계!"),
    "python-variables": (["assign", "seven", "print-score"], "score = 7\nprint(score)", "7"),
    "simple-calculations": (["total", "sum", "print-total"], "total = 2 + 3\nprint(total)", "5"),
    "reading-input": (
        ["input-start", "input-prompt", "input-close", "greet"],
        "name = input('이름을 입력하세요: ')\nprint('안녕, ' + name)",
        "이름 입력 후 인사말 출력",
    ),
    "if-conditions": (
        ["score-check", "pass-output"],
        "score = 80\nif score >= 60:\n    print('합격')",
        "합격",
    ),
    "for-loops": (
        ["for-list", "print-number"],
        "for number in [1, 2, 3]:\n    print(number)",
        "1, 2, 3",
    ),
    "sqlite-database": (
        ["import-sqlite", "connect-sqlite", "create-table", "insert-row", "select-row", "display-row"],
        "import sqlite3\n"
        "connection = sqlite3.connect(':memory:')\n"
        "connection.execute('CREATE TABLE students (name TEXT, score INTEGER)')\n"
        "connection.execute(\"INSERT INTO students VALUES ('민지', 95)\")\n"
        "student = connection.execute('SELECT name, score FROM students').fetchone()\n"
        "print(f'{student[0]}: {student[1]}')",
        "민지: 95",
    ),
    "persistent-sqlite": (
        ["import-sqlite", "open-project-db", "create-table", "insert-once", "select-student", "display-student"],
        "import sqlite3\n"
        "connection = sqlite3.connect('/data/students.db')\n"
        "connection.execute('CREATE TABLE IF NOT EXISTS students (name TEXT PRIMARY KEY, score INTEGER)')\n"
        "connection.execute(\"INSERT OR IGNORE INTO students VALUES ('민지', 95)\")\n"
        "student = connection.execute(\"SELECT name, score FROM students WHERE name = '민지'\").fetchone()\n"
        "print(f'{student[0]}: {student[1]}')\n"
        "connection.close()",
        "민지: 95",
    ),
    "api-json-basics": (
        ["import-helper", "request-student", "show-student"],
        "from weblink_api import get_json\n"
        "student = get_json('/students/1')\n"
        "print(f\"{student['name']}: {student['score']}\")",
        "민지: 95",
    ),
    "api-send-data": (
        ["import-post", "prepare-student", "send-student", "show-created"],
        "from weblink_api import post_json\n"
        "student_data = {'name': '서준', 'score': 88}\n"
        "result = post_json('/students', student_data)\n"
        "student = result['student']\n"
        "print(f\"저장 완료: {student['name']}\")",
        "저장 완료: 서준",
    ),
    "api-to-database": (
        ["import-sqlite", "import-api", "open-db", "create-table", "request-api", "save-api-data", "read-saved-data", "show-saved"],
        "import sqlite3\n"
        "from weblink_api import get_json\n"
        "connection = sqlite3.connect('/data/students.db')\n"
        "connection.execute('CREATE TABLE IF NOT EXISTS api_students (id INTEGER PRIMARY KEY, name TEXT, score INTEGER)')\n"
        "student = get_json('/students/1')\n"
        "connection.execute('INSERT OR REPLACE INTO api_students VALUES (?, ?, ?)', (student['id'], student['name'], student['score']))\n"
        "saved_student = connection.execute('SELECT name, score FROM api_students WHERE id = ?', (student['id'],)).fetchone()\n"
        "print(f'{saved_student[0]}: {saved_student[1]}')\n"
        "connection.close()",
        "민지: 95",
    ),
    "api-error-handling": (
        ["import-api", "try-request", "handle-not-found"],
        "from weblink_api import get_json\n"
        "try:\n"
        "    get_json('/students/999')\n"
        "except ValueError:\n"
        "    print('학생 정보를 찾지 못했습니다.')",
        "학생 정보를 찾지 못했습니다.",
    ),
    "api-batch-import": (
        ["import-sqlite", "import-api", "open-db", "create-table", "request-list", "loop-store", "commit", "count-students", "display-count"],
        "import sqlite3\n"
        "from weblink_api import get_json\n"
        "connection = sqlite3.connect('/data/students.db')\n"
        "connection.execute('CREATE TABLE IF NOT EXISTS imported_students (id INTEGER PRIMARY KEY, name TEXT, score INTEGER)')\n"
        "response = get_json('/students')\n"
        "for student in response['students']:\n"
        "    connection.execute('INSERT OR REPLACE INTO imported_students VALUES (?, ?, ?)', (student['id'], student['name'], student['score']))\n"
        "connection.commit()\n"
        "count = connection.execute('SELECT COUNT(*) FROM imported_students').fetchone()[0]\n"
        "print(f'저장한 학생 수: {count}')\n"
        "connection.close()",
        "저장한 학생 수: 3",
    ),
    "api-filter-import": (
        ["import-sqlite", "import-api", "open-db", "create-table", "request-list", "loop-filter-store", "commit", "count-qualified", "display-qualified"],
        "import sqlite3\n"
        "from weblink_api import get_json\n"
        "connection = sqlite3.connect('/data/students.db')\n"
        "connection.execute('CREATE TABLE IF NOT EXISTS high_scores (id INTEGER PRIMARY KEY, name TEXT, score INTEGER)')\n"
        "response = get_json('/students')\n"
        "for student in response['students']:\n"
        "    if student['score'] >= 90:\n"
        "        connection.execute('INSERT OR REPLACE INTO high_scores VALUES (?, ?, ?)', (student['id'], student['name'], student['score']))\n"
        "connection.commit()\n"
        "count = connection.execute('SELECT COUNT(*) FROM high_scores').fetchone()[0]\n"
        "print(f'90점 이상 학생: {count}')\n"
        "connection.close()",
        "90점 이상 학생: 2",
    ),
    "api-update-resource": (
        ["import-put", "prepare-student", "update-student", "show-updated"],
        "from weblink_api import put_json\n"
        "student_data = {'id': 1, 'name': '민지', 'score': 100}\n"
        "result = put_json('/students/1', student_data)\n"
        "student = result['student']\n"
        "print(f\"수정 완료: {student['name']} {student['score']}점\")",
        "수정 완료: 민지 100점",
    ),
    "api-query-filter": (
        ["import-api", "request-filtered", "get-students", "extract-names", "show-names"],
        "from weblink_api import get_json\n"
        "response = get_json('/students?minimum_score=90')\n"
        "students = response['students']\n"
        "names = [student['name'] for student in students]\n"
        "print(f\"90점 이상: {', '.join(names)}\")",
        "90점 이상: 민지, 지우",
    ),
    "api-create-and-save": (
        ["import-sqlite", "import-post", "open-db", "create-table", "send-student", "get-student", "save-created", "commit", "read-created", "show-created"],
        "import sqlite3\n"
        "from weblink_api import post_json\n"
        "connection = sqlite3.connect('/data/students.db')\n"
        "connection.execute('CREATE TABLE IF NOT EXISTS created_students (id INTEGER PRIMARY KEY, name TEXT, score INTEGER)')\n"
        "result = post_json('/students', {'name': '서준', 'score': 88})\n"
        "student = result['student']\n"
        "connection.execute('INSERT OR REPLACE INTO created_students VALUES (?, ?, ?)', (student['id'], student['name'], student['score']))\n"
        "connection.commit()\n"
        "saved_student = connection.execute('SELECT id, name FROM created_students WHERE id = ?', (student['id'],)).fetchone()\n"
        "print(f'API 번호 {saved_student[0]}: {saved_student[1]}')\n"
        "connection.close()",
        "API 번호 4: 서준",
    ),
    "api-pagination": (
        ["import-api", "request-first", "request-next", "combine-pages", "show-total"],
        "from weblink_api import get_json\n"
        "first_page = get_json('/students?limit=2&offset=0')\n"
        "next_page = get_json('/students?limit=2&offset=2')\n"
        "students = first_page['students'] + next_page['students']\n"
        "print(f\"전체 {first_page['total']}명 중 {len(students)}명 받아오기\")",
        "전체 3명 중 3명 받아오기",
    ),
    "api-delete-sync": (
        ["import-sqlite", "import-api-tools", "open-db", "create-table", "request-list", "import-all", "commit-import", "delete-remote", "delete-local", "commit-delete", "count-api", "count-db", "show-counts"],
        "import sqlite3\n"
        "from weblink_api import delete_json, get_json\n"
        "connection = sqlite3.connect('/data/students.db')\n"
        "connection.execute('CREATE TABLE IF NOT EXISTS imported_students (id INTEGER PRIMARY KEY, name TEXT, score INTEGER)')\n"
        "response = get_json('/students')\n"
        "for student in response['students']:\n"
        "    connection.execute('INSERT OR REPLACE INTO imported_students VALUES (?, ?, ?)', (student['id'], student['name'], student['score']))\n"
        "connection.commit()\n"
        "delete_json('/students/3')\n"
        "connection.execute('DELETE FROM imported_students WHERE id = ?', (3,))\n"
        "connection.commit()\n"
        "api_count = len(get_json('/students')['students'])\n"
        "db_count = connection.execute('SELECT COUNT(*) FROM imported_students').fetchone()[0]\n"
        "print(f'API/DB 남은 학생: {api_count}/{db_count}')\n"
        "connection.close()",
        "API/DB 남은 학생: 2/2",
    ),
    "api-retry-transient": (
        ["import-retry", "initialize", "retry-request", "show-retried"],
        "from weblink_api import APIResponseError, get_json\n"
        "student = None\n"
        "for _attempt in range(3):\n"
        "    try:\n"
        "        student = get_json('/retry-once')\n"
        "        break\n"
        "    except APIResponseError as error:\n"
        "        if error.status_code != 503:\n"
        "            raise\n"
        "if student:\n"
        "    print(f\"다시 연결: {student['name']}\")",
        "다시 연결: 민지",
    ),
    "broker-connection-status": (
        ["import-api", "request-connection", "check-status", "show-permissions"],
        "from weblink_api import get_json\n"
        "connection = get_json('/connections/team-calendar')\n"
        "if connection['status'] == 'connected':\n"
        "    print(f\"연결 확인: {connection['name']} ({', '.join(connection['scopes'])})\")",
        "연결 확인: team-calendar (events.read)",
    ),
    "broker-read-events": (
        ["import-api", "request-events", "get-events", "show-event-count"],
        "from weblink_api import get_json\n"
        "response = get_json('/connections/team-calendar/events')\n"
        "events = response['events']\n"
        "print(f'연결된 일정: {len(events)}개')",
        "연결된 일정: 3개",
    ),
    "broker-sync-events": (
        ["import-sqlite", "import-api", "open-db", "create-table", "request-events", "sync-confirmed", "commit", "count-events", "show-count", "close-db"],
        "import sqlite3\n"
        "from weblink_api import get_json\n"
        "connection = sqlite3.connect('/data/students.db')\n"
        "connection.execute('CREATE TABLE IF NOT EXISTS calendar_events (id INTEGER PRIMARY KEY, title TEXT)')\n"
        "response = get_json('/connections/team-calendar/events')\n"
        "for event in response['events']:\n"
        "    if event['status'] == 'confirmed':\n"
        "        connection.execute('INSERT OR REPLACE INTO calendar_events VALUES (?, ?)', (event['id'], event['title']))\n"
        "connection.commit()\n"
        "count = connection.execute('SELECT COUNT(*) FROM calendar_events').fetchone()[0]\n"
        "print(f'확정 일정 동기화: {count}개')\n"
        "connection.close()",
        "확정 일정 동기화: 2개",
    ),
}


def list_courses(db: Session, user: User) -> list[CourseResponse]:
    responses = []
    for course in repository.list_courses(db):
        lessons = repository.list_lessons(db, course.id)
        progress = {
            item.lesson_id: item
            for item in repository.list_user_progress(db, user.id, [lesson.id for lesson in lessons])
        }
        lesson_responses = [
            LessonSummaryResponse(
                id=lesson.id,
                slug=lesson.slug,
                title=lesson.title,
                summary=lesson.summary,
                order_index=lesson.order_index,
                status=progress[lesson.id].status if lesson.id in progress else "NOT_STARTED",
            )
            for lesson in lessons
        ]
        responses.append(
            CourseResponse(
                slug=course.slug,
                title=course.title,
                description=course.description,
                completed_lessons=sum(lesson.status == "COMPLETED" for lesson in lesson_responses),
                total_lessons=len(lesson_responses),
                lessons=lesson_responses,
            )
        )
    return responses


def get_lesson(db: Session, user: User, course_slug: str, lesson_slug: str) -> LessonResponse | None:
    course = repository.get_course_by_slug(db, course_slug)
    if course is None:
        return None
    lesson = repository.get_lesson_by_slug(db, course.id, lesson_slug)
    if lesson is None:
        return None
    progress = repository.get_user_progress(db, user.id, lesson.id)
    return LessonResponse(
        id=lesson.id,
        slug=lesson.slug,
        title=lesson.title,
        summary=lesson.summary,
        learning_objective=lesson.learning_objective,
        content=lesson.content,
        concepts=[
            {"slug": concept.slug, "name": concept.name, "description": concept.description}
            for concept in sorted(
                repository.list_lesson_concepts(db, lesson.id),
                key=lambda concept: {"input": 0, "process": 1, "output": 2}.get(concept.slug, 99),
            )
        ],
        status=progress.status if progress else "NOT_STARTED",
        attempts_count=progress.attempts_count if progress else 0,
    )


def _is_correct(field: str, answer: str) -> bool:
    normalized = " ".join(answer.lower().split())
    if field == "input":
        return any(token in normalized for token in ("이름", "민지", "name"))
    if field == "process":
        return any(token in normalized for token in ("붙", "연결", "합치", "결합", "조합", "combine", "concatenate"))
    return "안녕" in normalized and "민지" in normalized


def _is_lesson_answer_correct(lesson_slug: str, field: str, answer: str) -> bool:
    normalized = " ".join(answer.lower().split())
    if lesson_slug in _BLOCK_ANSWERS:
        block_order, source_code, target_output = _BLOCK_ANSWERS[lesson_slug]
        if field == "input":
            try:
                return json.loads(answer) == block_order
            except json.JSONDecodeError:
                return False
        if field == "process":
            return answer.replace("\r\n", "\n").strip() == source_code
        return answer.strip() == target_output
    if lesson_slug == "variables-and-values":
        checks = {
            "input": lambda: "10" in normalized,
            "process": lambda: any(token in normalized for token in ("변수", "저장", "담")),
            "output": lambda: "10" in normalized,
        }
    elif lesson_slug == "conditions-and-choices":
        checks = {
            "input": lambda: any(token in normalized for token in ("비", "날씨", "비가")),
            "process": lambda: any(token in normalized for token in ("조건", "확인", "따르")),
            "output": lambda: "우산" in normalized,
        }
    elif lesson_slug == "repeat-with-loops":
        checks = {
            "input": lambda: any(token in normalized for token in ("사과", "바나나", "포도", "과일")),
            "process": lambda: any(token in normalized for token in ("반복", "하나씩", "순회", "차례")),
            "output": lambda: all(token in normalized for token in ("사과", "바나나", "포도")),
        }
    elif lesson_slug == "print-output":
        checks = {
            "input": lambda: "안녕" in normalized and "세계" in normalized,
            "process": lambda: "print" in normalized,
            "output": lambda: "안녕" in normalized and "세계" in normalized,
        }
    elif lesson_slug == "python-variables":
        checks = {
            "input": lambda: "7" in normalized,
            "process": lambda: "score" in normalized and any(token in normalized for token in ("=", "저장", "대입")),
            "output": lambda: "7" in normalized,
        }
    elif lesson_slug == "simple-calculations":
        checks = {
            "input": lambda: "2" in normalized and "3" in normalized,
            "process": lambda: any(token in normalized for token in ("+", "더하", "합")),
            "output": lambda: "5" in normalized,
        }
    elif lesson_slug == "reading-input":
        checks = {
            "input": lambda: any(token in normalized for token in ("이름", "지민", "name")),
            "process": lambda: "input" in normalized,
            "output": lambda: "안녕" in normalized and any(token in normalized for token in ("지민", "이름", "name")),
        }
    elif lesson_slug == "if-conditions":
        checks = {
            "input": lambda: any(token in normalized for token in ("80", "점수", "score")),
            "process": lambda: "if" in normalized or "조건" in normalized,
            "output": lambda: "합격" in normalized,
        }
    elif lesson_slug == "for-loops":
        checks = {
            "input": lambda: any(token in normalized for token in ("1", "숫자", "목록")),
            "process": lambda: any(token in normalized for token in ("for", "반복", "하나씩")),
            "output": lambda: all(token in normalized for token in ("1", "2", "3")),
        }
    else:
        return _is_correct(field, answer)
    return checks[field]()


def _block_order_hint(lesson: object, lesson_slug: str, answer: str, attempts_count: int) -> str:
    if attempts_count <= 1:
        return "힌트: 블록 설명을 읽고, 도구 준비와 마지막 결과처럼 먼저 또는 나중에 필요한 일을 찾아보세요."

    expected_order = _BLOCK_ANSWERS[lesson_slug][0]
    try:
        selected_order = json.loads(answer)
    except json.JSONDecodeError:
        selected_order = []
    if not isinstance(selected_order, list):
        selected_order = []
    activity = getattr(lesson, "content", {}).get("block_activity", {})
    labels = {
        block.get("id"): block.get("label", "필요한")
        for block in activity.get("blocks", [])
        if isinstance(block, dict)
    }
    mismatch = next(
        (index for index, block_id in enumerate(expected_order)
         if index >= len(selected_order) or selected_order[index] != block_id),
        None,
    )
    if mismatch is None:
        return "힌트: 사용하지 않은 선택 블록이 있는지, 블록 설명과 코드 미리보기가 과제와 맞는지 확인해 보세요."
    required_label = labels.get(expected_order[mismatch], "필요한")
    current_label = labels.get(selected_order[mismatch]) if mismatch < len(selected_order) else None
    if current_label:
        return f"힌트: ‘{required_label}’ 블록이 ‘{current_label}’ 블록보다 먼저 와야 해요."
    return f"힌트: 다음으로 ‘{required_label}’ 블록을 추가해 보세요."


def submit_attempt(
    db: Session,
    user: User,
    lesson_id: UUID,
    attempt: LessonAttemptRequest,
) -> LessonAttemptResponse | None:
    lesson = repository.get_lesson(db, lesson_id)
    if lesson is None or not lesson.is_published:
        return None

    progress = repository.get_user_progress(db, user.id, lesson.id)
    now = datetime.now(UTC)
    if progress is None:
        progress = LearningProgress(
            user_id=user.id,
            lesson_id=lesson.id,
            status="NOT_STARTED",
            attempts_count=0,
            started_at=now,
        )
        repository.add_progress(db, progress)
    progress.attempts_count += 1

    answers = {key: getattr(attempt, key).strip() for key in ("input", "process", "output")}
    results = {key: _is_lesson_answer_correct(lesson.slug, key, answer) for key, answer in answers.items()}
    completed = all(results.values())
    target_status = "COMPLETED" if completed or progress.status == "COMPLETED" else "IN_PROGRESS"
    progress.status = transition_progress(progress.status, target_status)
    if completed and progress.completed_at is None:
        progress.completed_at = now

    repository.add_evidence(
        db,
        LearningEvidence(
            user_id=user.id,
            lesson_id=lesson.id,
            event_type="LESSON_ATTEMPT",
            payload={"answers": answers, "correct": results, "completed": completed},
        ),
    )
    repository.save(db)
    if lesson.slug in _BLOCK_ANSWERS:
        order_hint = _block_order_hint(lesson, lesson.slug, answers["input"], progress.attempts_count)
        if progress.attempts_count <= 1:
            source_hint = "힌트: 조립된 코드 미리보기를 위에서부터 읽으면서, 준비한 도구와 데이터 처리, 결과 출력이 이어지는지 확인해 보세요."
        elif "\n    " in _BLOCK_ANSWERS[lesson.slug][1]:
            source_hint = "힌트: 반복문이나 조건문 안에 들어가는 코드는 한 단계 들여써야 해요. 코드 미리보기에서 줄의 위치도 살펴보세요."
        else:
            source_hint = "힌트: 코드 미리보기에 필요한 준비, 처리, 마무리 코드가 모두 들어갔는지 블록 설명과 비교해 보세요."
        block_feedback = {
            "input": ("블록 순서가 목표와 맞아요.", order_hint),
            "process": ("조립된 파이썬 코드가 맞아요.", source_hint),
            "output": ("목표 결과를 확인했어요.", "목표 결과를 한 번 더 확인해 보세요."),
        }
    else:
        block_feedback = {}
    return LessonAttemptResponse(
        completed=completed,
        status=progress.status,
        attempts_count=progress.attempts_count,
        feedback={
            key: FieldFeedback(
                correct=correct,
                message=(
                    block_feedback[key][0 if correct else 1]
                    if lesson.slug in _BLOCK_ANSWERS
                    else _CORRECT_MESSAGES[key] if correct else _HINTS[key]
                ),
            )
            for key, correct in results.items()
        },
    )
