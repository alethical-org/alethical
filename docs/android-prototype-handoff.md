# Android Prototype Handoff

This branch contains the Expo/React Native Android prototype for the Alethical mobile app. The Android native project under `apps/frontend/android` is generated locally and is not the durable source of truth for MR review.

## Durable Build Path

Use the frontend package scripts instead of invoking raw Gradle directly:

```powershell
pnpm --dir apps/frontend android:release
```

That script:

- loads repo-root `.env`
- validates `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- syncs Android local network security config into the generated native project
- runs `:app:createBundleReleaseJsAndAssets` and `:app:assembleRelease`

The release APK is written to:

```text
apps/frontend/android/app/build/outputs/apk/release/app-release.apk
```

## Local Backend And Emulator Networking

For Android emulator builds, `apps/frontend/src/data/api.ts` maps:

```text
http://localhost:8000 -> http://10.0.2.2:8000
```

`10.0.2.2` is the standard Android Emulator alias for the host machine. This is correct for local emulator testing, but it will not work on a physical Android device.

The build script writes a scoped Android network security config allowing cleartext HTTP only for:

- `10.0.2.2`
- `localhost`
- `127.0.0.1`

This avoids broad `android:usesCleartextTraffic="true"` while still allowing the local FastAPI backend during prototype testing.

## Runbook

Start backend containers:

```powershell
docker compose up -d
docker compose ps
```

Start Metro:

```powershell
pnpm --dir apps/frontend start -- --host lan
```

Start the AVD:

```powershell
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
& "$sdk\emulator\emulator.exe" -avd Alethical_API_36 -netdelay none -netspeed full
```

Install the release APK:

```powershell
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
& "$sdk\platform-tools\adb.exe" install -r apps\frontend\android\app\build\outputs\apk\release\app-release.apk
& "$sdk\platform-tools\adb.exe" shell monkey -p com.anonymous.alethical -c android.intent.category.LAUNCHER 1
```

## Toolchain Decisions

The clean durable fix is to keep all build-time environment and Android local-network mutations inside committed scripts. Do not manually edit `node_modules` or rely on shell-only env loading for release builds.

If Gradle or React Native codegen fails on a fresh machine, fix it through one of these paths, in order:

1. Align Expo package patch versions with the versions reported by `expo start`.
2. Regenerate the Android project with the repo package versions.
3. Use `pnpm.overrides` or a committed package-manager patch only if a transitive dependency conflict is confirmed.

Do not call the branch MR-ready if a successful Android release build requires manual `node_modules` edits.

## Current Verification Targets

Before opening an MR, verify:

```powershell
pnpm --dir apps/frontend exec tsc --noEmit -p tsconfig.json
pnpm --dir apps/frontend android:release
```

Then install the APK and confirm:

- Search loads bills from the backend.
- Account no longer says Supabase is unconfigured.
- Android status bar and bottom tab bar do not overlap app content.
