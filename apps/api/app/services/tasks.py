from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.auth import User
from app.models.tasks import ProjectTask, ProjectTaskActivity, ProjectTaskChecklistItem, ProjectTaskComment
from app.repositories import projects as project_repository
from app.repositories import tasks as task_repository
from app.schemas.tasks import (
    ProjectTaskCreateRequest,
    ProjectTaskResponse,
    ProjectTaskUpdateRequest,
    ProjectTaskActivityResponse,
    TaskActivityResponse,
    TaskCommentCreateRequest,
    TaskCommentResponse,
    TaskDiscussionResponse,
    TaskChecklistItemCreateRequest,
    TaskChecklistItemResponse,
    TaskChecklistItemUpdateRequest,
)

MAX_PROJECT_TASKS = 200
MAX_CHECKLIST_ITEMS = 30


class ProjectNotFound(Exception):
    pass


class ProjectReadOnly(Exception):
    pass


class TaskNotFound(Exception):
    pass


class TaskAssigneeNotFound(Exception):
    pass


class TaskLimitReached(Exception):
    pass


class TaskChecklistLimitReached(Exception):
    pass


class TaskChecklistItemNotFound(Exception):
    pass


def _project_role(db: Session, user: User, project_id: UUID) -> str:
    project, role = project_repository.get_access(db, project_id, user.id)
    if project is None or role is None:
        raise ProjectNotFound
    return role


def _ensure_editor(role: str) -> None:
    if role not in {"OWNER", "EDITOR"}:
        raise ProjectReadOnly


def _ensure_assignee(db: Session, project_id: UUID, assignee_id: UUID | None) -> None:
    if assignee_id is not None and project_repository.get_member(db, project_id, assignee_id) is None:
        raise TaskAssigneeNotFound


def list_tasks(db: Session, user: User, project_id: UUID) -> list[ProjectTaskResponse]:
    _project_role(db, user, project_id)
    return [ProjectTaskResponse.model_validate(task) for task in task_repository.list_for_project(db, project_id)]


