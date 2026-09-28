from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel


class RunCreateRequest(BaseModel):
    revision_id: UUID


class RunResponse(BaseModel):
    id: UUID
    project_id: UUID
    revision_id: UUID
    status: Literal[
        "QUEUED", "RUNNING", "SUCCEEDED", "FAILED",
    ]
    failure_category: str | None
    exit_code: int | None
    stdout: str
    stderr: str
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class RunListResponse(BaseModel):
    runs: list[RunResponse]
