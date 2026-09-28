from uuid import UUID

from pydantic import BaseModel, Field


class DebugHintRequest(BaseModel):
    hypothesis: str = Field(min_length=1, max_length=4000)
    expected_output: str = Field(default="", max_length=16_384)


class DebugHintResponse(BaseModel):
    conversation_id: UUID
    summary: str
    hint: str
    next_question: str
