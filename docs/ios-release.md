# iOS Release Workflow

The frontend is an Expo React Native app in `apps/frontend`. iOS builds should stay Expo-managed unless a future native customization requires committing an `ios/` directory.

Android can be shared as APKs, but iOS does not have an equivalent general-purpose sideloading path. The normal sharing path is TestFlight through App Store Connect. Until Apple Developer Program access is available, use an iOS Simulator build for local QA.

## One-time local setup

Install the local toolchain on a Mac:

```bash
xcode-select --install
```

Install Xcode from the Mac App Store, open it once, accept its license, and install at least one iOS Simulator runtime from Xcode > Settings > Platforms.

Install JavaScript dependencies from the repo root:

```bash
corepack enable
corepack prepare pnpm@10.33.0 --activate
pnpm install --frozen-lockfile
```

Log in to Expo before the first EAS build:

```bash
pnpm --dir apps/frontend exec eas login
```

If this Expo project has not been linked to EAS yet, initialize it once:

```bash
pnpm --dir apps/frontend exec eas init
```

That command may add an Expo project id to `apps/frontend/app.json`. Commit that id after verifying it belongs to the correct Expo account.

## Simulator QA

Simulator builds do not require TestFlight, an iPhone, or Apple Developer Program membership.

Create a simulator build:

```bash
pnpm --dir apps/frontend run build:ios:simulator
```

Install and run the build on an available iOS Simulator:

```bash
pnpm --dir apps/frontend run ios:simulator
```

Before QA, confirm the backend target is correct. For local development, `.env` should expose:

```bash
EXPO_PUBLIC_API_URL=http://localhost:8000
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

EAS simulator, preview, and TestFlight builds are configured in `apps/frontend/eas.json` to use production services:

```bash
EXPO_PUBLIC_FRONTEND_URL=https://alethical-web.vercel.app
EXPO_PUBLIC_API_URL=https://alethical-api-production.up.railway.app
EXPO_PUBLIC_SUPABASE_URL=https://naakzorbkqqgbsreulqi.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

These values are embedded at build time. Rebuild the iOS artifact after changing them.

Smoke test these flows in the simulator:

- App launches as Alethical and reaches the main tabs.
- Search, bill details, legislator details, tracked bills, chat, and account screens render.
- Auth starts in the browser and returns to `alethical://auth/callback`.
- API calls point at the intended backend environment.
- Text remains readable on small and large simulated iPhones.

## TestFlight sharing

TestFlight requires paid Apple Developer Program membership and App Store Connect access.

One-time Apple setup:

1. Enroll in the Apple Developer Program.
2. Create an App Store Connect app for bundle id `com.alethical.app`.
3. Ensure the Expo account used by EAS has access to the Apple team.
4. In Supabase Auth redirect URLs, keep `alethical://auth/callback` enabled for native auth.

Build an App Store distribution artifact:

```bash
pnpm --dir apps/frontend run build:ios:testflight
```

Submit the latest production build to App Store Connect:

```bash
pnpm --dir apps/frontend run submit:ios:testflight
```

After Apple finishes processing the build, open App Store Connect > Alethical > TestFlight, fill in beta test information, and invite testers. Internal testers can usually access builds faster; external tester groups may require Apple beta review.

## Ad hoc preview builds

The `preview` EAS profile is available for known-device internal distribution:

```bash
pnpm --dir apps/frontend run build:ios:preview
```

Use this only when TestFlight is not appropriate. Ad hoc iOS builds are restricted to registered device UDIDs, so a new build is usually needed when a new tester device is added.

## Versioning

`apps/frontend/app.json` owns the public app version. EAS owns iOS build number increments through `autoIncrement` on the production profile, which prevents TestFlight upload collisions.

When preparing a user-visible release, update `expo.version` in `apps/frontend/app.json`, then build and submit with the production profile.