def create_task(
    db: Session, user: User, project_id: UUID, payload: ProjectTaskCreateRequest
) -> ProjectTaskResponse:
    role = _project_role(db, user, project_id)
    _ensure_editor(role)
    if task_repository.count_for_project(db, project_id) >= MAX_PROJECT_TASKS:
        raise TaskLimitReached
    _ensure_assignee(db, project_id, payload.assignee_id)
    task = ProjectTask(
        project_id=project_id,
        title=payload.title,
        description=payload.description.strip(),
        status=payload.status,
        priority=payload.priority,
        due_date=payload.due_date,
        assignee_id=payload.assignee_id,
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(task)
    db.flush()
    db.add(ProjectTaskActivity(task_id=task.id, actor_id=user.id, message="작업을 만들었습니다."))
    db.commit()
    db.refresh(task)
    return ProjectTaskResponse.model_validate(task)


def update_task(
    db: Session,
    user: User,
    project_id: UUID,
    task_id: UUID,
    payload: ProjectTaskUpdateRequest,
) -> ProjectTaskResponse:
    role = _project_role(db, user, project_id)
    _ensure_editor(role)
    task = task_repository.get(db, project_id, task_id)
    if task is None:
        raise TaskNotFound
    _ensure_assignee(db, project_id, payload.assignee_id)
    changes: list[str] = []
    if task.status != payload.status:
        status_names = {"TODO": "할 일", "IN_PROGRESS": "진행 중", "DONE": "완료"}
        changes.append(f"상태를 ‘{status_names[payload.status]}’로 변경했습니다.")
    if task.assignee_id != payload.assignee_id:
        changes.append("담당자를 변경했습니다.")
    if task.priority != payload.priority:
        priority_names = {"LOW": "낮음", "NORMAL": "보통", "HIGH": "높음", "URGENT": "긴급"}
        changes.append(f"우선순위를 ‘{priority_names[payload.priority]}’으로 변경했습니다.")
    if task.due_date != payload.due_date:
        changes.append("마감일을 변경했습니다.")
    if task.title != payload.title or task.description != payload.description.strip():
        changes.append("작업 설명을 수정했습니다.")
    task.title = payload.title
    task.description = payload.description.strip()
    task.status = payload.status
    task.priority = payload.priority
    task.due_date = payload.due_date
    task.assignee_id = payload.assignee_id
    task.updated_by = user.id
    for message in changes:
        db.add(ProjectTaskActivity(task_id=task.id, actor_id=user.id, message=message))
    db.commit()
    db.refresh(task)
    return ProjectTaskResponse.model_validate(task)


def delete_task(db: Session, user: User, project_id: UUID, task_id: UUID) -> None:
    role = _project_role(db, user, project_id)
    _ensure_editor(role)
    task = task_repository.get(db, project_id, task_id)
    if task is None:
        raise TaskNotFound
    db.delete(task)
    db.commit()


def get_discussion(db: Session, user: User, project_id: UUID, task_id: UUID) -> TaskDiscussionResponse:
    _project_role(db, user, project_id)
    task = task_repository.get(db, project_id, task_id)
    if task is None:
        raise TaskNotFound
    return TaskDiscussionResponse(
        comments=[TaskCommentResponse(
            id=comment.id, task_id=comment.task_id, author_id=comment.author_id,
            author_name=name, body=comment.body, created_at=comment.created_at,
        ) for comment, name in task_repository.list_comments(db, task.id)],
        activities=[TaskActivityResponse(
            id=activity.id, task_id=activity.task_id, actor_id=activity.actor_id,
            actor_name=name, message=activity.message, created_at=activity.created_at,
        ) for activity, name in task_repository.list_activities(db, task.id)],
    )


def add_comment(
    db: Session, user: User, project_id: UUID, task_id: UUID, payload: TaskCommentCreateRequest
) -> TaskCommentResponse:
    role = _project_role(db, user, project_id)
    _ensure_editor(role)
    task = task_repository.get(db, project_id, task_id)
    if task is None:
        raise TaskNotFound
    comment = ProjectTaskComment(task_id=task.id, author_id=user.id, body=payload.body)
    db.add(comment)
    db.add(ProjectTaskActivity(task_id=task.id, actor_id=user.id, message="댓글을 남겼습니다."))
    db.commit()
    db.refresh(comment)
    return TaskCommentResponse(
        id=comment.id, task_id=comment.task_id, author_id=comment.author_id,
        author_name=user.display_name, body=comment.body, created_at=comment.created_at,
    )


def list_checklist(
    db: Session, user: User, project_id: UUID, task_id: UUID
) -> list[TaskChecklistItemResponse]:
    _project_role(db, user, project_id)
    task = task_repository.get(db, project_id, task_id)
    if task is None:
        raise TaskNotFound
    return [TaskChecklistItemResponse.model_validate(item) for item in task_repository.list_checklist(db, task_id)]


def list_project_activity(
    db: Session, user: User, project_id: UUID
) -> list[ProjectTaskActivityResponse]:
    _project_role(db, user, project_id)
    return [ProjectTaskActivityResponse(
        id=activity.id,
        task_id=activity.task_id,
        task_title=task_title,
        actor_id=activity.actor_id,
        actor_name=actor_name,
        message=activity.message,
        created_at=activity.created_at,
    ) for activity, actor_name, task_title in task_repository.list_project_activity(db, project_id)]


def add_checklist_item(
    db: Session, user: User, project_id: UUID, task_id: UUID, payload: TaskChecklistItemCreateRequest
) -> TaskChecklistItemResponse:
    role = _project_role(db, user, project_id)
    _ensure_editor(role)
    task = task_repository.get(db, project_id, task_id)
    if task is None:
        raise TaskNotFound
    items = task_repository.list_checklist(db, task_id)
    if len(items) >= MAX_CHECKLIST_ITEMS:
        raise TaskChecklistLimitReached
    item = ProjectTaskChecklistItem(
        task_id=task.id,
        text=payload.text,
        position=max((existing.position for existing in items), default=-1) + 1,
        created_by=user.id,
    )
    task.updated_by = user.id
    task.updated_at = datetime.now(UTC)
    db.add(item)
    db.add(ProjectTaskActivity(task_id=task.id, actor_id=user.id, message=f"체크 항목을 추가했습니다: {payload.text[:150]}"))
    db.commit()
    db.refresh(item)
    return TaskChecklistItemResponse.model_validate(item)


def update_checklist_item(
    db: Session, user: User, project_id: UUID, task_id: UUID, item_id: UUID,
    payload: TaskChecklistItemUpdateRequest,
) -> TaskChecklistItemResponse:
    role = _project_role(db, user, project_id)
    _ensure_editor(role)
    task = task_repository.get(db, project_id, task_id)
    if task is None:
        raise TaskNotFound
    item = task_repository.get_checklist_item(db, task_id, item_id)
    if item is None:
        raise TaskChecklistItemNotFound
    if item.completed != payload.completed:
        item.completed = payload.completed
        item.completed_by = user.id if payload.completed else None
        item.completed_at = datetime.now(UTC) if payload.completed else None
        task.updated_by = user.id
        task.updated_at = datetime.now(UTC)
        db.add(ProjectTaskActivity(
            task_id=task.id,
            actor_id=user.id,
            message=f"체크 항목을 {'완료' if payload.completed else '다시 열기'}로 표시했습니다: {item.text[:150]}",
        ))
        db.commit()
        db.refresh(item)
    return TaskChecklistItemResponse.model_validate(item)


def delete_checklist_item(
    db: Session, user: User, project_id: UUID, task_id: UUID, item_id: UUID
) -> None:
    role = _project_role(db, user, project_id)
    _ensure_editor(role)
    task = task_repository.get(db, project_id, task_id)
    if task is None:
        raise TaskNotFound
    item = task_repository.get_checklist_item(db, task_id, item_id)
    if item is None:
        raise TaskChecklistItemNotFound
    db.add(ProjectTaskActivity(task_id=task.id, actor_id=user.id, message=f"체크 항목을 삭제했습니다: {item.text[:150]}"))
    task.updated_by = user.id
    task.updated_at = datetime.now(UTC)
    db.delete(item)
    db.commit()
