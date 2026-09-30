from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.api.v1.auth import get_current_user
from app.db.session import get_db
from app.models.auth import User
from app.schemas.tasks import (
    ProjectTaskCreateRequest,
    ProjectTaskResponse,
    ProjectTaskUpdateRequest,
    TaskCommentCreateRequest,
    TaskCommentResponse,
    TaskDiscussionResponse,
    TaskChecklistItemCreateRequest,
    TaskChecklistItemResponse,
    TaskChecklistItemUpdateRequest,
    ProjectTaskActivityResponse,
)
from app.services import tasks as task_service

router = APIRouter(prefix="/projects/{project_id}/tasks", tags=["project tasks"])
SessionDep = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.get("", response_model=list[ProjectTaskResponse])
def list_tasks(project_id: UUID, db: SessionDep, user: CurrentUser) -> list[ProjectTaskResponse]:
    try:
        return task_service.list_tasks(db, user, project_id)
    except task_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc


@router.get("/activity", response_model=list[ProjectTaskActivityResponse])
def list_project_task_activity(
    project_id: UUID, db: SessionDep, user: CurrentUser
) -> list[ProjectTaskActivityResponse]:
    try:
        return task_service.list_project_activity(db, user, project_id)
    except task_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc


@router.post("", response_model=ProjectTaskResponse, status_code=status.HTTP_201_CREATED)
def create_task(
    project_id: UUID,
    payload: ProjectTaskCreateRequest,
    db: SessionDep,
    user: CurrentUser,
) -> ProjectTaskResponse:
    try:
        return task_service.create_task(db, user, project_id, payload)
    except task_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc
    except task_service.ProjectReadOnly as exc:
        raise HTTPException(status_code=403, detail="보기 전용 권한으로는 작업을 관리할 수 없습니다.") from exc
    except task_service.TaskAssigneeNotFound as exc:
        raise HTTPException(status_code=422, detail="담당자는 이 프로젝트의 팀원이어야 합니다.") from exc
    except task_service.TaskLimitReached as exc:
        raise HTTPException(status_code=409, detail="프로젝트 작업은 200개까지 만들 수 있습니다.") from exc


@router.put("/{task_id}", response_model=ProjectTaskResponse)
def update_task(
    project_id: UUID,
    task_id: UUID,
    payload: ProjectTaskUpdateRequest,
    db: SessionDep,
    user: CurrentUser,
) -> ProjectTaskResponse:
    try:
        return task_service.update_task(db, user, project_id, task_id, payload)
    except task_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc
    except task_service.ProjectReadOnly as exc:
        raise HTTPException(status_code=403, detail="보기 전용 권한으로는 작업을 관리할 수 없습니다.") from exc
    except task_service.TaskNotFound as exc:
        raise HTTPException(status_code=404, detail="작업을 찾지 못했습니다.") from exc
    except task_service.TaskAssigneeNotFound as exc:
        raise HTTPException(status_code=422, detail="담당자는 이 프로젝트의 팀원이어야 합니다.") from exc


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(project_id: UUID, task_id: UUID, db: SessionDep, user: CurrentUser) -> Response:
    try:
        task_service.delete_task(db, user, project_id, task_id)
    except task_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc
    except task_service.ProjectReadOnly as exc:
        raise HTTPException(status_code=403, detail="보기 전용 권한으로는 작업을 관리할 수 없습니다.") from exc
    except task_service.TaskNotFound as exc:
        raise HTTPException(status_code=404, detail="작업을 찾지 못했습니다.") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{task_id}/discussion", response_model=TaskDiscussionResponse)
def get_task_discussion(
    project_id: UUID, task_id: UUID, db: SessionDep, user: CurrentUser
) -> TaskDiscussionResponse:
    try:
        return task_service.get_discussion(db, user, project_id, task_id)
    except task_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc
    except task_service.TaskNotFound as exc:
        raise HTTPException(status_code=404, detail="작업을 찾지 못했습니다.") from exc


