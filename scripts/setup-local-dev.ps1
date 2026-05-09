param(
    [string]$DatabaseUrl = "postgresql+psycopg://alethical:alethical@localhost:54329/alethical"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$pythonExe = Join-Path $repoRoot ".venv\Scripts\python.exe"

function Invoke-CheckedNative {
    param(
        [string]$Label,
        [scriptblock]$Command
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
}

function Wait-ForDockerHealth {
    param(
        [string]$ContainerName,
        [int]$TimeoutSeconds = 120
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $status = docker inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}" $ContainerName 2>$null
        if ($LASTEXITCODE -eq 0 -and $status -eq "healthy") {
            return
        }
        Start-Sleep -Seconds 2
    }

    throw "Container $ContainerName did not become healthy within $TimeoutSeconds seconds."
}

if (-not (Test-Path $pythonExe)) {
    throw "Virtualenv Python not found at $pythonExe. Run the local environment setup first."
}

Push-Location $repoRoot
try {
    $env:DATABASE_URL = $DatabaseUrl

    Invoke-CheckedNative "docker compose up" { docker compose up -d db }
    Wait-ForDockerHealth -ContainerName "alethical-db"
    Invoke-CheckedNative "bootstrap_db.py" { & $pythonExe "scripts/bootstrap_db.py" }
    Invoke-CheckedNative "load_sample_data.py" { & $pythonExe "scripts/load_sample_data.py" }

    Write-Host ""
    Write-Host "Local database is ready."
    Write-Host "Backend:  powershell -ExecutionPolicy Bypass -File scripts/start-backend.ps1"
    Write-Host "Frontend: powershell -ExecutionPolicy Bypass -File scripts/start-frontend.ps1"
}
finally {
    Pop-Location
}
