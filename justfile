format:
  uvx ruff format alethical scripts

lint:
  uvx ruff check alethical scripts
  uvx ty check alethical/db
  cd apps/frontend && npm ci && npm exec tsc -- --noEmit

migrate:
  docker compose up -d db
  uv run python -m alembic -c alembic.ini upgrade head

up:
  docker compose up

down:
  docker compose down
