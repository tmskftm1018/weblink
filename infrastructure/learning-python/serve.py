"""This launcher runs ONLY inside a disposable unprivileged learner container."""

import sys

import uvicorn

sys.path.insert(0, "/workspace")
uvicorn.run("main:app", host="0.0.0.0", port=8000, access_log=False, log_level="error")
