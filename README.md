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

Authenticated frontend features use Supabase Auth. For local web or native sign-in, set these environment variables before starting the frontend:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

The local `.env` in this workspace already maps the existing Supabase project URL and publishable key into those names. Keep the `EXPO_PUBLIC_*` values publishable-only; never put service-role keys in frontend environment variables.

Manual Supabase setup:

1. In Supabase, go to Authentication > Providers > Google and enable Google.
2. In Google Cloud Console, create or select an OAuth client for the app and add Supabase's Google callback URL from the Supabase Google provider screen.
3. Copy the Google client ID and client secret into the Supabase Google provider settings.
4. In Supabase Authentication > URL Configuration, set the site URL to the deployed web app URL when production is ready.
5. Add redirect URLs for local web, production web, and native deep links:
   `http://localhost:19006/**`, `http://127.0.0.1:19006/**`, `https://alethical-web.vercel.app/**`, and `alethical://auth/callback`.
6. If you use a different local Expo web port, add that exact wildcard origin too, for example `http://localhost:19007/**`.

If a port is already in use, override it when starting Compose:

```bash
BACKEND_PORT=18000 EXPO_PUBLIC_API_URL=http://localhost:18000 just up
```
