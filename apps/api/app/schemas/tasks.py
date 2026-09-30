from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

TaskStatus = Literal["TODO", "IN_PROGRESS", "DONE"]
TaskPriority = Literal["LOW", "NORMAL", "HIGH", "URGENT"]


class ProjectTaskCreateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=2000)
    status: TaskStatus = "TODO"
    priority: TaskPriority = "NORMAL"
    due_date: date | None = None
    assignee_id: UUID | None = None

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("작업 제목을 입력해 주세요.")
        return normalized


class ProjectTaskUpdateRequest(ProjectTaskCreateRequest):
    pass


class ProjectTaskResponse(BaseModel):
    id: UUID
    project_id: UUID
    title: str
    description: str
    status: TaskStatus
    priority: TaskPriority
    due_date: date | None
    assignee_id: UUID | None
    created_by: UUID
    updated_by: UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TaskCommentCreateRequest(BaseModel):
    body: str = Field(min_length=1, max_length=2000)

    @field_validator("body")
    @classmethod
    def normalize_body(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("댓글 내용을 입력해 주세요.")
        return normalized


class TaskCommentResponse(BaseModel):
    id: UUID
    task_id: UUID
    author_id: UUID | None
    author_name: str
    body: str
    created_at: datetime


class TaskActivityResponse(BaseModel):
    id: UUID
    task_id: UUID
    actor_id: UUID | None
    actor_name: str
    message: str
    created_at: datetime


class ProjectTaskActivityResponse(BaseModel):
    id: UUID
    task_id: UUID
    task_title: str
    actor_id: UUID | None
    actor_name: str
    message: str
    created_at: datetime


class TaskDiscussionResponse(BaseModel):
    comments: list[TaskCommentResponse]
    activities: list[TaskActivityResponse]


class TaskChecklistItemCreateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=240)

    @field_validator("text")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("체크 항목을 입력해 주세요.")
        return normalized


class TaskChecklistItemUpdateRequest(BaseModel):
    completed: bool


class TaskChecklistItemResponse(BaseModel):
    id: UUID
    task_id: UUID
    text: str
    position: int
    completed: bool
    completed_by: UUID | None
    completed_at: datetime | None
    created_by: UUID
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
