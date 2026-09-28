from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.projects import ProjectFileResponse


class RuntimeSpec(BaseModel):
    language: Literal["python"] = "python"
    version: Literal["3.12"] = "3.12"
    dependencies: list[str] = Field(default_factory=list, max_length=30)


class ProjectVersionCreate(BaseModel):
    revision_id: UUID
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=1000)
    runtime_spec: RuntimeSpec = Field(default_factory=RuntimeSpec)


class ProjectVersionResponse(BaseModel):
    id: UUID
    project_id: UUID
    version_number: int
    source_revision_id: UUID
    name: str
    description: str
    runtime_spec: RuntimeSpec
    created_at: datetime

    model_config = {"from_attributes": True}


class ProjectVersionDetailResponse(ProjectVersionResponse):
    files: list[ProjectFileResponse]


class VersionRestoreResponse(BaseModel):
    version: ProjectVersionResponse
    restored_revision_id: UUID
    restored_revision_number: int
    draft_version: int
