from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


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


class LearningEnrollmentCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    course_key: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9-]+$")
    project_id: UUID | None = None


class LearningJourneyUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    current_node_id: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9-]+$")
    active_bridge_id: str | None = Field(default=None, max_length=40, pattern=r"^[A-Za-z0-9-]+$")
    revision_id: UUID | None = None
    file_path: str | None = Field(default=None, min_length=1, max_length=240)
    cursor_line: int | None = Field(default=None, ge=1, le=1_000_000)

    @field_validator("file_path")
    @classmethod
    def safe_path(cls, value: str | None) -> str | None:
        if value is not None and (
            "\\" in value or ":" in value
            or any(part in {"", ".", ".."} for part in value.split("/"))
        ):
            raise ValueError("편집 파일은 안전한 상대 경로여야 합니다.")
        return value

    @model_validator(mode="after")
    def cursor_has_file(self) -> "LearningJourneyUpdateRequest":
        if self.cursor_line is not None and self.file_path is None:
            raise ValueError("커서 위치에는 파일 경로가 필요합니다.")
        return self


class LearningEnrollmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    course_key: str
    content_version: str
    rubric_version: str
    project_id: UUID | None
    status: str
    current_node_id: str | None
    active_bridge_id: str | None
    return_mission_id: str | None
    last_revision_id: UUID | None
    last_revision_hash: str | None
    last_file_path: str | None
    last_cursor_line: int | None
    return_revision_id: UUID | None
    return_revision_hash: str | None
    return_file_path: str | None
    return_cursor_line: int | None
    created_at: datetime
    updated_at: datetime


class LearningWorkSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=0)
    answers: dict[str, str] = Field(max_length=20)

    @field_validator("answers")
    @classmethod
    def bounded_answers(cls, value: dict[str, str]) -> dict[str, str]:
        if any(len(key) > 60 or len(text) > (32000 if key in {"source", "transfer_source", "api_source", "transfer_api_source", "baseline_source", "baseline_api_source"} else 4000) for key, text in value.items()):
            raise ValueError("코드는 32,000자, 나머지 작성 항목은 각각 4,000자 이하여야 합니다.")
        return value


class LearningWorkSubmitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1)


class LearningRunRequest(LearningWorkSubmitRequest):
    field: Literal["source", "transfer_source", "baseline_source"] = "source"


class LearningProjectRequest(LearningWorkSubmitRequest):
    field: Literal["source", "transfer_source"] = "source"


class LearningBridgeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["ENTER", "RETURN"]
    bridge_id: str | None = Field(default=None, max_length=40)
    revision_id: UUID | None = None
    file_path: str | None = Field(default=None, min_length=1, max_length=240)
    cursor_line: int | None = Field(default=None, ge=1, le=1_000_000)


class LearningProjectLinkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: UUID


class LearningPathSaveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=0)
    level: Literal["BEGINNER", "PRACTICED", "EXPERIENCED"] | None = None


class LearningProjectSyncRequest(LearningProjectRequest):
    expected_draft_version: int = Field(ge=0)
    expected_project_hash: str = Field(pattern=r"^[a-f0-9]{64}$")
    resolutions: dict[str, Literal["KEEP_PROJECT", "USE_LEARNING"]] = Field(default_factory=dict, max_length=4)
