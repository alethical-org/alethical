param(
    [int]$Port = 19006,
    [string]$ApiUrl = "http://localhost:8000",
    [string]$DevAuthToken = "local-dev-token"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$frontendRoot = Join-Path $repoRoot "frontend"
$nodeExe = Join-Path $repoRoot ".tools\node\node.exe"
$npmCmd = Join-Path $repoRoot ".tools\node\npm.cmd"

if (-not (Test-Path $nodeExe)) {
    throw "Workspace-local Node runtime not found at $nodeExe."
}

if (-not (Test-Path $npmCmd)) {
    throw "Workspace-local npm not found at $npmCmd."
}

Push-Location $frontendRoot
try {
    $env:EXPO_PUBLIC_API_URL = $ApiUrl
    $env:EXPO_PUBLIC_DEV_AUTH_TOKEN = $DevAuthToken

    & $npmCmd run web -- --port $Port
    if ($LASTEXITCODE -ne 0) {
        throw "Frontend server exited with code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}
