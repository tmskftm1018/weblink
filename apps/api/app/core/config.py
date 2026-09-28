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
    connection_encryption_key: str | None = None
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
