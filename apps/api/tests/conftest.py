import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.models.learning import Concept, Course, Lesson, LessonConcept


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    test_sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with test_sessions() as session:
        course = Course(
            slug="software-basics",
            title="소프트웨어의 흐름",
            description="첫 수업",
            order_index=1,
        )
        session.add(course)
        session.flush()
        lesson = Lesson(
            course_id=course.id,
            slug="input-process-output",
            title="입력, 처리, 출력",
            summary="프로그램 흐름",
            learning_objective="입력과 출력을 구분합니다.",
            content={"scenario": "이름으로 인사합니다.", "steps": [], "challenge": "분류해 보세요.", "prompts": []},
            order_index=1,
            is_published=True,
        )
        session.add(lesson)
        concepts = [
            Concept(slug="input", name="입력", description="받는 값"),
            Concept(slug="process", name="처리", description="수행하는 작업"),
            Concept(slug="output", name="출력", description="보여주는 결과"),
        ]
        session.add_all(concepts)
        session.flush()
        session.add_all([LessonConcept(lesson_id=lesson.id, concept_id=concept.id) for concept in concepts])
        session.commit()

    def override_get_db():
        with test_sessions() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()
