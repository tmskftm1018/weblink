from pydantic import BaseModel, ConfigDict, Field


class GoogleConnectionStatus(BaseModel):
    configured: bool
    connected: bool
    account_email: str | None = None
    scopes: list[str] = Field(default_factory=list)
    connected_at: str | None = None
    drive_picker_configured: bool = False


class GoogleDrivePickerConfig(BaseModel):
    access_token: str
    api_key: str
    app_id: str


class GoogleDriveFileResponse(BaseModel):
    file_name: str
    file_path: str
    content: str
    mime_type: str


class GitHubConnectionStatus(BaseModel):
    configured: bool
    connected: bool
    account_name: str | None = None
    connected_at: str | None = None


class GitHubTokenRequest(BaseModel):
    token: str = Field(min_length=20, max_length=500)


class OAuthStartResponse(BaseModel):
    authorization_url: str


class SheetValuesResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    range: str
    majorDimension: str
    values: list[list[str | int | float | bool]] = Field(default_factory=list)
