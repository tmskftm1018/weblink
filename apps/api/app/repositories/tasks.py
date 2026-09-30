from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.auth import User
from app.models.tasks import ProjectTask, ProjectTaskActivity, ProjectTaskChecklistItem, ProjectTaskComment


def list_for_project(db: Session, project_id: UUID) -> list[ProjectTask]:
    return list(db.scalars(
        select(ProjectTask)
        .where(ProjectTask.project_id == project_id)
        .order_by(ProjectTask.updated_at.desc(), ProjectTask.created_at.desc())
    ))


def get(db: Session, project_id: UUID, task_id: UUID) -> ProjectTask | None:
    return db.scalar(select(ProjectTask).where(
        ProjectTask.project_id == project_id,
        ProjectTask.id == task_id,
    ))


def count_for_project(db: Session, project_id: UUID) -> int:
    return db.scalar(select(func.count()).select_from(ProjectTask).where(ProjectTask.project_id == project_id)) or 0


def list_comments(db: Session, task_id: UUID) -> list[tuple[ProjectTaskComment, str]]:
    rows = db.execute(
        select(ProjectTaskComment, User.display_name)
        .outerjoin(User, User.id == ProjectTaskComment.author_id)
        .where(ProjectTaskComment.task_id == task_id)
        .order_by(ProjectTaskComment.created_at.desc())
        .limit(100)
    ).all()
    return [(comment, name or "탈퇴한 팀원") for comment, name in reversed(rows)]


def list_activities(db: Session, task_id: UUID) -> list[tuple[ProjectTaskActivity, str]]:
    rows = db.execute(
        select(ProjectTaskActivity, User.display_name)
        .outerjoin(User, User.id == ProjectTaskActivity.actor_id)
        .where(ProjectTaskActivity.task_id == task_id)
        .order_by(ProjectTaskActivity.created_at.desc())
        .limit(30)
    ).all()
    return [(activity, name or "탈퇴한 팀원") for activity, name in rows]


def list_checklist(db: Session, task_id: UUID) -> list[ProjectTaskChecklistItem]:
    return list(db.scalars(
        select(ProjectTaskChecklistItem)
        .where(ProjectTaskChecklistItem.task_id == task_id)
        .order_by(ProjectTaskChecklistItem.position, ProjectTaskChecklistItem.created_at)
    ))


def list_project_activity(db: Session, project_id: UUID) -> list[tuple[ProjectTaskActivity, str, str]]:
    rows = db.execute(
        select(ProjectTaskActivity, User.display_name, ProjectTask.title)
        .join(ProjectTask, ProjectTask.id == ProjectTaskActivity.task_id)
        .outerjoin(User, User.id == ProjectTaskActivity.actor_id)
        .where(ProjectTask.project_id == project_id)
        .order_by(ProjectTaskActivity.created_at.desc(), ProjectTaskActivity.id.desc())
        .limit(100)
    ).all()
    return [(activity, actor_name or "탈퇴한 팀원", title) for activity, actor_name, title in rows]


def get_checklist_item(db: Session, task_id: UUID, item_id: UUID) -> ProjectTaskChecklistItem | None:
    return db.scalar(select(ProjectTaskChecklistItem).where(
        ProjectTaskChecklistItem.task_id == task_id,
        ProjectTaskChecklistItem.id == item_id,
    ))
