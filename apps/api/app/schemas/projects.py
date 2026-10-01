from datetime import datetime
import re
from pathlib import PurePosixPath
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

_EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


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


class ProjectUpdateRequest(ProjectCreateRequest):
    pass


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


class ProjectFileImportRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    file: ProjectFileInput


class ProjectFilesImportRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    files: list[ProjectFileInput] = Field(min_length=1, max_length=50)


class SaveDraftRequest(BaseModel):
    expected_version: int = Field(ge=0)
    files: list[ProjectFileInput] = Field(min_length=1, max_length=50)


class ProjectGitHubSourceResponse(BaseModel):
    connected: bool
    token_connected: bool = False
    status_message: str | None = None
    repository_url: str | None = None
    branch: str | None = None
    is_private: bool = False
    imported_sha: str | None = None
    latest_sha: str | None = None
    update_available: bool = False


class ProjectGitHubPullRequest(BaseModel):
    expected_draft_version: int = Field(ge=0)


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
    role: Literal['OWNER', 'EDITOR', 'VIEWER']


class ProjectWorkspaceResponse(ProjectSummaryResponse):
    files: list[ProjectFileResponse]
    revisions: list[ProjectRevisionResponse]


class ProjectGitHubPullResponse(BaseModel):
    workspace: ProjectWorkspaceResponse
    imported_sha: str
    backup_version_name: str | None = None


class DraftSavedResponse(BaseModel):
    project_id: UUID
    draft_version: int
    updated_at: datetime


class CreateRevisionResponse(BaseModel):
    revision: ProjectRevisionResponse
    created: bool


class ProjectMemberAddRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: Literal['EDITOR', 'VIEWER'] = 'EDITOR'

    @field_validator('email')
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not _EMAIL_PATTERN.fullmatch(normalized):
            raise ValueError('Enter a valid email address')
        return normalized


class ProjectMemberRoleUpdateRequest(BaseModel):
    role: Literal['EDITOR', 'VIEWER']


class ProjectInvitationCreateRequest(ProjectMemberAddRequest):
    pass


class ProjectInvitationCreateResponse(BaseModel):
    token: str
    email: str
    project_name: str
    expires_at: datetime
    email_status: Literal['sent', 'not_configured', 'failed'] = 'not_configured'


class ProjectInvitationResponse(BaseModel):
    id: UUID
    email: str
    role: Literal['EDITOR', 'VIEWER']
    expires_at: datetime
    created_at: datetime
    status: Literal['PENDING', 'EXPIRED']


class ProjectInvitationAcceptRequest(BaseModel):
    token: str = Field(min_length=32, max_length=200)


class ProjectInvitationAcceptResponse(BaseModel):
    project_id: UUID
    project_name: str


class ProjectTeamActivityResponse(BaseModel):
    id: UUID
    project_id: UUID
    actor_id: UUID | None
    actor_name: str
    message: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProjectMemberResponse(BaseModel):
    user_id: UUID
    email: str
    display_name: str
    role: Literal['OWNER', 'EDITOR', 'VIEWER']
    created_at: datetime
