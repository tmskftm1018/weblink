from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ConceptResponse(BaseModel):
    slug: str
    name: str
    description: str


class LessonSummaryResponse(BaseModel):
    id: UUID
    slug: str
    title: str
    summary: str
    order_index: int
    status: str


class CourseResponse(BaseModel):
    slug: str
    title: str
    description: str
    completed_lessons: int
    total_lessons: int
    lessons: list[LessonSummaryResponse]


class LessonResponse(BaseModel):
    id: UUID
    slug: str
    title: str
    summary: str
    learning_objective: str
    content: dict
    concepts: list[ConceptResponse]
    status: str
    attempts_count: int


class LessonAttemptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input: str = Field(min_length=1, max_length=300)
    process: str = Field(min_length=1, max_length=16_384)
    output: str = Field(min_length=1, max_length=300)


class FieldFeedback(BaseModel):
    correct: bool
    message: str


class LessonAttemptResponse(BaseModel):
    completed: bool
    status: str
    attempts_count: int
    feedback: dict[str, FieldFeedback]
