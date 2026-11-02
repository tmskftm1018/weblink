"""Explicit localhost smoke run. Creates QA accounts, never writes grades to DB.

Run with --run-local --output <private directory outside the repository>.
Artifacts are reference solutions; execution and submission use normal APIs.
"""

import argparse
import http.cookiejar
import json
import secrets
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPCookieProcessor, Request, build_opener

from practice_examples import artifacts


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-local", action="store_true", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--url", default="http://localhost:8000")
    parser.add_argument("--levels", nargs="+", choices=["BEGINNER", "PRACTICED", "EXPERIENCED"], default=["BEGINNER", "PRACTICED", "EXPERIENCED"])
    args = parser.parse_args()
    target = urlsplit(args.url)
    if target.scheme != "http" or target.hostname not in {"localhost", "127.0.0.1"} or target.username or target.query or target.fragment or target.path not in {"", "/"}:
        parser.error("Only a plain localhost HTTP origin is accepted.")
    output = args.output.resolve()
    repo = Path(__file__).resolve().parents[3]
    if output == repo or repo in output.parents:
        parser.error("Keep private QA credentials outside the repository.")
    output.mkdir(parents=True, exist_ok=True)
    private_file = output / "practice-course-private.json"
    report_file = output / "practice-course-report.json"
    state = json.loads(private_file.read_text(encoding="utf-8")) if private_file.exists() else {}
    report = {"scope": "localhost HTTP + actual registered runtimes; not browser E2E or learning-effect validation", "levels": {}}
    catalogue = json.loads((Path(__file__).resolve().parents[1] / "app/content/curriculum/web-fs-01.json").read_text(encoding="utf-8"))

    for level in args.levels:
        client = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

        def request(path, data=None, method=None, _client=client):
            req = Request(args.url.rstrip("/") + path, data=json.dumps(data).encode() if data is not None else None,
                          headers={"Content-Type": "application/json"}, method=method or ("POST" if data is not None else "GET"))
            try:
                with _client.open(req, timeout=30) as response:
                    raw = response.read()
                    return json.loads(raw) if raw else None
            except HTTPError as error:
                raise RuntimeError(f"HTTP {error.code}: {path}") from None

        if level not in state:
            credential = {"email": f"qa-course-{uuid.uuid4().hex[:12]}@example.com", "password": secrets.token_urlsafe(24)}
            request("/api/v1/auth/signup", {**credential, "display_name": f"과정 검증 {level}"})
            registration = request("/api/v1/learning/enrollments", {"course_key": "WEB-FS-01"})
            credential["base"] = f"/api/v1/learning/enrollments/{registration['id']}"
            state[level] = credential
            private_file.write_text(json.dumps(state), encoding="utf-8")
        else:
            credential = state[level]
            assert credential["email"].startswith("qa-course-")
            request("/api/v1/auth/login", {key: credential[key] for key in ("email", "password")})
        base = credential["base"]
        path = request(base + "/path")
        if path["level"] != level:
            request(base + "/path", {"expected_version": path["version"], "level": level}, "PUT")
        completed = []
        report["levels"][level] = {"missions": completed}

        def execute(node_id, version, field, _base=base, _request=request):
            result = _request(_base + f"/nodes/{node_id}/run", {"expected_version": version, "field": field})
            deadline = time.monotonic() + 100
            while result["status"] in {"QUEUED", "RUNNING"}:
                if time.monotonic() >= deadline:
                    raise RuntimeError(f"{node_id}/{field}: execution timeout")
                time.sleep(0.5)
                result = _request(f"/api/v1/learning/executions/{result['job_id']}")
            checks = result.get("checks", [])
            summary = {"field": field, "status": result["status"], "passed": sum(bool(check["passed"]) for check in checks), "total": len(checks),
                       "failures": [check["label"] for check in checks if not check["passed"]]}
            if result["status"] != "COMPLETED" or (field != "baseline_source" and (not checks or summary["passed"] != len(checks))):
                raise RuntimeError(json.dumps({**summary, "node": node_id, "error": result.get("error", "")}, ensure_ascii=False))
            return summary

        try:
            for spec in catalogue["missions"]:
                node_id = spec["id"]
                details = request(base + f"/nodes/{node_id}")
                required = {field["id"] for field in details["fields"] if not field.get("optional")}
                answers = {field["id"]: field["choices"][0] for field in details["fields"] if field["kind"] == "choice" and not field.get("practice_note")}
                answers.update({key: value for key, value in artifacts(node_id).items() if key in required})
                answers["concept_answer"] = spec["concept_check"]["answer"]
                saved = request(base + f"/nodes/{node_id}/work", {"expected_version": details["work"]["version"], "expected_assignment_key": details["assignment"]["key"], "answers": answers}, "PUT")
                request(base + f"/nodes/{node_id}")
                executions = []
                if node_id >= "M04":
                    if node_id == "M11":
                        executions.append(execute(node_id, saved["version"], "baseline_source"))
                    executions.append(execute(node_id, saved["version"], "source"))
                    if details["assignment"]["transfer_required"]:
                        executions.append(execute(node_id, saved["version"], "transfer_source"))
                submitted = request(base + f"/nodes/{node_id}/submit", {"expected_version": saved["version"]})
                if not submitted["feedback"]["passed"]:
                    raise RuntimeError(json.dumps({"node": node_id, "issues": submitted["feedback"]["issues"]}, ensure_ascii=False))
                completed.append({"id": node_id, "work_version": saved["version"], "executions": executions})
                report_file.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"{level} {node_id} PASSED", flush=True)
            workspace = request(base + "/workspace")
            if len(workspace["completed_ids"]) != 12:
                raise RuntimeError("Course completion did not reach 12/12")
            report["levels"][level]["completed"] = 12
        except Exception as error:
            report["levels"][level]["error"] = str(error)
            report_file.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            raise
        report_file.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Report: {report_file}", flush=True)


if __name__ == "__main__":
    main()
