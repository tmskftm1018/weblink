import io
import json
import logging
import os
import socket
import tarfile
import time
from uuid import uuid4

import docker
from docker.types import LogConfig
from requests.exceptions import Timeout
from sqlalchemy import create_engine, text

from app import config as settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("weblink.worker")
engine = create_engine(settings.database_url, pool_pre_ping=True)
worker_id = f"{socket.gethostname()}:{os.getpid()}:{uuid4().hex[:8]}"


def claim_job() -> dict | None:
    with engine.begin() as connection:
        connection.execute(text("""
            UPDATE jobs SET status='FAILED', lease_owner=NULL, lease_until=NULL,
                last_error='Worker lease expired after final attempt', updated_at=now()
            WHERE status='RUNNING' AND lease_until < now() AND attempt >= max_attempts
        """))
        connection.execute(text("""
            UPDATE runs SET status='FAILED', failure_category='WORKER_ERROR',
                stderr='실행 작업이 중단되어 완료되지 못했습니다.', completed_at=now()
            WHERE status='RUNNING' AND id IN (
                SELECT run_id FROM jobs WHERE status='FAILED' AND last_error='Worker lease expired after final attempt'
            )
        """))
        job = connection.execute(text("""
            SELECT j.id, j.run_id, r.project_id, r.requested_by, j.attempt, j.max_attempts, j.lease_generation
            FROM jobs j JOIN runs r ON r.id = j.run_id
            WHERE (j.status = 'QUEUED' OR (j.status = 'RUNNING' AND j.lease_until < now()))
              AND j.attempt < j.max_attempts
            ORDER BY j.created_at
            LIMIT 1
            FOR UPDATE OF j SKIP LOCKED
        """)).mappings().first()
        if not job:
            return None
        generation = job["lease_generation"] + 1
        connection.execute(text("""
            UPDATE jobs SET status='RUNNING', lease_owner=:owner,
                lease_until=now() + (:lease_seconds * interval '1 second'), heartbeat_at=now(),
                attempt=attempt+1, lease_generation=:generation, updated_at=now()
            WHERE id=:id
        """), {"owner": worker_id, "lease_seconds": settings.worker_lease_seconds,
               "generation": generation, "id": job["id"]})
        connection.execute(text("""
            UPDATE runs SET status='RUNNING', started_at=COALESCE(started_at, now()) WHERE id=:run_id
        """), {"run_id": job["run_id"]})
        return {**job, "lease_generation": generation, "attempt": job["attempt"] + 1}


def heartbeat(job: dict) -> bool:
    with engine.begin() as connection:
        result = connection.execute(text("""
            UPDATE jobs SET heartbeat_at=now(), lease_until=now() + (:seconds * interval '1 second'), updated_at=now()
            WHERE id=:id AND lease_owner=:owner AND lease_generation=:generation AND status='RUNNING'
        """), {"seconds": settings.worker_lease_seconds, "id": job["id"], "owner": worker_id,
               "generation": job["lease_generation"]})
        return result.rowcount == 1


def _source(job: dict) -> list[dict[str, str]]:
    with engine.connect() as connection:
        data = connection.execute(text("""
            SELECT s.files FROM execution_snapshots s JOIN runs r ON r.snapshot_id=s.id WHERE r.id=:run_id
        """), {"run_id": job["run_id"]}).scalar_one()
    if isinstance(data, str):
        data = json.loads(data)
    files = []
    for item in data:
        path = item["path"]
        if (
            not isinstance(path, str)
            or not path
            or path.startswith("/")
            or any(part in {"", ".", ".."} for part in path.split("/"))
            or "\\" in path
        ):
            raise ValueError("Unsafe snapshot path")
        files.append({"path": path, "content": item["content"]})
    if sum(len(file["content"].encode("utf-8")) for file in files) > 1_048_576:
        raise ValueError("Snapshot exceeds the file size limit")
    if not any(file["path"] == "main.py" for file in files):
        raise ValueError("main.py is required")
    return files


def _archive(files: list[dict[str, str]]) -> bytes:
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w") as archive:
        for item in files:
            raw = item["content"].encode("utf-8")
            info = tarfile.TarInfo(item["path"])
            info.size = len(raw)
            info.mode = 0o444
            archive.addfile(info, io.BytesIO(raw))
    return stream.getvalue()


