from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://weblink:weblink@localhost:5432/weblink"
    session_cookie_secure: bool = False
    session_duration_days: int = 7
    web_origins: list[str] = ["http://localhost:5173"]
    run_timeout_seconds: int = 8
    run_memory_mb: int = 96
    run_cpu_nanos: int = 500_000_000
    run_max_output_chars: int = 16_384
    worker_lease_seconds: int = 30
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.5-flash-lite"
    google_oauth_client_id: str | None = None
    google_oauth_client_secret: str | None = None
    google_oauth_redirect_uri: str = "http://localhost:8000/api/v1/connections/google/oauth/callback"
    google_picker_api_key: str | None = None
    google_cloud_project_number: str | None = None
    connection_encryption_key: str | None = None
    invite_web_base_url: str = "http://localhost:5173"
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None
    smtp_use_ssl: bool = False
    smtp_starttls: bool = True
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
