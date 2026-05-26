# Deployment

Alethical deploys as two services:

- Frontend: Expo web static export on Vercel.
- Backend: FastAPI web service on Render.

## Backend on Render

Use the repository `render.yaml` blueprint from the repo root. It creates a Python web service named `alethical-api`.

Required Render environment variables:

```bash
DATABASE_URL=postgresql://...
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
ALETHICAL_CORS_ORIGINS=https://your-vercel-domain.vercel.app,http://localhost:19006,http://127.0.0.1:19006
```

The service build command runs:

```bash
uv sync --frozen
```

The service start command applies Alembic migrations and then starts Uvicorn:

```bash
uv run python -m alembic -c alembic.ini upgrade head && uv run uvicorn alethical.api.main:create_app --factory --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'
```

After deployment, verify:

```bash
curl https://your-render-service.onrender.com/healthz
```

## V1 Email Notifications

Tracked bill email notifications are created and sent by `scripts/run_notifications.py`.

Required delivery environment variables:

```bash
SMTP_HOST=smtp.example.com
SMTP_FROM=updates@example.com
```

Optional delivery environment variables:

```bash
SMTP_PORT=587
SMTP_USERNAME=...
SMTP_PASSWORD=...
SMTP_USE_TLS=true
```

Example production run:

```bash
uv run python scripts/run_notifications.py --target production --lookback-hours 48 --send
```

Schedule this after legislative data refreshes. It creates de-duplicated notification events for recently updated tracked bills and sends due email events according to each user's email preference.

## Frontend on Vercel

Create the Vercel project from the repository root so the root `pnpm-lock.yaml` is available. The repo-root `vercel.json` configures:

- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm --dir apps/frontend run build`
- Output directory: `apps/frontend/dist`
- SPA rewrites to `index.html`

Required Vercel environment variables:

```bash
EXPO_PUBLIC_API_URL=https://your-render-service.onrender.com
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

After Vercel assigns the production domain, update Render's `ALETHICAL_CORS_ORIGINS` with that exact Vercel origin and redeploy the backend.

## Supabase Auth URLs

In Supabase Authentication > URL Configuration, set the production site URL to the Vercel URL and include these redirect URLs:

```text
https://your-vercel-domain.vercel.app/**
http://localhost:19006/**
http://127.0.0.1:19006/**
alethical://auth/callback
```
