#!/usr/bin/env pwsh
# =============================================================
#  ABSA Review Intelligence - Native dev runner (KHONG dung Docker)
#  Chay 3 services truc tiep tren host de dev nhanh:
#    - absa     : uvicorn + --reload (sua .py la reload, khong build lai)
#    - backend  : go run (recompile khi restart)
#    - frontend : vite dev server (HMR)
#  Moi service mo trong 1 cua so rieng de xem log doc lap.
# =============================================================
param(
    [ValidateSet("up", "stop", "help")]
    [string]$Command = "up"
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$serviceShell = Get-Command "pwsh" -ErrorAction SilentlyContinue
if (-not $serviceShell) {
    $serviceShell = Get-Command "powershell.exe" -ErrorAction SilentlyContinue
}
if (-not $serviceShell) {
    Write-Host "[ERROR] PowerShell not found to open new service windows." -ForegroundColor Red
    exit 1
}

function Show-Header {
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "  Sentiment Review Intelligence - Dev (native)" -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan
}

function Assert-Tool($name, $cmd) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        Write-Host "[ERROR] '$cmd' ($name) not found in PATH." -ForegroundColor Red
        exit 1
    }
}

# Mo 1 service trong cua so PowerShell moi, dat tieu de + working dir.
function Start-Service($title, $workDir, $shellCmd) {
    $inner = "`$Host.UI.RawUI.WindowTitle='$title'; Set-Location '$workDir'; $shellCmd"
    Start-Process -FilePath $serviceShell.Source -ArgumentList @("-NoExit", "-Command", $inner) | Out-Null
    Write-Host "  [OK] $title" -ForegroundColor Green
}

switch ($Command) {
    "help" {
        Write-Host "Usage: .\dev.ps1 [command]`n"
        Write-Host "Commands:"
        Write-Host "  up    - Start 3 native services (sentiment-engine/backend/frontend), each in its own window"
        Write-Host "  stop  - Stop processes running on ports 8091/8090/5173"
        Write-Host "  help  - Show help"
        break
    }

    "stop" {
        Show-Header
        Write-Host "Stopping processes on ports 8091 / 8090 / 5173..." -ForegroundColor Yellow
        foreach ($port in 8091, 8090, 5173) {
            $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
            foreach ($c in $conns) {
                try {
                    Stop-Process -Id $c.OwningProcess -Force -ErrorAction Stop
                    Write-Host "  [OK] killed PID $($c.OwningProcess) (port $port)" -ForegroundColor Green
                } catch {
                    Write-Host "  [WARN] failed to kill PID $($c.OwningProcess) (port $port)" -ForegroundColor Yellow
                }
            }
        }
        Write-Host "Done. (Service windows may need to be closed manually)" -ForegroundColor Gray
        break
    }

    "up" {
        Show-Header

        # --- Kiem tra tooling ---
        $venvPy = Join-Path $root ".venv\Scripts\python.exe"
        if (-not (Test-Path $venvPy)) {
            Write-Host "[ERROR] .venv\Scripts\python.exe not found. Create venv & install requirements first:" -ForegroundColor Red
            Write-Host "      python -m venv .venv; .\.venv\Scripts\python -m pip install -r requirements.txt" -ForegroundColor Yellow
            exit 1
        }
        Assert-Tool "Go" "go"
        Assert-Tool "Node" "node"
        Assert-Tool "pnpm" "pnpm"

        if (-not (Test-Path (Join-Path $root "crawler\frontend\node_modules"))) {
            Write-Host "[INFO] frontend does not have node_modules -> running 'pnpm install'..." -ForegroundColor Yellow
            Push-Location (Join-Path $root "crawler\frontend")
            pnpm install
            Pop-Location
        }

        Write-Host "Starting services..." -ForegroundColor Yellow

        # 1) Sentiment Engine (Python/FastAPI) - chay tu repo root de import duoc review_absa_pipeline + hf_absa_model
        Start-Service "Sentiment Engine :8091" $root `
            "& '$venvPy' -m uvicorn review_absa_pipeline.service:create_app --factory --host 0.0.0.0 --port 8091 --reload"

        # 2) Backend (Go) - flag khop voi docker-compose
        Start-Service "Backend :8090" (Join-Path $root "crawler\backend") `
            "go run ./cmd/server --addr=:8090 --absa-service-url=http://127.0.0.1:8091 --disable-auto-analysis --concurrency=1 --poll-interval=2s"

        # 3) Frontend (Vite) - HMR
        Start-Service "Frontend :5173" (Join-Path $root "crawler\frontend") `
            "pnpm dev --host"

        Write-Host "`n----------------------------------------" -ForegroundColor Cyan
        Write-Host "  Frontend : http://localhost:5173" -ForegroundColor White
        Write-Host "  Backend  : http://localhost:8090/api/health" -ForegroundColor White
        Write-Host "  Sentiment: http://localhost:8091/health" -ForegroundColor White
        Write-Host "----------------------------------------" -ForegroundColor Cyan
        Write-Host "To stop all: .\dev.ps1 stop  (or Ctrl+C in each window)`n" -ForegroundColor Gray
        break
    }
}
