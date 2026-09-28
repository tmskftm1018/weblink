.PHONY: up down web-install web-build api-test api-lint db-upgrade

up:
	docker compose up --build

down:
	docker compose down

web-install:
	cd apps/web && pnpm install --frozen-lockfile

web-build:
	cd apps/web && pnpm build

api-test:
	cd apps/api && uv run pytest

api-lint:
	cd apps/api && uv run ruff check app tests migrations

db-upgrade:
	cd apps/api && uv run alembic upgrade head