def _google_connection_for_user(user_id: str) -> dict[str, str] | None:
    if not settings.connection_encryption_key:
        return None
    with engine.connect() as connection:
        row = connection.execute(
            text("SELECT refresh_token_ciphertext FROM google_connections WHERE user_id=:user_id"),
            {"user_id": user_id},
        ).first()
    if not row:
        return None
    from cryptography.fernet import Fernet, InvalidToken

    try:
        refresh_token = Fernet(settings.connection_encryption_key.encode("ascii")).decrypt(
            row.refresh_token_ciphertext.encode("ascii")
        ).decode("utf-8")
    except (ValueError, UnicodeEncodeError, InvalidToken) as exc:
        raise RuntimeError("Could not decrypt the user's Google connection") from exc
    if not settings.google_oauth_client_id or not settings.google_oauth_client_secret:
        raise RuntimeError("Google OAuth is not configured on the worker")
    return {
        "WEBLINK_GOOGLE_REFRESH_TOKEN": refresh_token,
        "WEBLINK_GOOGLE_CLIENT_ID": settings.google_oauth_client_id,
        "WEBLINK_GOOGLE_CLIENT_SECRET": settings.google_oauth_client_secret,
    }


def execute(files: list[dict[str, str]], project_id: str, user_id: str) -> tuple[str, str, int, str | None]:
    client = docker.from_env()
    container = None
    staging = None
    api_container = None
    source_volume = None
    project_data_volume = None
    api_socket_volume = None
    google_connection = _google_connection_for_user(user_id)
    try:
        source_volume = client.volumes.create(name=f"weblink-run-{uuid4().hex}")
        api_socket_volume = client.volumes.create(name=f"weblink-api-socket-{uuid4().hex}")
        project_data_volume = client.volumes.create(
            name=f"weblink-project-db-{str(project_id).replace('-', '')}",
            labels={"app": "weblink", "project_id": str(project_id), "purpose": "student-project-data"},
        )
        initializer = client.containers.create(
            image=settings.runtime_image,
            command=["python", "-c", "import os; [os.makedirs(p, exist_ok=True) or os.chown(p, 10001, 10001) for p in ('/data', '/run/weblink')]"],
            user="0:0",
            network_disabled=True,
            cap_drop=["ALL"],
            cap_add=["CHOWN"],
            security_opt=["no-new-privileges:true"],
            volumes={
                project_data_volume.name: {"bind": "/data", "mode": "rw"},
                api_socket_volume.name: {"bind": "/run/weblink", "mode": "rw"},
            },
        )
        try:
            initializer.start()
            result = initializer.wait(timeout=5)
            if int(result.get("StatusCode", 1)) != 0:
                raise RuntimeError("Could not prepare project database storage")
        finally:
            initializer.remove(force=True)
        api_container = client.containers.create(
            image=settings.runtime_image,
            command=["python", "-I", "/opt/weblink/api_lab_server.py"],
            user="10001:10001",
            read_only=True,
            cap_drop=["ALL"],
            security_opt=["no-new-privileges:true"],
            mem_limit="32m",
            pids_limit=8,
            volumes={api_socket_volume.name: {"bind": "/run/weblink", "mode": "rw"}},
            environment=google_connection or {},
            network_disabled=google_connection is None,
            log_config=LogConfig(type="local", config={"max-size": "64k", "max-file": "1"}),
        )
        api_container.start()
        staging = client.containers.create(
            image=settings.runtime_image,
            command=["true"],
            user="10001:10001",
            network_disabled=True,
            cap_drop=["ALL"],
            security_opt=["no-new-privileges:true"],
            pids_limit=8,
            volumes={source_volume.name: {"bind": "/workspace", "mode": "rw"}},
        )
        staging.put_archive("/workspace", _archive(files))
        staging.remove(force=True)
        staging = None
        container = client.containers.create(
            image=settings.runtime_image,
            command=["python", "-I", "/opt/weblink/weblink_runner.py", "/workspace/main.py"],
            user="10001:10001", working_dir="/workspace", network_disabled=True,
            read_only=True, cap_drop=["ALL"], security_opt=["no-new-privileges:true"],
            mem_limit=f"{settings.run_memory_mb}m", nano_cpus=settings.run_cpu_nanos,
            pids_limit=32, tmpfs={"/tmp": "rw,noexec,nosuid,size=8m,uid=10001,gid=10001,mode=700"},
            # Each project receives its own persistent database volume. The
            # student container still has no network and cannot see other projects.
            volumes={
                source_volume.name: {"bind": "/workspace", "mode": "ro"},
                project_data_volume.name: {"bind": "/data", "mode": "rw"},
                api_socket_volume.name: {"bind": "/run/weblink", "mode": "rw"},
            },
            log_config=LogConfig(type="local", config={"max-size": "1m", "max-file": "2"}),
            stdin_open=False, tty=False, detach=True,
        )
        container.start()
        try:
            result = container.wait(timeout=settings.run_timeout_seconds)
        except Timeout:
            container.kill()
            return "", "실행 시간 제한을 초과했습니다.", 124, "TIMEOUT"
        logs_out = container.logs(stdout=True, stderr=False).decode("utf-8", "replace")[-settings.max_output_chars:]
        logs_err = container.logs(stdout=False, stderr=True).decode("utf-8", "replace")[-settings.max_output_chars:]
        code = int(result.get("StatusCode", 1))
        return logs_out, logs_err, code, None if code == 0 else "RUNTIME_ERROR"
    finally:
        if container:
            try:
                container.remove(force=True)
            except docker.errors.NotFound:
                pass
        if staging:
            try:
                staging.remove(force=True)
            except docker.errors.NotFound:
                pass
        if api_container:
            try:
                api_container.remove(force=True)
            except docker.errors.NotFound:
                pass
        if source_volume:
            try:
                source_volume.remove(force=True)
            except docker.errors.APIError:
                logger.exception("Could not remove temporary source volume")
        if api_socket_volume:
            try:
                api_socket_volume.remove(force=True)
            except docker.errors.APIError:
                logger.exception("Could not remove temporary API socket volume")
        client.close()


