"""Optional SMTP delivery for project invitations."""

import smtplib
from email.message import EmailMessage
from urllib.parse import urlencode, urlsplit, urlunsplit

from app.core.config import settings


def send_project_invitation(*, email: str, project_name: str, inviter_name: str, token: str, role: str) -> bool:
    """Send an invite when SMTP is configured; return False when it is unavailable."""
    if not settings.smtp_host or not settings.smtp_from_email:
        return False
    if settings.smtp_username and not settings.smtp_use_ssl and not settings.smtp_starttls:
        return False

    base = urlsplit(settings.invite_web_base_url.strip())
    if base.scheme not in {"http", "https"} or not base.netloc:
        return False
    invite_url = urlunsplit((base.scheme, base.netloc, base.path.rstrip("/"), urlencode({"project_invite": token}), ""))
    role_label = "편집자" if role == "EDITOR" else "보기 전용"
    message = EmailMessage()
    message["Subject"] = f"WebLink 프로젝트 초대: {project_name}"
    message["From"] = settings.smtp_from_email
    message["To"] = email
    message.set_content(
        f"{inviter_name}님이 WebLink 프로젝트 ‘{project_name}’에 {role_label} 권한으로 초대했습니다.\n\n"
        f"아래 링크에서 초대를 수락할 수 있습니다. 링크는 7일 동안 유효합니다.\n{invite_url}\n\n"
        "초대를 요청하지 않았다면 이 메일을 무시하셔도 됩니다."
    )

    if settings.smtp_use_ssl:
        client = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=8)
    else:
        client = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=8)
    with client:
        client.ehlo()
        if settings.smtp_starttls and not settings.smtp_use_ssl:
            client.starttls()
            client.ehlo()
        if settings.smtp_username:
            client.login(settings.smtp_username, settings.smtp_password or "")
        client.send_message(message)
    return True
