# Local Dev Notes (Windows)

## Commands

Run these from the repository root in PowerShell:

```powershell
just migrate
just up
```

Use `Ctrl+C` to stop the foreground stack, or run:

```powershell
just down
```

If a port is already in use, override it before `just up`:

```powershell
$env:BACKEND_PORT="18000"
$env:EXPO_PUBLIC_API_URL="http://localhost:18000"
just up
```

## Verified behavior

- `http://localhost:8000/healthz` returns `200`
- `http://localhost:19006` returns `200`
