# Local Dev Notes (Windows)

## Current status

- Backend runs successfully from this environment.
- Frontend serves correctly when Expo is run attached in a normal PowerShell window.
- In the Codex sandbox, Expo does not stay alive reliably as a detached background process.

## Working frontend command

Run this in a normal PowerShell window:

```powershell
cd C:\Users\Santrupta\Desktop\alethical\frontend
$env:EXPO_PUBLIC_API_URL="http://localhost:8000"
$env:EXPO_PUBLIC_DEV_AUTH_TOKEN="local-dev-token"
$env:BROWSER="none"
..\.tools\node\node.exe .\node_modules\expo\bin\cli start --web --port 19006 --non-interactive
```

## Working backend command

Run this in a separate PowerShell window:

```powershell
cd C:\Users\Santrupta\Desktop\alethical
powershell -ExecutionPolicy Bypass -File scripts\start-backend.ps1
```

## One-time local setup

If the database is not ready yet:

```powershell
cd C:\Users\Santrupta\Desktop\alethical
powershell -ExecutionPolicy Bypass -File scripts\setup-local-dev.ps1
```

## Verified behavior

- `http://localhost:8000/healthz` returns `200`
- `http://localhost:19006` returns `200` when Expo is running in the foreground
- The Expo Metro bundle endpoint also returns `200` when Expo is attached
