import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.ai import router as ai_router
from app.api.v1.auth import router as auth_router
from app.api.v1.connections import router as connections_router
from app.api.v1.debugging import router as debugging_router
from app.api.v1.health import router as health_router
from app.api.v1.learning import router as learning_router
from app.api.v1.projects import router as projects_router
from app.api.v1.runs import router as runs_router
from app.api.v1.versions import router as versions_router
from app.core.config import settings

app = FastAPI(title="WebLink API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.web_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Idempotency-Key"],
)
app.include_router(health_router)
app.include_router(auth_router, prefix="/api/v1")
app.include_router(learning_router, prefix="/api/v1")
app.include_router(projects_router, prefix="/api/v1")
app.include_router(runs_router, prefix="/api/v1")
app.include_router(debugging_router, prefix="/api/v1")
app.include_router(ai_router, prefix="/api/v1")
app.include_router(versions_router, prefix="/api/v1")
app.include_router(connections_router, prefix="/api/v1")


class _OAuthCallbackLogRedaction(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and len(record.args) >= 3:
            args = list(record.args)
            target = args[2]
            if isinstance(target, str) and target.startswith("/api/v1/connections/google/oauth/callback"):
                args[2] = "/api/v1/connections/google/oauth/callback"
                record.args = tuple(args)
        return True


logging.getLogger("uvicorn.access").addFilter(_OAuthCallbackLogRedaction())
