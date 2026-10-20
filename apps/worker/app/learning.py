"""Reuse the existing worker's Docker boundary for course HTTP executions."""

import io
import json
import os
import tarfile
import time
from uuid import uuid4

import docker
from docker.types import LogConfig
from requests.exceptions import Timeout
from sqlalchemy import text

IMAGE = os.getenv("LEARNING_API_IMAGE", "weblink-learning-api-runtime:local")
LABEL = "weblink.learning-execution"
last_cleanup = 0.0


def _archive(source: str, integrated: bool = False) -> bytes:
    output = io.BytesIO()
    files = {"main.py": source}
    if integrated:
        snapshot = json.loads(source)
        files = {"main.py": snapshot["api"], "App.jsx": snapshot["frontend"]}
    with tarfile.open(fileobj=output, mode="w") as archive:
        for name, content in files.items():
            raw = content.encode()
            entry = tarfile.TarInfo(name)
            entry.size = len(raw)
            entry.mode = 0o444
            archive.addfile(entry, io.BytesIO(raw))
    return output.getvalue()


def _cleanup_expired(client) -> None:
    filters = {"label": f"{LABEL}=true"}
    for kind, collection in (("containers", client.containers), ("volumes", client.volumes), ("networks", client.networks)):
        items = collection.list(all=True, filters=filters) if kind == "containers" else collection.list(filters=filters)
        for item in items[:20]:
            labels = item.attrs.get("Config", {}).get("Labels", {}) if kind == "containers" else item.attrs.get("Labels", {})
            if float(labels.get("weblink.expires", "inf")) >= time.time():
                continue
            try:
                item.remove(force=True) if kind == "containers" else item.remove()
            except docker.errors.APIError:
                pass  # Still in use: another bounded cleanup pass will retry.


