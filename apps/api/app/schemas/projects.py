from datetime import datetime
from pathlib import PurePosixPath
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ProjectCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Project name must not be blank")
        return normalized


class ProjectFileInput(BaseModel):
    path: str = Field(min_length=1, max_length=240)
    content: str = Field(max_length=200_000)

    @field_validator("path")
    @classmethod
    def validate_path(cls, value: str) -> str:
        normalized = value.replace("\\", "/")
        path = PurePosixPath(normalized)
        if (
            normalized.startswith("/")
            or "\x00" in normalized
            or any(part in ("", ".", "..") for part in normalized.split("/"))
            or path.is_absolute()
        ):
            raise ValueError("File path must be a safe relative path")
        return normalized


class SaveDraftRequest(BaseModel):
    expected_version: int = Field(ge=0)
    files: list[ProjectFileInput] = Field(min_length=1, max_length=50)


class ProjectFileResponse(BaseModel):
    path: str
    content: str


class ProjectRevisionResponse(BaseModel):
    id: UUID
    revision_number: int
    parent_revision_id: UUID | None
    source_hash: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProjectSummaryResponse(BaseModel):
    id: UUID
    name: str
    description: str
    draft_version: int
    updated_at: datetime


class ProjectWorkspaceResponse(ProjectSummaryResponse):
    files: list[ProjectFileResponse]
    revisions: list[ProjectRevisionResponse]


class DraftSavedResponse(BaseModel):
    project_id: UUID
    draft_version: int
    updated_at: datetime


class CreateRevisionResponse(BaseModel):
    revision: ProjectRevisionResponse
    created: bool
