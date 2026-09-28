FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml ./
RUN uv sync --no-dev --no-install-project
COPY app ./app
CMD ["uv", "run", "--no-sync", "python", "-m", "app.main"]
