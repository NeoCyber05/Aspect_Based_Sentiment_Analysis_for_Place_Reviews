#!/usr/bin/env pwsh
param(
    [ValidateSet("up","down","build","logs","status","help")]
    [string]$Command = "help"
)

function Show-Header {
    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "  ABSA Review Intelligence - Docker" -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan
}

function Test-Docker {
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) {
        Write-Host "[LOI] Docker chua duoc cai dat hoac chua chay." -ForegroundColor Red
        Write-Host "Hay cai Docker Desktop tu: https://www.docker.com/products/docker-desktop" -ForegroundColor Yellow
        exit 1
    }
}

switch ($Command) {
    "help" {
        Write-Host "Su dung: .\run.ps1 [lenh]`n"
        Write-Host "Cac lenh:"
        Write-Host "  up      - Khoi dong toan bo project"
        Write-Host "  down    - Dung project"
        Write-Host "  build   - Build lai tat ca images"
        Write-Host "  logs    - Xem logs tat ca services"
        Write-Host "  status  - Kiem tra trang thai"
    }
    "up" {
        Show-Header
        Test-Docker
        Write-Host "[1/3] Build images..." -ForegroundColor Yellow
        docker compose build
        Write-Host "[2/3] Khoi dong services..." -ForegroundColor Yellow
        docker compose up -d
        Write-Host "[3/3] Done!" -ForegroundColor Green
        Write-Host "`nTruy cap: http://localhost:5173" -ForegroundColor White
        Write-Host "Dang theo doi logs (Ctrl+C de thoat, services van chay)...`n" -ForegroundColor Gray
        docker compose logs -f
    }
    "down" {
        Show-Header
        Test-Docker
        docker compose down
        Write-Host "Da dung toan bo services." -ForegroundColor Green
    }
    "build" {
        Show-Header
        Test-Docker
        docker compose build --no-cache
        Write-Host "Build hoan tat." -ForegroundColor Green
    }
    "logs" {
        docker compose logs -f
    }
    "status" {
        docker compose ps
    }
}
