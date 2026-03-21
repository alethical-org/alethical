set shell := ["bash", "-eu", "-o", "pipefail", "-c"]

default:
  @just --list

help:
  @just --list

db-up:
  docker compose up -d db

db-down:
  docker compose down

db-reset:
  docker compose down -v

db-logs:
  docker compose logs -f db

bootstrap: db-up
  uv run python scripts/bootstrap_db.py

seed: bootstrap
  uv run python scripts/load_sample_data.py

backend port="8000":
  ALETHICAL_DEV_AUTH_TOKEN=local-dev-token uv run uvicorn alethical.api.main:create_app --factory --host 0.0.0.0 --port {{port}} --reload

frontend port="19006":
  cd frontend && npm run web -- --port {{port}}

stack: seed
  @echo "Database is up, migrations are applied, and sample data is loaded."
  @echo "Run 'just backend' and 'just frontend' in separate terminals, or use 'just dev'."

dev api_port="8000" web_port="19006": seed
  echo "Starting backend on http://localhost:{{api_port}}"
  ALETHICAL_DEV_AUTH_TOKEN=local-dev-token uv run uvicorn alethical.api.main:create_app --factory --host 0.0.0.0 --port {{api_port}} --reload &
  backend_pid=$!
  echo "Starting frontend on http://localhost:{{web_port}}"
  (cd frontend && EXPO_PUBLIC_API_URL=http://localhost:{{api_port}} EXPO_PUBLIC_DEV_AUTH_TOKEN=local-dev-token npm run web -- --port {{web_port}}) &
  frontend_pid=$!
  trap 'kill $backend_pid $frontend_pid' EXIT INT TERM
  wait $backend_pid $frontend_pid
