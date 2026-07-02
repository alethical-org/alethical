# Alethical

From Aletheia (Greek: truth/unconcealedness) + ethical — sits at the intersection of truth and technology, committed to transparent governance and moral clarity. Born of an era of misinformation and political opacity, it redefines civic intelligence by grounding every insight in verifiable data, and answers the independent movement's call for accountability amid a broader moment of democratic renewal. Built in Minnesota — chosen for its civic engagement and political balance — Alethical serves as the pilot for a new era of legislative transparency.

# Mission 
To make legislative truth visible, actionable, and accessible — enabling citizens, journalists, and legislators to engage with verified, transparent data.

# Vision
A world where legislative processes are open, comprehensible, and accountable — starting with Minnesota as the pilot for a national transparency movement.

## Repository Layout

Organized as a small monorepo with separate application, backend, and documentation areas.

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

Frontend dependencies are managed with pnpm 10.33.0 from the repository root:

```bash
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install --frozen-lockfile
pnpm --dir apps/frontend run build
```

`pnpm-workspace.yaml` enforces a seven-day minimum release age for all resolved packages.

Authenticated frontend features use Supabase Auth. For local web or native sign-in, set these environment variables before starting the frontend:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

The local `.env` in this workspace already maps the existing Supabase project URL and publishable key into those names. Keep the `EXPO_PUBLIC_*` values publishable-only; never put service-role keys in frontend environment variables.

The Find My Legislator map uses raster map tiles. For Android/native builds, set a stable tile request identity and use an approved tile URL:

```bash
EXPO_PUBLIC_MAP_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
EXPO_PUBLIC_MAP_TILE_USER_AGENT="Alethical/0.1 (+https://alethical-web.vercel.app)"
```

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

<!-- deploy test: 2026-06-23 -->
