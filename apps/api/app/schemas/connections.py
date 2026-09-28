from pydantic import BaseModel, ConfigDict, Field


class GoogleConnectionStatus(BaseModel):
    configured: bool
    connected: bool
    account_email: str | None = None
    scopes: list[str] = Field(default_factory=list)
    connected_at: str | None = None


class OAuthStartResponse(BaseModel):
    authorization_url: str


class SheetValuesResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    range: str
    majorDimension: str
    values: list[list[str | int | float | bool]] = Field(default_factory=list)
