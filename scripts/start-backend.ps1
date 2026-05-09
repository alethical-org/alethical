param(
    [int]$Port = 8000,
    [string]$DatabaseUrl = "postgresql+psycopg://alethical:alethical@localhost:54329/alethical",
    [string]$DevAuthToken = "local-dev-token"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pythonExe = Join-Path $repoRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $pythonExe)) {
    throw "Virtualenv Python not found at $pythonExe. Run the local environment setup first."
}

Push-Location $repoRoot
try {
    $env:DATABASE_URL = $DatabaseUrl
    $env:ALETHICAL_DEV_AUTH_TOKEN = $DevAuthToken

    & $pythonExe -m uvicorn alethical.api.main:create_app --factory --host 0.0.0.0 --port $Port --reload
    if ($LASTEXITCODE -ne 0) {
        throw "Backend server exited with code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
