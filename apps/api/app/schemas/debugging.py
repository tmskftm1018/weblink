from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class DebugSessionCreate(BaseModel):
    hypothesis: str = Field(min_length=1, max_length=4000)
    expected_output: str = Field(default="", max_length=16_384)


class DebugSessionResponse(BaseModel):
    id: UUID
    project_id: UUID
    run_id: UUID
    hypothesis: str
    expected_output: str
    actual_output: str
    error_text: str
    logs: str
    status: Literal["OPEN", "RESOLVED"]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