def execute(job: dict) -> dict:
    if job["node_id"] not in {"M06", "M07", "M08", "M09", "M10", "M11", "M12"} or job["field"] not in {"source", "transfer_source", "baseline_source"} or (job["field"] == "transfer_source" and job["node_id"] not in {"M07", "M10", "M12"}) or (job["field"] == "baseline_source" and job["node_id"] != "M11"):
        return {"status": "UNAVAILABLE", "error": "지원하지 않는 실행입니다.", "checks": [], "requests": []}
    client = docker.from_env()
    labels = {LABEL: "true", "weblink.expires": str(time.time() + 240)}
    network = volume = data_volume = staging = server = checker = keeper = None
    log_config = LogConfig(type="local", config={"max-size": "64k", "max-file": "2"})
    limits = {"image": IMAGE, "user": "10001:10001", "read_only": True, "cap_drop": ["ALL"], "security_opt": ["no-new-privileges:true"], "nano_cpus": 500_000_000, "labels": labels, "log_config": log_config}
    try:
        _cleanup_expired(client)
        network = client.networks.create(f"weblink-learning-{uuid4().hex}", internal=True, labels=labels)
        volume = client.volumes.create(name=f"weblink-learning-source-{uuid4().hex}", labels=labels)
        staging = client.containers.create(**limits, command=["true"], network_disabled=True, mem_limit="24m", pids_limit=8, volumes={volume.name: {"bind": "/workspace", "mode": "rw"}})
        staging.put_archive("/workspace", _archive(job["source"], job["node_id"] in {"M10", "M11", "M12"}))
        staging.remove(force=True)
        staging = None
        mounts = {volume.name: {"bind": "/workspace", "mode": "ro"}}
        if job["node_id"] in {"M08", "M09", "M10", "M11", "M12"}:
            data_volume = client.volumes.create(name=f"weblink-learning-data-{uuid4().hex}", labels=labels,
                driver="local", driver_opts={"type": "tmpfs", "device": "tmpfs", "o": "size=16m,uid=10001,gid=10001,mode=700"})
            mounts[data_volume.name] = {"bind": "/data", "mode": "rw"}
            # Keep the bounded tmpfs volume mounted while the API container restarts.
            keeper = client.containers.create(**limits, command=["sleep", "150"], network_disabled=True,
                mem_limit="16m", pids_limit=8, volumes={data_volume.name: {"bind": "/data", "mode": "ro"}})
            keeper.start()
        server = client.containers.create(
            **limits, command=["python", "-I", "/workspace/main.py"] if job["node_id"] == "M08" else ["python", "-I", "/opt/weblink/serve.py"],
            name=f"weblink-learning-api-{uuid4().hex}", network=network.name,
            mem_limit="128m", pids_limit=32,
            tmpfs={"/tmp": "rw,noexec,nosuid,nodev,size=8m,uid=10001,gid=10001,mode=700"},
            volumes=mounts,
        )
        server.start()
        observer_mounts = {name: {**config, "mode": "ro"} for name, config in mounts.items()} if data_volume else {}
        title = f"게시글-{uuid4().hex[:12]}"

        def observe(phase="before"):
            nonlocal checker
            if checker:
                checker.remove(force=True)
            command = ["python", "-I", "/opt/weblink/check_sqlite.py"] if job["node_id"] == "M08" else ["python", "-I", "/opt/weblink/check_api.py", job["node_id"], job["field"], server.name, phase, title]
            if job["node_id"] in {"M10", "M11", "M12"}:
                command = ["python", "-I", "/opt/weblink/check_integration.py", job["field"], server.name, phase, title, job["node_id"]]
            checker = client.containers.create(**limits, command=command, network=network.name,
                mem_limit="128m" if job["node_id"] in {"M10", "M11", "M12"} else "64m", pids_limit=16, volumes=observer_mounts)
            checker.start()
            finished = checker.wait(timeout=30)
            raw = checker.logs(stdout=True, stderr=False, tail=1)
            if finished.get("StatusCode") in {137, 152}:
                return {"status": "LIMIT_EXCEEDED", "error": "실행 자원 한도를 넘었습니다.", "checks": [], "requests": []}
            if finished.get("StatusCode") != 0 or len(raw) > 60000:
                return {"status": "UNAVAILABLE", "error": "관찰 결과를 만들지 못했습니다.", "checks": [], "requests": []}
            result = json.loads(raw)
            if result.get("status") not in {"COMPLETED", "CODE_ERROR", "LIMIT_EXCEEDED", "UNAVAILABLE"}:
                raise ValueError("Invalid checker status")
            return result

        try:
            if job["node_id"] == "M08":
                finished = server.wait(timeout=8)
                if finished.get("StatusCode") != 0:
                    return {"status": "CODE_ERROR", "error": "SQLite 스크립트를 완료하지 못했어요.", "stderr": server.logs(stdout=False, stderr=True, tail=12).decode("utf-8", "replace")[-1200:], "checks": [], "requests": []}
            result = observe()
            if job["node_id"] in {"M09", "M10", "M11", "M12"} and result["status"] == "COMPLETED":
                server.restart(timeout=1)
                after = observe("after")
                if after["status"] != "COMPLETED":
                    return after
                result["checks"].extend(after["checks"])
                result["requests"].extend(after["requests"])
                result["database_after_restart"] = after.get("database_rows", [])
                result["restarted"] = True
        except Timeout:
            return {"status": "LIMIT_EXCEEDED", "error": "실행 시간 한도를 넘었습니다.", "checks": [], "requests": []}
        if result["status"] == "CODE_ERROR":
            result["stderr"] = server.logs(stdout=False, stderr=True, tail=12).decode("utf-8", "replace")[-1200:]
        return result
    finally:
        for container in (checker, server, keeper, staging):
            if container:
                try:
                    container.remove(force=True)
                except docker.errors.APIError:
                    pass
        for resource in (volume, data_volume, network):
            if resource:
                try:
                    resource.remove()
                except docker.errors.APIError:
                    pass
        client.close()


def process_next(engine) -> bool:
    global last_cleanup
    if time.monotonic() - last_cleanup > 30:
        last_cleanup = time.monotonic()
        try:
            client = docker.from_env()
            try:
                _cleanup_expired(client)
            finally:
                client.close()
        except docker.errors.DockerException:
            pass
    token = uuid4().hex
    with engine.begin() as connection:
        connection.execute(text("""
            UPDATE learning_executions SET status='UNAVAILABLE', lease_until=NULL,
                result='{"status":"UNAVAILABLE","error":"실행 작업이 중단되었습니다. 다시 실행해 주세요.","checks":[],"requests":[]}'::json
            WHERE status='RUNNING' AND lease_until < now()
        """))
        job = connection.execute(text("""
            SELECT * FROM learning_executions WHERE status='QUEUED'
            ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED
        """)).mappings().first()
        if not job:
            return False
        connection.execute(text("""
            UPDATE learning_executions SET status='RUNNING', lease_token=:token,
                lease_until=now() + interval '120 seconds' WHERE id=:id
        """), {"id": job["id"], "token": token})
    try:
        result = execute(dict(job))
    except (docker.errors.DockerException, ValueError, OSError, Timeout):
        result = {"status": "UNAVAILABLE", "error": "실행 환경을 준비하지 못했습니다.", "checks": [], "requests": []}
    with engine.begin() as connection:
        connection.execute(text("""
            UPDATE learning_executions SET status=:status, result=CAST(:result AS json), lease_until=NULL
            WHERE id=:id AND lease_token=:token AND status='RUNNING'
        """), {"id": job["id"], "token": token, "status": result["status"], "result": json.dumps(result, ensure_ascii=False)})
    return True