@router.post("/{task_id}/comments", response_model=TaskCommentResponse, status_code=status.HTTP_201_CREATED)
def add_task_comment(
    project_id: UUID,
    task_id: UUID,
    payload: TaskCommentCreateRequest,
    db: SessionDep,
    user: CurrentUser,
) -> TaskCommentResponse:
    try:
        return task_service.add_comment(db, user, project_id, task_id, payload)
    except task_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc
    except task_service.ProjectReadOnly as exc:
        raise HTTPException(status_code=403, detail="보기 전용 권한으로는 댓글을 남길 수 없습니다.") from exc
    except task_service.TaskNotFound as exc:
        raise HTTPException(status_code=404, detail="작업을 찾지 못했습니다.") from exc


@router.get("/{task_id}/checklist", response_model=list[TaskChecklistItemResponse])
def list_task_checklist(
    project_id: UUID, task_id: UUID, db: SessionDep, user: CurrentUser
) -> list[TaskChecklistItemResponse]:
    try:
        return task_service.list_checklist(db, user, project_id, task_id)
    except task_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc
    except task_service.TaskNotFound as exc:
        raise HTTPException(status_code=404, detail="작업을 찾지 못했습니다.") from exc


@router.post("/{task_id}/checklist", response_model=TaskChecklistItemResponse, status_code=status.HTTP_201_CREATED)
def add_task_checklist_item(
    project_id: UUID,
    task_id: UUID,
    payload: TaskChecklistItemCreateRequest,
    db: SessionDep,
    user: CurrentUser,
) -> TaskChecklistItemResponse:
    try:
        return task_service.add_checklist_item(db, user, project_id, task_id, payload)
    except task_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc
    except task_service.ProjectReadOnly as exc:
        raise HTTPException(status_code=403, detail="보기 전용 권한으로는 체크 항목을 관리할 수 없습니다.") from exc
    except task_service.TaskNotFound as exc:
        raise HTTPException(status_code=404, detail="작업을 찾지 못했습니다.") from exc
    except task_service.TaskChecklistLimitReached as exc:
        raise HTTPException(status_code=409, detail="체크리스트는 작업마다 30개까지 추가할 수 있습니다.") from exc


@router.put("/{task_id}/checklist/{item_id}", response_model=TaskChecklistItemResponse)
def update_task_checklist_item(
    project_id: UUID,
    task_id: UUID,
    item_id: UUID,
    payload: TaskChecklistItemUpdateRequest,
    db: SessionDep,
    user: CurrentUser,
) -> TaskChecklistItemResponse:
    try:
        return task_service.update_checklist_item(db, user, project_id, task_id, item_id, payload)
    except task_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc
    except task_service.ProjectReadOnly as exc:
        raise HTTPException(status_code=403, detail="보기 전용 권한으로는 체크 항목을 관리할 수 없습니다.") from exc
    except task_service.TaskNotFound as exc:
        raise HTTPException(status_code=404, detail="작업을 찾지 못했습니다.") from exc
    except task_service.TaskChecklistItemNotFound as exc:
        raise HTTPException(status_code=404, detail="체크 항목을 찾지 못했습니다.") from exc


@router.delete("/{task_id}/checklist/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task_checklist_item(
    project_id: UUID, task_id: UUID, item_id: UUID, db: SessionDep, user: CurrentUser
) -> Response:
    try:
        task_service.delete_checklist_item(db, user, project_id, task_id, item_id)
    except task_service.ProjectNotFound as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾지 못했습니다.") from exc
    except task_service.ProjectReadOnly as exc:
        raise HTTPException(status_code=403, detail="보기 전용 권한으로는 체크 항목을 관리할 수 없습니다.") from exc
    except task_service.TaskNotFound as exc:
        raise HTTPException(status_code=404, detail="작업을 찾지 못했습니다.") from exc
    except task_service.TaskChecklistItemNotFound as exc:
        raise HTTPException(status_code=404, detail="체크 항목을 찾지 못했습니다.") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