def finish(job: dict, outcome: tuple[str, str, int, str | None] | None, error: str | None = None) -> None:
    with engine.begin() as connection:
        owned = connection.execute(text("""
            SELECT id FROM jobs WHERE id=:id AND lease_owner=:owner AND lease_generation=:generation AND status='RUNNING'
            FOR UPDATE
        """), {"id": job["id"], "owner": worker_id, "generation": job["lease_generation"]}).first()
        if not owned:
            logger.warning("Discarding stale result for job %s", job["id"])
            return
        retry = error is not None and job["attempt"] < job["max_attempts"]
        if retry:
            connection.execute(text("""
                UPDATE jobs SET status='QUEUED', lease_owner=NULL, lease_until=NULL, last_error=:error, updated_at=now()
                WHERE id=:id
            """), {"error": error[:4000], "id": job["id"]})
            connection.execute(text("UPDATE runs SET status='QUEUED' WHERE id=:id"), {"id": job["run_id"]})
            return
        if error is not None:
            stdout, stderr, exit_code, category = "", "실행 작업을 처리하지 못했습니다.", 1, "WORKER_ERROR"
        else:
            stdout, stderr, exit_code, category = outcome
        status = "SUCCEEDED" if exit_code == 0 else "FAILED"
        connection.execute(text("""
            UPDATE jobs SET status=:status, lease_owner=NULL, lease_until=NULL, last_error=:error, updated_at=now()
            WHERE id=:id
        """), {"status": status, "error": error[:4000] if error else None, "id": job["id"]})
        connection.execute(text("""
            UPDATE runs SET status=:status, stdout=:stdout, stderr=:stderr, exit_code=:exit_code,
                failure_category=:category, completed_at=now() WHERE id=:id
        """), {"status": status, "stdout": stdout, "stderr": stderr, "exit_code": exit_code,
               "category": category, "id": job["run_id"]})


def process(job: dict) -> None:
    try:
        files = _source(job)
        if not heartbeat(job):
            return
        finish(job, execute(files, str(job["project_id"]), str(job["requested_by"])))
    except Exception as exc:
        logger.exception("Execution job failed")
        finish(job, None, f"{type(exc).__name__}: {exc}")


def main() -> None:
    logger.info("Execution worker started: %s", worker_id)
    while True:
        job = claim_job()
        if job is None:
            time.sleep(1)
            continue
        process(job)


if __name__ == "__main__":
    main()
