from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models.auth import User
from app.schemas.ai import DebugHintRequest, DebugHintResponse
from app.services import ai_tutor

router = APIRouter(tags=["ai tutor"])
SessionDep = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.post(
    "/projects/{project_id}/runs/{run_id}/ai/debug-hint",
    response_model=DebugHintResponse,
)
def debug_hint(
    project_id: UUID,
    run_id: UUID,
    payload: DebugHintRequest,
    db: SessionDep,
    user: CurrentUser,
) -> DebugHintResponse:
    try:
        return ai_tutor.request_debug_hint(db, user, project_id, run_id, payload)
    except ai_tutor.AIProviderUnavailable as exc:
        raise HTTPException(status_code=503, detail="AI 튜터를 사용하려면 서버에 GEMINI_API_KEY를 설정해 주세요.") from exc
    except ai_tutor.DebugContextNotFound as exc:
        raise HTTPException(status_code=404, detail="Run not found") from exc
    except ai_tutor.RunNotFailed as exc:
        raise HTTPException(status_code=409, detail="AI debug hints are available after a failed run") from exc
    except ai_tutor.AIRequestFailed as exc:
        raise HTTPException(status_code=502, detail="AI 튜터 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.") from exc
