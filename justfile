format:
  uvx ruff format alethical scripts

lint:
  uvx ruff check alethical scripts
  uvx ty check alethical/db
  pnpm install --frozen-lockfile
  pnpm --dir apps/frontend exec tsc --noEmit

migrate:
  docker compose up -d db
  uv run python -m alembic -c alembic.ini upgrade head

up:
  docker compose up

down:
  docker compose down

pipeline-install target:
  uv run python -m alethical.pipeline.oban --target {{target}} install

pipeline target *ARGS:
  uv run python -m alethical.pipeline.oban --target {{target}} enqueue pipeline-run {{ARGS}}

pipeline-work target:
  uv run python -m alethical.pipeline.oban --target {{target}} drain source_sync
  uv run python -m alethical.pipeline.oban --target {{target}} drain bill_sync --concurrency 8
  uv run python -m alethical.pipeline.oban --target {{target}} drain committee_sync
  uv run python -m alethical.pipeline.oban --target {{target}} drain vote_sync
  uv run python -m alethical.pipeline.oban --target {{target}} drain ai_batch
