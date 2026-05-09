# Alethical

Alethical is organized as a small monorepo with separate application, backend, and documentation areas.

## Repository Layout

- `alethical/`: Python backend package for the API, database, ingestion runtime, migrations, and backend tests.
- `alethical/tests/fixtures/`: JSON fixtures used only by tests and deterministic local demo seeding.
- `apps/frontend/`: Expo React Native app for web, iOS, and Android.
- `scripts/`: Repo-level Python utilities for loading data and validating queries.
- `docs/`: Product, design, architecture, validation, and local-development notes.

## Common Commands

```bash
just format
just lint
just migrate
just up
just down
```

`just up` starts Postgres, the FastAPI backend, and the Expo web frontend. By default, the API is available at `http://localhost:8000` and the frontend at `http://localhost:19006`.

If a port is already in use, override it when starting Compose:

```bash
BACKEND_PORT=18000 EXPO_PUBLIC_API_URL=http://localhost:18000 just up
```
